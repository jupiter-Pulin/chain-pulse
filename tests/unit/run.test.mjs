// 编排层单测:全部依赖(rpcCall/collect/fs/git/fetch/env/时钟)注入 fake,禁网络、禁真实 git、
// 不写工作区外文件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { collect, runOnce, rotateLogIfNeeded } from '../../src/run.mjs';

function makeFakeFs(initialFiles = {}) {
  const files = { ...initialFiles };
  return {
    files,
    fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => files[p],
    writeFile: (p, content) => {
      files[p] = content;
    },
    mkdir: () => {},
    fileSize: (p) => Buffer.byteLength(files[p] || ''),
  };
}

function makeFakeGit(staged = 'M reports/STATUS.md') {
  const calls = { add: [], commit: [], push: 0 };
  return {
    calls,
    add: (paths) => calls.add.push(paths),
    status: () => staged,
    commit: (msg) => calls.commit.push(msg),
    push: () => {
      calls.push++;
    },
    hasRemote: () => true,
  };
}

const silentLogger = { log() {}, error() {} };

const testConfig = {
  endpoints: ['http://fake-endpoint'],
  sampleBlocks: { count: 1, stepBlocks: 1000 },
  feeHistoryBlocks: 10,
  transferWindowBlocks: 50,
  logsTruncationThreshold: 3,
  watchlist: [
    { symbol: 'USDC', address: '0xUSDC', decimals: 6 },
    { symbol: 'USDT', address: '0xUSDT', decimals: 6 },
  ],
};

