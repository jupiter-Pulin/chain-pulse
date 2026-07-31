import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../../src/render.mjs';

const digest = {
  dateStr: '2026-07-29',
  generatedAt: '2026-07-29 18:00 UTC',
  latestBlock: 23000000,
  fee: {
    blocks: 1024,
    baseFeeGwei: { min: 0.5, p50: 1.2, max: 3.4, latest: 1.1 },
    gasUsedRatioAvg: 0.5,
  },
  blockSamples: [
    { number: 22999000, timestamp: 1785000000, txCount: 150, gasUsedRatio: 0.48, baseFeeGwei: 1.0 },
  ],
  transfers: {
    windowBlocks: 50,
    tokens: [
      {
        symbol: 'USDC',
        count: 120,
        uniqueSenders: 80,
        totalAmount: 1234567,
        largest: { amount: 50000, from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      },
      { symbol: 'WETH', count: 0, uniqueSenders: 0, totalAmount: 0, largest: null },
    ],
  },
};

test('renderReport:关键段落齐全', () => {
  const md = renderReport(digest);
  assert.match(md, /# chain-pulse 日报 2026-07-29/);
  assert.match(md, /#23,000,000/);
  assert.match(md, /1\.2 gwei/);
  assert.match(md, /\| USDC \| 120 \| 80 \|/);
  assert.match(md, /0xaaaaaa…aaaa/);
  assert.match(md, /\| WETH \| 0 \| 0 \| 0 \| - \|/); // 空数据不炸
});

test('renderReport:含本地日期语义提示', () => {
  const md = renderReport(digest);
  assert.match(md, /本地生成日期/);
});

test('renderReport:suspectedTruncation 为 true 时该行含可见截断标注,false 时不含', () => {
  const d = {
    ...digest,
    transfers: {
      windowBlocks: 50,
      tokens: [
        { symbol: 'USDT', count: 5000, uniqueSenders: 100, totalAmount: 999999, largest: null, suspectedTruncation: true },
        { symbol: 'USDC', count: 10, uniqueSenders: 5, totalAmount: 100, largest: null, suspectedTruncation: false },
      ],
    },
  };
  const md = renderReport(d);
  assert.match(md, /USDT\s*(⚠|可能截断)/);
  const usdcLine = md.split('\n').find((l) => l.startsWith('| USDC'));
  assert.doesNotMatch(usdcLine, /⚠|可能截断/);
});

test('renderReport:上限错误占位形态渲染安全占位值,不输出 undefined/NaN', () => {
  const d = {
    ...digest,
    transfers: {
      windowBlocks: 50,
      tokens: [{ symbol: 'USDT', suspectedTruncation: true, count: 0, uniqueSenders: 0, totalAmount: 0, largest: null }],
    },
  };
  const md = renderReport(d);
  assert.doesNotMatch(md, /undefined/);
  assert.doesNotMatch(md, /NaN/);
  assert.match(md, /\| USDT ⚠ 可能截断 \| 0 \| 0 \| 0 \| - \|/);
});
