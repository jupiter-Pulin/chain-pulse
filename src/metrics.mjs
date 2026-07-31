// 纯函数层:RPC 原始返回 → 指标。不碰网络,全部可离线单测。

export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// 精度取舍:此处一律用 Number(BigInt(...)) 转换,对大额 18-decimals 代币存在浮点精度损失。
// 金额仅用于日报展示,不用于精确记账/结算。
export function hexToNumber(hex) {
  return Number(BigInt(hex));
}

export function weiHexToGwei(hex) {
  return Number(BigInt(hex)) / 1e9;
}

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function average(values) {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// eth_feeHistory 返回 { oldestBlock, baseFeePerGas: n+1 项, gasUsedRatio: n 项 }
export function summarizeFeeHistory(feeHistory) {
  const baseFees = feeHistory.baseFeePerGas.slice(0, -1).map(weiHexToGwei);
  const ratios = feeHistory.gasUsedRatio;
  return {
    blocks: ratios.length,
    baseFeeGwei: {
      min: Math.min(...baseFees),
      p50: percentile(baseFees, 50),
      max: Math.max(...baseFees),
      latest: baseFees[baseFees.length - 1],
    },
    gasUsedRatioAvg: average(ratios),
  };
}

// eth_getBlockByNumber(hex, false) 的 header → 采样行
export function summarizeBlock(block) {
  return {
    number: hexToNumber(block.number),
    timestamp: hexToNumber(block.timestamp),
    txCount: block.transactions.length,
    gasUsedRatio: Number(BigInt(block.gasUsed)) / Number(BigInt(block.gasLimit)),
    baseFeeGwei: weiHexToGwei(block.baseFeePerGas),
  };
}

// Transfer(address indexed from, address indexed to, uint256 value)
// from/to 在 topics[1]/topics[2](左补零 32 字节),value 在 data。
// 精度取舍同上:amount 由 Number(BigInt(...)) / 10**decimals 得出,大额代币可能有浮点误差,仅供展示。
export function decodeTransferLog(log, decimals) {
  return {
    from: '0x' + log.topics[1].slice(26),
    to: '0x' + log.topics[2].slice(26),
    amount: Number(BigInt(log.data)) / 10 ** decimals,
  };
}

// logs.length 达到 threshold 视为疑似截断(公共 RPC 对 eth_getLogs 常有条数上限,
// 命中上限时可能静默截断而非报错)。threshold 缺省(undefined)时恒为 false,即关闭该检测。
export function detectLogTruncation(logs, { threshold } = {}) {
  if (logs.length === 0) return false;
  return logs.length >= threshold;
}

const LOG_LIMIT_ERROR_PATTERNS = ['limit exceeded', 'more than', 'response size', 'block range'];

// 识别常见的 eth_getLogs 上限类报错文本,大小写不敏感;可传 Error 对象或纯字符串。
export function isLogLimitError(errorOrMessage) {
  const message =
    typeof errorOrMessage === 'string' ? errorOrMessage : (errorOrMessage?.message ?? '');
  const lower = message.toLowerCase();
  return LOG_LIMIT_ERROR_PATTERNS.some((needle) => lower.includes(needle));
}

export function summarizeTransfers(logs, decimals, { threshold } = {}) {
  const decoded = logs.map((l) => decodeTransferLog(l, decimals));
  const senders = new Set(decoded.map((d) => d.from));
  const largest = decoded.reduce(
    (best, d) => (best === null || d.amount > best.amount ? d : best),
    null,
  );
  return {
    count: decoded.length,
    uniqueSenders: senders.size,
    totalAmount: decoded.reduce((s, d) => s + d.amount, 0),
    largest,
    suspectedTruncation: detectLogTruncation(logs, { threshold }),
  };
}
