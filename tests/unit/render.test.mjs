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
