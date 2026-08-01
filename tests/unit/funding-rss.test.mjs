// 融资 RSS 拉取层单测:注入 fetchImpl,网络调用不在单测范围。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFundingRss, FUNDING_RSS_URL } from '../../src/funding-rss.mjs';

test('fetchFundingRss:HTTP 非 200 时向上抛错,不吞错静默返回空 (AC-001)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 402 });
  await assert.rejects(() => fetchFundingRss(fetchImpl), /402/);
});

test('fetchFundingRss:超时/网络错误(fetchImpl 抛错)时向上抛错 (AC-001)', async () => {
  const fetchImpl = async () => {
    throw new Error('network timeout');
  };
  await assert.rejects(() => fetchFundingRss(fetchImpl), /network timeout/);
});

test('fetchFundingRss:成功时请求常量端点并返回响应文本 (AC-001)', async () => {
  let calledUrl;
  const fetchImpl = async (url) => {
    calledUrl = url;
    return { ok: true, text: async () => '<rss></rss>' };
  };
  const text = await fetchFundingRss(fetchImpl);
  assert.equal(text, '<rss></rss>');
  assert.equal(calledUrl, FUNDING_RSS_URL);
});
