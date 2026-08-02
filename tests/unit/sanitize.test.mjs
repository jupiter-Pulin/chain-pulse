// 路径脱敏单测:helper 本身的替换/不替换边界,以及走真实写盘管道(注入临时目录)后
// 落盘产物不含本机家目录。全程离线:采集/融资依赖均为注入的 fake,不触网、不碰 git。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizePaths } from '../../src/sanitize.mjs';
import { runOnce } from '../../src/run.mjs';
import { renderReport } from '../../src/render.mjs';
import { buildStatus } from '../../src/orchestration.mjs';

const HOME = process.env.HOME || homedir();
const silentLogger = { log() {}, error() {} };
const NOW = new Date('2026-07-31T18:20:00Z'); // Asia/Shanghai 下报告日期为 2026-08-01

const okDigest = {
  latestBlock: 100,
  fee: { blocks: 1, baseFeeGwei: { min: 1, p50: 1, max: 1, latest: 1 }, gasUsedRatioAvg: 0.5 },
  blockSamples: [],
  transfers: { windowBlocks: 50, tokens: [] },
};

function makeTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'chain-pulse-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// 真实写盘:不注入 writeFile/mkdir,让 runOnce 走 node:fs 默认实现,只把 root 指向临时目录。
function realWriteDeps(root) {
  return { root, noCommit: true, now: NOW, env: {}, logger: silentLogger };
}

test('sanitizePaths:/Users/<用户名> 前缀与 HOME 实际值均收敛为 ~ (AC-001)', () => {
  assert.equal(sanitizePaths('/Users/fakeuser/logs/x.log'), '~/logs/x.log');
  assert.equal(
    sanitizePaths("ENOENT: open '/Users/fakeuser/logs/x.log'"),
    "ENOENT: open '~/logs/x.log'",
  );
  // HOME 未必在 /Users 下(Linux),显式注入时同样脱敏
  assert.equal(sanitizePaths('/home/alice/logs/x.log', '/home/alice'), '~/logs/x.log');
  assert.equal(sanitizePaths(`${HOME}/logs/chain-pulse.log`), '~/logs/chain-pulse.log');
});

test('sanitizePaths:链上地址/URL/已是 ~ 的写法保持原样 (AC-001)', () => {
  const untouched = [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'https://cointelegraph.com/rss/tag/funding',
    'https://example.com/Users/foo/bar',
    '~/logs/x.log',
    'rpc 超时',
  ];
  for (const s of untouched) assert.equal(sanitizePaths(s, '/home/alice'), s);
});

test('runOnce:采集失败原因中的本机路径落盘前被脱敏 (AC-002/AC-003)', async (t) => {
  const root = makeTempRoot(t);
  const collectFn = async () => {
    throw new Error(
      `ENOENT: no such file or directory, open '/Users/fakeuser/logs/x.log' (cron log: ${HOME}/logs/chain-pulse.log)`,
    );
  };
  const result = await runOnce({ ...realWriteDeps(root), config: {}, collectFn });

  assert.equal(result.ok, false);
  const status = readFileSync(join(root, 'reports', 'STATUS.md'), 'utf8');
  assert.match(status, /结果: failed\(失败\)/);
  assert.ok(!status.includes('/Users/'), `STATUS.md 仍含 /Users/: ${status}`);
  assert.ok(!status.includes(HOME), `STATUS.md 仍含 HOME 实际值: ${status}`);
  assert.match(status, /~\/logs\/x\.log/);
  assert.match(status, /~\/logs\/chain-pulse\.log/);
});

test('runOnce:日报里的融资错误字段落盘前被脱敏 (AC-002/AC-003)', async (t) => {
  const root = makeTempRoot(t);
  const failingFetch = async () => {
    throw new Error(`funding rss 缓存读取失败: /Users/fakeuser/cache/rss.xml, ${HOME}/cache/rss.xml`);
  };
  const result = await runOnce({
    ...realWriteDeps(root),
    config: { watchlist: [] },
    collectFn: async () => okDigest,
    fetchImpl: failingFetch,
  });

  assert.equal(result.ok, true);
  const report = readFileSync(join(root, 'reports', '2026-08-01.md'), 'utf8');
  assert.match(report, /融资信号采集失败/);
  assert.ok(!report.includes('/Users/'), `日报仍含 /Users/: ${report}`);
  assert.ok(!report.includes(HOME), `日报仍含 HOME 实际值: ${report}`);
  assert.match(report, /~\/cache\/rss\.xml/);
});

test('runOnce:正常(无错误)路径下报告与 STATUS 内容逐字节不变 (AC-002)', async (t) => {
  const root = makeTempRoot(t);
  const emptyRss = async () => ({ ok: true, text: async () => '<rss></rss>' });
  const result = await runOnce({
    ...realWriteDeps(root),
    config: { watchlist: [] },
    collectFn: async () => okDigest,
    fetchImpl: emptyRss,
  });

  assert.equal(result.ok, true);
  const expectedReport = renderReport({
    dateStr: '2026-08-01',
    generatedAt: '2026-07-31 18:20 UTC',
    ...okDigest,
    funding: { events: [], parseFailures: 0 },
  });
  assert.equal(readFileSync(join(root, 'reports', '2026-08-01.md'), 'utf8'), expectedReport);
  assert.equal(readFileSync(join(root, 'reports', 'latest.md'), 'utf8'), expectedReport);
  assert.equal(
    readFileSync(join(root, 'reports', 'STATUS.md'), 'utf8'),
    buildStatus({ ok: true, at: NOW.toISOString(), latestBlock: 100 }),
  );
});
