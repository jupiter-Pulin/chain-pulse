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

test('renderReport:融资信号板块置于既有三板块之后、页脚之前,表头/截断/null金额/破表字符转义/尾注均正确 (AC-006)', () => {
  const longTitle = 'X'.repeat(40) + '|' + 'Y'.repeat(45) + ' raises $10M';
  const d = {
    ...digest,
    funding: {
      events: [
        { title: longTitle, link: 'https://x.example/a', announcedDate: '2026-07-30', amountUsd: null, tags: ['tier1', 'wallet'] },
        { title: 'Small Deal raises $6M', link: 'https://x.example/b', announcedDate: '2026-07-29', amountUsd: 6_000_000, tags: [] },
      ],
      parseFailures: 2,
    },
  };
  const md = renderReport(d);
  const lines = md.split('\n');

  const idxTransfers = lines.findIndex((l) => l.startsWith('## 稳定币'));
  const idxFunding = lines.findIndex((l) => l.startsWith('## 融资信号'));
  const idxFooter = lines.findIndex((l) => l === '---');
  assert.ok(idxTransfers > -1 && idxFunding > idxTransfers && idxFunding < idxFooter);

  assert.ok(lines.includes('| 公司/项目 | 金额 | 官宣日期 | 标签 | 链接 |'));

  const rowLines = lines.filter((l) => l.startsWith('| X') || l.startsWith('| Small Deal'));
  assert.equal(rowLines.length, 2);

  const longRow = rowLines.find((l) => l.startsWith('| X'));
  assert.match(longRow, /…/); // 超 80 字符截断以省略号收尾
  assert.match(longRow, /X{40}\\\|Y{39}…/); // 破表字符 | 被转义为 \|,不产生残行/错列
  assert.match(longRow, /\| - \| 2026-07-30 \| tier1, wallet \| https:\/\/x\.example\/a \|$/); // null 金额显示 -

  const shortRow = rowLines.find((l) => l.startsWith('| Small Deal'));
  assert.match(shortRow, /\$6,000,000/);

  assert.match(md, /另有 2 条解析失败/);
});

test('renderReport:events 为空(成功空)时改渲染单行占位,不产生表格数据行 (AC-006)', () => {
  const d = { ...digest, funding: { events: [], parseFailures: 0 } };
  const md = renderReport(d);
  assert.match(md, /## 融资信号/);
  assert.match(md, /本期无符合条件的新官宣/);
  assert.doesNotMatch(md, /\| 公司\/项目 \|/);
});

test('renderReport:digest 不含 funding 键时不渲染第4板块,既有三板块行为与渲染不变 (AC-011)', () => {
  const md = renderReport(digest);
  assert.doesNotMatch(md, /## 融资信号/);
  assert.match(md, /# chain-pulse 日报 2026-07-29/);
  assert.match(md, /## Gas 面貌/);
  assert.match(md, /## 区块采样/);
  assert.match(md, /## 稳定币\/WETH 转账快照/);
  assert.match(md, /\| USDC \| 120 \| 80 \|/);
});

test('renderReport:funding.error 时第4板块降级为单行错误说明,既有三板块不受影响(补充覆盖)', () => {
  const d = { ...digest, funding: { error: 'HTTP 402' } };
  const md = renderReport(d);
  assert.match(md, /## 融资信号/);
  assert.match(md, /HTTP 402/);
  assert.match(md, /## Gas 面貌/);
  assert.match(md, /## 区块采样/);
  assert.match(md, /## 稳定币\/WETH 转账快照/);
});
