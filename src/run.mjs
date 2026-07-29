// 编排层:采集 → 聚合 → 渲染 → 落盘 → git 固化。
// 用法:node src/run.mjs [--no-commit]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rpcCall } from './rpc.mjs';
import {
  TRANSFER_TOPIC,
  hexToNumber,
  summarizeFeeHistory,
  summarizeBlock,
  summarizeTransfers,
} from './metrics.mjs';
import { renderReport } from './render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config/config.json'), 'utf8'));
const noCommit = process.argv.includes('--no-commit');

function toHex(n) {
  return '0x' + n.toString(16);
}

async function collect() {
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
  const tokens = [];
  for (const token of config.watchlist) {
    const logs = await rpcCall(endpoints, 'eth_getLogs', [
      {
        fromBlock,
        toBlock: latestHex,
        address: token.address,
        topics: [TRANSFER_TOPIC],
      },
    ]);
    tokens.push({ symbol: token.symbol, ...summarizeTransfers(logs, token.decimals) });
  }

  return {
    latestBlock: latest,
    fee: summarizeFeeHistory(feeHistory),
    blockSamples,
    transfers: { windowBlocks, tokens },
  };
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

async function main() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const digest = {
    dateStr,
    generatedAt: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    ...(await collect()),
  };

  const report = renderReport(digest);
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  writeFileSync(join(ROOT, 'reports', `${dateStr}.md`), report);
  writeFileSync(join(ROOT, 'reports', 'latest.md'), report);
  console.log(`[chain-pulse] 报告已写入 reports/${dateStr}.md(最新区块 #${digest.latestBlock})`);

  if (noCommit) return;
  git('add', '-A');
  const staged = git('status', '--porcelain');
  if (!staged) {
    console.log('[chain-pulse] 无变更,跳过 commit');
    return;
  }
  git('commit', '-m', `chain-pulse: ${dateStr} auto`);
  const hasRemote = git('remote') !== '';
  if (hasRemote) {
    try {
      git('push');
    } catch (err) {
      console.error('[chain-pulse] push 失败(保留本地提交):', err.message);
    }
  }
  console.log('[chain-pulse] 已 commit' + (hasRemote ? ' 并尝试 push' : '(无 remote,仅本地)'));
}

main().catch((err) => {
  console.error('[chain-pulse] 运行失败:', err);
  process.exit(1);
});