async function fakeRpcCall(endpoints, method, params) {
  if (method === 'eth_blockNumber') return '0x64';
  if (method === 'eth_feeHistory') {
    return { baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'], gasUsedRatio: [0.5] };
  }
  if (method === 'eth_getBlockByNumber') {
    return {
      number: '0x64',
      timestamp: '0x1',
      transactions: [],
      gasUsed: '0x1',
      gasLimit: '0x2',
      baseFeePerGas: '0x3b9aca00',
    };
  }
  if (method === 'eth_getLogs') {
    const address = params[0].address;
    if (address === '0xUSDT') throw new Error('query returned more than 10000 results');
    return [];
  }
  throw new Error(`unexpected method ${method}`);
}

test('collect:单 token getLogs 触发上限错误时记为占位截断形态,继续处理其余 token', async () => {
  const result = await collect(testConfig, { rpcCall: fakeRpcCall });
  const usdt = result.transfers.tokens.find((t) => t.symbol === 'USDT');
  assert.deepEqual(usdt, {
    symbol: 'USDT',
    suspectedTruncation: true,
    count: 0,
    uniqueSenders: 0,
    totalAmount: 0,
    largest: null,
  });
  const usdc = result.transfers.tokens.find((t) => t.symbol === 'USDC');
  assert.equal(usdc.suspectedTruncation, false);
  assert.equal(usdc.count, 0);
});

test('collect:非上限类错误照常向上抛出', async () => {
  const rpcCall = async (endpoints, method) => {
    if (method === 'eth_blockNumber') return '0x64';
    throw new Error('connection refused');
  };
  await assert.rejects(() => collect(testConfig, { rpcCall }), /connection refused/);
});

test('runOnce:成功路径写成功态 STATUS 并触发全量 commit', async () => {
  const fakeFs = makeFakeFs();
  const git = makeFakeGit();
  const collectFn = async () => ({
    latestBlock: 100,
    fee: { blocks: 1, baseFeeGwei: { min: 1, p50: 1, max: 1, latest: 1 }, gasUsedRatioAvg: 0.5 },
    blockSamples: [],
    transfers: { windowBlocks: 50, tokens: [] },
  });
  const result = await runOnce({
    config: { watchlist: [] },
    now: new Date('2026-07-31T18:20:00Z'),
    noCommit: false,
    root: '/fake-root',
    collectFn,
    readFile: fakeFs.readFile,
    writeFile: fakeFs.writeFile,
    mkdir: fakeFs.mkdir,
    fileExists: fakeFs.fileExists,
    fileSize: fakeFs.fileSize,
    git,
    env: {},
    fetchImpl: async () => ({ ok: true }),
    logger: silentLogger,
  });

  assert.equal(result.ok, true);
  const statusContent = fakeFs.files[join('/fake-root', 'reports', 'STATUS.md')];
  assert.match(statusContent, /ok/);
  assert.deepEqual(git.calls.add, [['-A']]);
  assert.equal(git.calls.commit.length, 1);
  assert.equal(git.calls.push, 1);
  // 本地日期(Asia/Shanghai)四处一致:文件名、latest.md 内容、commit 信息
  assert.ok(fakeFs.files[join('/fake-root', 'reports', '2026-08-01.md')]);
  assert.match(git.calls.commit[0], /2026-08-01/);
});

test('runOnce:失败路径仅暂存并提交 STATUS.md,不提交缺失报告,并以失败信号收场', async () => {
  const fakeFs = makeFakeFs();
  const git = makeFakeGit();
  const collectFn = async () => {
    throw new Error('rpc 超时');
  };
  const result = await runOnce({
    config: {},
    now: new Date('2026-07-31T18:20:00Z'),
    noCommit: false,
    root: '/fake-root',
    collectFn,
    readFile: fakeFs.readFile,
    writeFile: fakeFs.writeFile,
    mkdir: fakeFs.mkdir,
    fileExists: fakeFs.fileExists,
    fileSize: fakeFs.fileSize,
    git,
    env: {},
    fetchImpl: async () => ({ ok: true }),
    logger: silentLogger,
  });

  assert.equal(result.ok, false);
  const statusContent = fakeFs.files[join('/fake-root', 'reports', 'STATUS.md')];
  assert.match(statusContent, /failed/);
  assert.match(statusContent, /rpc 超时/);
  assert.deepEqual(git.calls.add, [['reports/STATUS.md']]);
  assert.equal(git.calls.commit.length, 1);
  // 未写入任何日报文件
  assert.equal(fakeFs.files[join('/fake-root', 'reports', '2026-08-01.md')], undefined);
});

test('runOnce:--no-commit 失败路径写 STATUS 但完全不触碰 git', async () => {
  const fakeFs = makeFakeFs();
  const git = makeFakeGit();
  const collectFn = async () => {
    throw new Error('boom');
  };
  const result = await runOnce({
    config: {},
    now: new Date('2026-07-31T18:20:00Z'),
    noCommit: true,
    root: '/fake-root',
    collectFn,
    readFile: fakeFs.readFile,
    writeFile: fakeFs.writeFile,
    mkdir: fakeFs.mkdir,
    fileExists: fakeFs.fileExists,
    fileSize: fakeFs.fileSize,
    git,
    env: {},
    fetchImpl: async () => ({ ok: true }),
    logger: silentLogger,
  });

  assert.equal(result.ok, false);
  assert.equal(git.calls.add.length, 0);
  assert.equal(git.calls.commit.length, 0);
  assert.equal(git.calls.push, 0);
});

test('runOnce:push 失败时保留本地 commit,不判整体失败(INV-3)', async () => {
  const fakeFs = makeFakeFs();
  const git = makeFakeGit();
  git.push = () => {
    throw new Error('remote rejected');
  };
  const collectFn = async () => ({
    latestBlock: 1,
    fee: { blocks: 1, baseFeeGwei: { min: 1, p50: 1, max: 1, latest: 1 }, gasUsedRatioAvg: 0.5 },
    blockSamples: [],
    transfers: { windowBlocks: 50, tokens: [] },
  });
  const result = await runOnce({
    config: {},
    now: new Date('2026-07-31T18:20:00Z'),
    noCommit: false,
    root: '/fake-root',
    collectFn,
    readFile: fakeFs.readFile,
    writeFile: fakeFs.writeFile,
    mkdir: fakeFs.mkdir,
    fileExists: fakeFs.fileExists,
    fileSize: fakeFs.fileSize,
    git,
    env: {},
    fetchImpl: async () => ({ ok: true }),
    logger: silentLogger,
  });
  assert.equal(result.ok, true);
  assert.equal(git.calls.commit.length, 1);
});

test('runOnce:融资模块失败(fetchImpl 抛错)时既有三板块照常渲染并提交,报告含错误说明 (AC-009)', async () => {
  const fakeFs = makeFakeFs();
  const git = makeFakeGit();
  const collectFn = async () => ({
    latestBlock: 100,
    fee: { blocks: 1, baseFeeGwei: { min: 1, p50: 1, max: 1, latest: 1 }, gasUsedRatioAvg: 0.5 },
    blockSamples: [],
    transfers: { windowBlocks: 50, tokens: [] },
  });
  const failingFetch = async () => {
    throw new Error('funding rss unreachable');
  };
  const result = await runOnce({
    config: { watchlist: [] },
    now: new Date('2026-07-31T18:20:00Z'),
    noCommit: false,
    root: '/fake-root',
    collectFn,
    readFile: fakeFs.readFile,
    writeFile: fakeFs.writeFile,
    mkdir: fakeFs.mkdir,
    fileExists: fakeFs.fileExists,
    fileSize: fakeFs.fileSize,
    git,
    env: {},
    fetchImpl: failingFetch,
    logger: silentLogger,
  });

  assert.equal(result.ok, true);
  const report = fakeFs.files[join('/fake-root', 'reports', '2026-08-01.md')];
  assert.match(report, /funding rss unreachable/);
  assert.match(report, /## Gas 面貌/);
  assert.ok(fakeFs.files[join('/fake-root', 'reports', 'latest.md')]);
  assert.deepEqual(git.calls.add, [['-A']]);
  assert.equal(git.calls.commit.length, 1);
});

test('runOnce:融资模块失败时 STATUS.md 仍为成功态格式,与融资功能引入前逐字一致 (AC-010)', async () => {
  const fakeFs = makeFakeFs();
  const git = makeFakeGit();
  const collectFn = async () => ({
    latestBlock: 100,
    fee: { blocks: 1, baseFeeGwei: { min: 1, p50: 1, max: 1, latest: 1 }, gasUsedRatioAvg: 0.5 },
    blockSamples: [],
    transfers: { windowBlocks: 50, tokens: [] },
  });
  const failingFetch = async () => ({ ok: false, status: 500 });
  const result = await runOnce({
    config: { watchlist: [] },
    now: new Date('2026-07-31T18:20:00Z'),
    noCommit: false,
    root: '/fake-root',
    collectFn,
    readFile: fakeFs.readFile,
    writeFile: fakeFs.writeFile,
    mkdir: fakeFs.mkdir,
    fileExists: fakeFs.fileExists,
    fileSize: fakeFs.fileSize,
    git,
    env: {},
    fetchImpl: failingFetch,
    logger: silentLogger,
  });

  assert.equal(result.ok, true);
  const statusContent = fakeFs.files[join('/fake-root', 'reports', 'STATUS.md')];
  assert.match(statusContent, /结果: ok\(成功\)/);
  assert.match(statusContent, /最新区块: #100/);
});

test('rotateLogIfNeeded:超阈值截断,保留尾部', () => {
  const fakeFs = makeFakeFs({ '/log.txt': 'x'.repeat(200) });
  rotateLogIfNeeded({ path: '/log.txt', maxBytes: 100 }, fakeFs);
  assert.equal(fakeFs.files['/log.txt'].length, 50);
});

test('rotateLogIfNeeded:path 缺失/未配置/文件不存在/未超限时均为 no-op', () => {
  const fakeFs = makeFakeFs({ '/log.txt': 'short' });
  rotateLogIfNeeded({ path: '/log.txt', maxBytes: 1000 }, fakeFs);
  assert.equal(fakeFs.files['/log.txt'], 'short');
  rotateLogIfNeeded({}, fakeFs);
  assert.equal(fakeFs.files['/log.txt'], 'short');
  rotateLogIfNeeded(null, fakeFs);
  assert.equal(fakeFs.files['/log.txt'], 'short');
  rotateLogIfNeeded({ path: '/missing.txt', maxBytes: 1 }, fakeFs);
  assert.equal(fakeFs.files['/missing.txt'], undefined);
});
