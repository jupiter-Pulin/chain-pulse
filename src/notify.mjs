// 可选 Slack 告警。仅当环境变量 CHAIN_PULSE_SLACK_WEBHOOK 存在时推送,缺失则跳过且不报错。
// webhook 值只从环境变量读取,不写入任何文件或报告。

export async function notifySlack(message, { env = process.env, fetchImpl = fetch } = {}) {
  const webhook = env.CHAIN_PULSE_SLACK_WEBHOOK;
  if (!webhook) return;
  await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });
}
