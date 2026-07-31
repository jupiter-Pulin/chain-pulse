// 编排层纯函数单测,禁网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportDateStr, buildStatus, shouldTruncateLog } from '../../src/orchestration.mjs';

test('reportDateStr:UTC+8 凌晨场景跨日,结果不同于 UTC 切片', () => {
  const d = new Date('2026-07-31T18:20:00Z');
  const local = reportDateStr(d, 'Asia/Shanghai');
  assert.equal(local, '2026-08-01');
  assert.notEqual(local, d.toISOString().slice(0, 10));
});

test('reportDateStr:UTC 时区与 UTC 切片一致', () => {
  const d = new Date('2026-07-31T18:20:00Z');
  assert.equal(reportDateStr(d, 'UTC'), '2026-07-31');
});

test('buildStatus:成功态含时间戳、ok 标识与最新区块号', () => {
  const s = buildStatus({ ok: true, at: '2026-07-31T02:20:00.000Z', latestBlock: 23000000 });
  assert.match(s, /2026-07-31T02:20:00\.000Z/);
  assert.match(s, /ok/);
  assert.match(s, /23000000/);
});

test('buildStatus:失败态含时间戳、失败标识与原因文本', () => {
  const s = buildStatus({ ok: false, at: '2026-07-31T02:20:00.000Z', reason: 'RPC 超时' });
  assert.match(s, /2026-07-31T02:20:00\.000Z/);
  assert.match(s, /failed/);
  assert.match(s, /RPC 超时/);
});

test('shouldTruncateLog:超阈值为 true,等于或小于为 false', () => {
  assert.equal(shouldTruncateLog(200, 100), true);
  assert.equal(shouldTruncateLog(100, 100), false);
  assert.equal(shouldTruncateLog(50, 100), false);
});
