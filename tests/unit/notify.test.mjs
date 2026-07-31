// Slack 告警单测,全部注入 fake fetch/env,禁网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifySlack } from '../../src/notify.mjs';

test('notifySlack:webhook 缺失时直接跳过,不调用 fetch、不抛错', async () => {
  let called = false;
  await notifySlack('hello', {
    env: {},
    fetchImpl: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
});

test('notifySlack:webhook 存在时向该地址 POST 一次', async () => {
  const calls = [];
  await notifySlack('hello', {
    env: { CHAIN_PULSE_SLACK_WEBHOOK: 'https://hooks.slack.test/x' },
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://hooks.slack.test/x');
  assert.equal(calls[0].opts.method, 'POST');
});
