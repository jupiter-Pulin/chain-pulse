// 编排层用的纯函数:报告日期计算、状态文本组装、日志截断判定。零副作用,可离线单测。

// 用 IANA 时区显式计算本地日期,避免 `Date#toISOString().slice(0,10)` 的 UTC 越界:
// 本机 UTC+8 场景下,凌晨(如 02:20)本地触发时对应的 UTC 瞬时仍是前一日。
export function reportDateStr(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

// outcome: { ok, at, latestBlock?, reason? } → 写入 reports/STATUS.md 的文本。
export function buildStatus({ ok, at, latestBlock, reason }) {
  const lines = ['# chain-pulse 运行状态', ''];
  lines.push(`- 时间: ${at}`);
  if (ok) {
    lines.push('- 结果: ok(成功)');
    lines.push(`- 最新区块: #${latestBlock}`);
  } else {
    lines.push('- 结果: failed(失败)');
    lines.push(`- 原因: ${reason}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function shouldTruncateLog(sizeBytes, maxBytes) {
  return sizeBytes > maxBytes;
}
