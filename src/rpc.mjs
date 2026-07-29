// 最小 JSON-RPC 客户端:多端点故障转移 + 指数退避,零依赖。
// 刻意不用 ethers —— 走裸 HTTP 通道,协议层自己扛。

const DEFAULT_TIMEOUT_MS = 15_000;

export class RpcError extends Error {
  constructor(message, { code, endpoint } = {}) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.endpoint = endpoint;
  }
}

let nextId = 1;

async function post(endpoint, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new RpcError(`HTTP ${res.status}`, { endpoint });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 第 n 次重试前的等待毫秒数:500, 1000, 2000, ...
export function backoffDelay(attempt, baseMs = 500) {
  return baseMs * 2 ** attempt;
}

/**
 * 调用 JSON-RPC 方法。每次失败换下一个端点重试(轮转),共 retries+1 次尝试。
 * opts.sleep 可注入,测试时替换为空函数。
 */
export async function rpcCall(endpoints, method, params = [], opts = {}) {
  const {
    retries = endpoints.length,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const endpoint = endpoints[attempt % endpoints.length];
    try {
      const json = await post(
        endpoint,
        { jsonrpc: '2.0', id: nextId++, method, params },
        timeoutMs,
      );
      if (json.error) {
        throw new RpcError(json.error.message, { code: json.error.code, endpoint });
      }
      return json.result;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(backoffDelay(attempt));
    }
  }
  throw lastErr;
}
