// 编排层:采集 → 聚合 → 渲染 → 落盘 → git 固化。所有副作用依赖(网络/文件/git/时钟/env)
// 均可注入,便于离线测试 runOnce/collect 而不触碰真实网络或 git。
// 用法:node src/run.mjs [--no-commit]

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rpcCall as defaultRpcCall } from './rpc.mjs';
import {
  TRANSFER_TOPIC,
  hexToNumber,
  summarizeFeeHistory,
  summarizeBlock,
  summarizeTransfers,
  isLogLimitError,
} from './metrics.mjs';
import { renderReport } from './render.mjs';
import { reportDateStr, buildStatus, shouldTruncateLog } from './orchestration.mjs';
import { notifySlack } from './notify.mjs';
import { sanitizePaths } from './sanitize.mjs';
import { fetchFundingRss } from './funding-rss.mjs';
import { parseFundingEvents, filterFundingEvents } from './funding.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function toHex(n) {
  return '0x' + n.toString(16);
}

// 采集单次 digest 所需的原始数据。rpcCall 可注入,便于测试内注入 fake 端点行为。
// 单 token 的 eth_getLogs 命中上限类错误时,不使整份采集 abort:该 token 记为占位截断形态,继续处理其余 token。
export async function collect(config, deps = {}) {
  const { rpcCall = defaultRpcCall } = deps;
  const { endpoints } = config;
  const latestHex = await rpcCall(endpoints, 'eth_blockNumber');
  const latest = hexToNumber(latestHex);

  const feeHistory = await rpcCall(endpoints, 'eth_feeHistory', [
    toHex(config.feeHistoryBlocks),
    'latest',
    [25, 50, 75],
  ]);

  const { count, stepBlocks } = config.sampleBlocks;
  const blockSamples = [];
  for (let i = count - 1; i >= 0; i--) {
    const block = await rpcCall(endpoints, 'eth_getBlockByNumber', [
      toHex(latest - i * stepBlocks),
      false,
    ]);
    blockSamples.push(summarizeBlock(block));
  }

  const windowBlocks = config.transferWindowBlocks;
  const fromBlock = toHex(latest - windowBlocks + 1);
  const threshold = config.logsTruncationThreshold;
  const tokens = [];
  for (const token of config.watchlist) {
    try {
      const logs = await rpcCall(endpoints, 'eth_getLogs', [
        {
          fromBlock,
          toBlock: latestHex,
          address: token.address,
          topics: [TRANSFER_TOPIC],
        },
      ]);
      tokens.push({ symbol: token.symbol, ...summarizeTransfers(logs, token.decimals, { threshold }) });
    } catch (err) {
      if (isLogLimitError(err)) {
        tokens.push({
          symbol: token.symbol,
          suspectedTruncation: true,
          count: 0,
          uniqueSenders: 0,
          totalAmount: 0,
          largest: null,
        });
      } else {
        throw err;
      }
    }
  }

  return {
    latestBlock: latest,
    fee: summarizeFeeHistory(feeHistory),
    blockSamples,
    transfers: { windowBlocks, tokens },
  };
}

// 融资信号采集:拉取 → 解析 → 过滤。任何一步抛错均向上传播,由 runOnce 捕获为
// digest.funding = {error} 形态(隔离降级,INV-1),不使既有三板块的采集/渲染/提交受影响。
export async function collectFunding(config, deps = {}) {
  const { fetchImpl = fetch, now, timeZone } = deps;
  const xml = await fetchFundingRss(fetchImpl);
  const { events, parseFailures } = parseFundingEvents(xml, timeZone);
  const filtered = filterFundingEvents(events, { now, timeZone });
  return { events: filtered, parseFailures };
}

function makeDefaultGit(root) {
  function run(...args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  }
  return {
    add(paths) {
      run('add', ...paths);
    },
    status() {
      return run('status', '--porcelain');
    },
    commit(message) {
      run('commit', '-m', message);
    },
    push() {
      run('push');
    },
    hasRemote() {
      return run('remote') !== '';
    },
  };
}

