// 纯函数单测,禁网络(继承 will-financial 硬约束)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hexToNumber,
  weiHexToGwei,
  percentile,
  summarizeFeeHistory,
  summarizeBlock,
  decodeTransferLog,
  summarizeTransfers,
  detectLogTruncation,
  isLogLimitError,
} from '../../src/metrics.mjs';

test('hexToNumber / weiHexToGwei', () => {
  assert.equal(hexToNumber('0x10'), 16);
  assert.equal(weiHexToGwei('0x3b9aca00'), 1); // 1e9 wei = 1 gwei
});

test('percentile:空数组返回 null,常规取中位', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([3, 1, 2], 50), 2);
});

test('summarizeFeeHistory:丢弃末尾预测块,统计正确', () => {
  const fh = {
    baseFeePerGas: ['0x3b9aca00', '0x77359400', '0xb2d05e00'], // 1, 2 gwei + 下一块预测
    gasUsedRatio: [0.4, 0.6],
  };
  const s = summarizeFeeHistory(fh);
  assert.equal(s.blocks, 2);
  assert.equal(s.baseFeeGwei.min, 1);
  assert.equal(s.baseFeeGwei.max, 2);
  assert.equal(s.baseFeeGwei.latest, 2);
  assert.equal(s.gasUsedRatioAvg, 0.5);
});

test('summarizeBlock:header 转采样行', () => {
  const b = summarizeBlock({
    number: '0xa',
    timestamp: '0x64',
    transactions: ['0x1', '0x2'],
    gasUsed: '0x5',
    gasLimit: '0xa',
    baseFeePerGas: '0x3b9aca00',
  });
  assert.deepEqual(b, {
    number: 10,
    timestamp: 100,
    txCount: 2,
    gasUsedRatio: 0.5,
    baseFeeGwei: 1,
  });
});

const LOG = (from, to, amountHex) => ({
  topics: [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0x000000000000000000000000' + from,
    '0x000000000000000000000000' + to,
  ],
  data: amountHex,
});

test('decodeTransferLog:topics 抽地址,data 抽金额', () => {
  const d = decodeTransferLog(
    LOG('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '0xf4240'),
    6,
  );
  assert.equal(d.from, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(d.to, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(d.amount, 1); // 1e6 / 10^6
});

test('summarizeTransfers:计数/去重/总量/最大单笔', () => {
  const logs = [
    LOG('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'cccccccccccccccccccccccccccccccccccccccc', '0xf4240'),
    LOG('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'dddddddddddddddddddddddddddddddddddddddd', '0x1e8480'),
    LOG('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccccccccccc', '0x2dc6c0'),
  ];
  const s = summarizeTransfers(logs, 6);
  assert.equal(s.count, 3);
  assert.equal(s.uniqueSenders, 2);
  assert.equal(s.totalAmount, 6);
  assert.equal(s.largest.amount, 3);
  assert.equal(s.largest.from, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
});

test('summarizeTransfers:空日志不炸', () => {
  const s = summarizeTransfers([], 6);
  assert.equal(s.count, 0);
  assert.equal(s.largest, null);
});

test('detectLogTruncation:达到阈值为 true,否则 false,空数组恒 false', () => {
  assert.equal(detectLogTruncation([1, 2, 3], { threshold: 3 }), true);
  assert.equal(detectLogTruncation([1, 2], { threshold: 3 }), false);
  assert.equal(detectLogTruncation([], { threshold: 0 }), false);
});

test('isLogLimitError:识别常见上限报错文本,大小写不敏感;普通错误返回 false', () => {
  assert.equal(isLogLimitError('query returned more than 10000 results'), true);
  assert.equal(isLogLimitError('Response size exceeded'), true);
  assert.equal(isLogLimitError({ message: 'BLOCK RANGE limit exceeded' }), true);
  assert.equal(isLogLimitError('connection timeout'), false);
  assert.equal(isLogLimitError(new Error('socket hang up')), false);
});

test('summarizeTransfers:suspectedTruncation 由阈值判定,不改变既有字段取值', () => {
  const logs = [
    LOG('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'cccccccccccccccccccccccccccccccccccccccc', '0xf4240'),
    LOG('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'dddddddddddddddddddddddddddddddddddddddd', '0x1e8480'),
  ];
  const truncated = summarizeTransfers(logs, 6, { threshold: 2 });
  assert.equal(truncated.suspectedTruncation, true);
  assert.equal(truncated.count, 2);
  assert.equal(truncated.uniqueSenders, 2);
  const notTruncated = summarizeTransfers(logs, 6, { threshold: 10 });
  assert.equal(notTruncated.suspectedTruncation, false);
  assert.equal(notTruncated.count, 2);
});
