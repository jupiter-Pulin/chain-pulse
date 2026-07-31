// 纯函数层:digest 对象 → Markdown 日报。日期由调用方传入,保证可测。

function fmt(n, digits = 2) {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function shortAddr(addr) {
  return addr.slice(0, 8) + '…' + addr.slice(-4);
}

export function renderReport(digest) {
  const { dateStr, generatedAt, latestBlock, fee, blockSamples, transfers } = digest;
  const lines = [];
  lines.push(`# chain-pulse 日报 ${dateStr}`);
  lines.push('');
  lines.push(`> 生成于 ${generatedAt} · 最新区块 #${fmt(latestBlock, 0)} · 数据源:公共 JSON-RPC(只读)`);
  lines.push('');
  lines.push('> 报告日期为本地生成日期(非 UTC 切片),数据覆盖运行前的采样/转账窗口,而非该日历日全天数据。');
  lines.push('');

  lines.push(`## Gas 面貌(近 ${fee.blocks} 块 ≈ ${Math.round((fee.blocks * 12) / 60)} 分钟)`);
  lines.push('');
  lines.push('| 指标 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| Base fee 中位数 | ${fmt(fee.baseFeeGwei.p50)} gwei |`);
  lines.push(`| Base fee 区间 | ${fmt(fee.baseFeeGwei.min)} ~ ${fmt(fee.baseFeeGwei.max)} gwei |`);
  lines.push(`| 最新 base fee | ${fmt(fee.baseFeeGwei.latest)} gwei |`);
  lines.push(`| 平均 gas 使用率 | ${fmt(fee.gasUsedRatioAvg * 100, 1)}% |`);
  lines.push('');

  lines.push('## 区块采样(约每 3.3 小时取 1 块,近 24h 趋势)');
  lines.push('');
  lines.push('| 区块 | 时间(UTC) | 交易数 | gas 使用率 | base fee |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const b of blockSamples) {
    const t = new Date(b.timestamp * 1000).toISOString().slice(5, 16).replace('T', ' ');
    lines.push(
      `| #${fmt(b.number, 0)} | ${t} | ${b.txCount} | ${fmt(b.gasUsedRatio * 100, 1)}% | ${fmt(b.baseFeeGwei)} gwei |`,
    );
  }
  lines.push('');

  lines.push(`## 稳定币/WETH 转账快照(最近 ${transfers.windowBlocks} 块 ≈ ${Math.round((transfers.windowBlocks * 12) / 60)} 分钟)`);
  lines.push('');
  lines.push('| 代币 | 转账笔数 | 独立发送方 | 总量 | 最大单笔 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const t of transfers.tokens) {
    const truncatedMark = t.suspectedTruncation ? ' ⚠ 可能截断' : '';
    const largest = t.largest
      ? `${fmt(t.largest.amount)} (${shortAddr(t.largest.from)})`
      : '-';
    lines.push(
      `| ${t.symbol}${truncatedMark} | ${fmt(t.count, 0)} | ${fmt(t.uniqueSenders, 0)} | ${fmt(t.totalAmount, 0)} | ${largest} |`,
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('*chain-pulse:零依赖 Node 管道,裸 JSON-RPC 采集,ERC-20 事件手工解码。仅只读数据,不接任何交易接口。*');
  lines.push('');
  return lines.join('\n');
}
