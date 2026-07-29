// rpc 层可测部分:退避序列与错误结构。网络调用不在单测范围。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, RpcError } from '../../src/rpc.mjs';

test('backoffDelay:指数增长 500/1000/2000', () => {
  assert.equal(backoffDelay(0), 500);
  assert.equal(backoffDelay(1), 1000);
  assert.equal(backoffDelay(2), 2000);
});

test('RpcError 携带 code 与 endpoint', () => {
  const e = new RpcError('boom', { code: -32000, endpoint: 'https://x' });
  assert.equal(e.name, 'RpcError');
  assert.equal(e.code, -32000);
  assert.equal(e.endpoint, 'https://x');
});
