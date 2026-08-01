// 融资 RSS 拉取:传输层,风格仿 rpc.mjs(AbortController + setTimeout 超时,非 200 抛错)。
// 数据源为 Cointelegraph 融资标签 RSS(人审裁决替换 DefiLlama /raises,详见 spec「数据源裁决」)。

export const FUNDING_RSS_URL = 'https://cointelegraph.com/rss/tag/funding';
const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchFundingRss(
  fetchImpl = fetch,
  { timeoutMs = DEFAULT_TIMEOUT_MS, url = FUNDING_RSS_URL } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