// 外部 cron 日志按大小截断,保留尾部。path 未配置或文件不存在时 no-op、不报错。
// path 支持 ~/ 前缀(展开为 homedir),使 config 不必携带机器绝对路径。
export function rotateLogIfNeeded(logRotation, { fileExists, readFile, writeFile, fileSize }) {
  if (!logRotation || !logRotation.path) return;
  const path = logRotation.path.startsWith('~/')
    ? join(homedir(), logRotation.path.slice(2))
    : logRotation.path;
  if (!fileExists(path)) return;
  const size = fileSize(path);
  if (!shouldTruncateLog(size, logRotation.maxBytes)) return;
  const content = readFile(path, 'utf8');
  const keepBytes = Math.max(0, Math.floor(logRotation.maxBytes / 2));
  writeFile(path, content.slice(-keepBytes));
}

// 单次运行的编排:注入全部副作用依赖,返回 { ok, reason? }。
// 成功路径:写报告 + STATUS.md,git add -A 全量提交。
// 失败路径(非 noCommit):仅写并提交 reports/STATUS.md,不提交缺失/残缺报告。
export async function runOnce(deps) {
  const {
    config,
    now,
    noCommit = false,
    root = ROOT,
    collectFn = collect,
    rpcCall = defaultRpcCall,
    readFile = readFileSync,
    writeFile = writeFileSync,
    mkdir = mkdirSync,
    fileExists = existsSync,
    fileSize = (p) => statSync(p).size,
    git = makeDefaultGit(root),
    fetchImpl = fetch,
    env = process.env,
    logger = console,
  } = deps;

  const timeZone = config.reportTimeZone || 'Asia/Shanghai';

  rotateLogIfNeeded(config.logRotation, { fileExists, readFile, writeFile, fileSize });

  const dateStr = reportDateStr(now, timeZone);
  const reportsDir = join(root, 'reports');
  const statusPath = join(reportsDir, 'STATUS.md');

  // tracked 产物的唯一写盘出口:落盘前统一脱敏,使运行时错误信息(采集失败原因、融资错误)
  // 携带的本机绝对路径不进仓库。无路径的正常内容原样通过,报告字节不变。
  const writeReportFile = (path, content) => writeFile(path, sanitizePaths(content));

  let digest;
  try {
    digest = {
      dateStr,
      generatedAt: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      ...(await collectFn(config, { rpcCall })),
    };
  } catch (err) {
    mkdir(reportsDir, { recursive: true });
    writeReportFile(statusPath, buildStatus({ ok: false, at: now.toISOString(), reason: err.message }));
    await notifySlack(`chain-pulse 采集失败(${dateStr}): ${err.message}`, { env, fetchImpl }).catch(() => {});

    if (!noCommit) {
      git.add(['reports/STATUS.md']);
      git.commit(`chain-pulse: ${dateStr} failed`);
      if (git.hasRemote()) {
        try {
          git.push();
        } catch (pushErr) {
          logger.error('[chain-pulse] push 失败(保留本地提交):', pushErr.message);
        }
      }
    }
    return { ok: false, reason: err.message };
  }

  try {
    digest.funding = await collectFunding(config, { fetchImpl, now, timeZone });
  } catch (err) {
    digest.funding = { error: err.message };
  }

  const report = renderReport(digest);
  mkdir(reportsDir, { recursive: true });
  writeReportFile(join(reportsDir, `${dateStr}.md`), report);
  writeReportFile(join(reportsDir, 'latest.md'), report);
  writeReportFile(statusPath, buildStatus({ ok: true, at: now.toISOString(), latestBlock: digest.latestBlock }));
  logger.log(`[chain-pulse] 报告已写入 reports/${dateStr}.md(最新区块 #${digest.latestBlock})`);

  if (noCommit) return { ok: true };

  git.add(['-A']);
  const staged = git.status();
  if (!staged) {
    logger.log('[chain-pulse] 无变更,跳过 commit');
    return { ok: true };
  }
  git.commit(`chain-pulse: ${dateStr} auto`);
  const hasRemote = git.hasRemote();
  if (hasRemote) {
    try {
      git.push();
    } catch (err) {
      logger.error('[chain-pulse] push 失败(保留本地提交):', err.message);
    }
  }
  logger.log('[chain-pulse] 已 commit' + (hasRemote ? ' 并尝试 push' : '(无 remote,仅本地)'));
  return { ok: true };
}

async function main() {
  const config = JSON.parse(readFileSync(join(ROOT, 'config/config.json'), 'utf8'));
  const noCommit = process.argv.includes('--no-commit');
  const result = await runOnce({ config, now: new Date(), noCommit, root: ROOT });
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[chain-pulse] 运行失败:', err);
    process.exit(1);
  });
}
