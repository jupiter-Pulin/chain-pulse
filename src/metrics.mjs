// 纯函数层:RPC 原始返回 → 指标。不碰网络,全部可离线单测。

export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

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
export function decodeTransferLog(log, decimals) {
  return {
    from: '0x' + log.topics[1].slice(26),
    to: '0x' + log.topics[2].slice(26),
    amount: Number(BigInt(log.data)) / 10 ** decimals,
  };
}

export function summarizeTransfers(logs, decimals) {
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
  };
}
