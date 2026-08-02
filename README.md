# chain-pulse

夜间自动运行的数据管道:EVM 链上指标 + 加密融资信号,两个业务模块共享同一套无人值守基础设施(调度/落盘/git 心跳/告警)。每晚 cron 触发:采集以太坊主网公开数据与融资 RSS → 聚合指标 → 生成 Markdown 日报 → git 固化。

## 设计要点

- **零依赖**:仅 Node ≥22 内置能力(`fetch`、`node --test`),不装任何 npm 包
- **裸 JSON-RPC**:不经 ethers/web3 封装,直接走协议层(`eth_blockNumber` / `eth_feeHistory` / `eth_getBlockByNumber` / `eth_getLogs`)
- **手工解码 ERC-20 Transfer 事件**:从 `topics` 抽 indexed 地址、从 `data` 抽 uint256 金额
- **多端点故障转移 + 指数退避**:公共 RPC 不稳定是常态,失败换端点重试
- **测试禁网络**:单测全部离线跑纯函数,fixture 驱动
- **只读**:只查公开链上数据,不持有私钥、不接任何交易/下单接口

## 每日产出

`reports/YYYY-MM-DD.md`(另有 `reports/latest.md` 副本),包含:

1. Gas 面貌:近 1024 块 base fee 分位数 + gas 使用率
2. 区块采样:近 24h 每 ~3.3h 取一块,交易数/gas/base fee 趋势
3. 稳定币/WETH 转账快照:USDC/USDT/WETH 最近 50 块的转账笔数、独立发送方、总量、最大单笔
4. 融资信号:Cointelegraph funding RSS 近 7 天窗全量条目(宽召回,判断留给人工晨检),金额 ≥ $5M 或 VC 名单命中标 ⭐;与链上三板块隔离降级,采集失败不影响主报告

报告日期使用本地时区(默认 `Asia/Shanghai`,可用 `config.reportTimeZone` 覆盖)计算,避免凌晨触发时因 UTC 切片跨日而覆盖前一天的报告。转账金额用 `Number(BigInt(...))` 转换,对大额 18-decimals 代币存在浮点精度损失,仅用于展示,非精确记账。

每次运行(无论成败)都会写 `reports/STATUS.md`,记录本次运行的时间与结果;采集失败时会单独提交该文件,让运行状态经 git 心跳对外可见。

## 安装

前置条件:Node ≥ 22(需要内置 `fetch` 与 `node --test`)、`git`。无需 `npm install`——本仓零依赖,没有 `node_modules`。

```bash
git clone https://github.com/jupiter-Pulin/chain-pulse.git
cd chain-pulse
node -v          # 确认 ≥ v22
npm test         # 离线单测,应全绿
```

可选配置在 `config/config.json`:RPC 端点列表、采样参数、`reportTimeZone`、watchlist。可选环境变量 `CHAIN_PULSE_SLACK_WEBHOOK`,设置后采集失败会推 Slack 告警;不设置则跳过告警,不影响主流程。

## 运行

```bash
npm test        # 离线单测
npm run dry     # 跑一次但不 commit
npm run run     # 完整流程(采集+报告+commit)
```

先跑 `npm run dry` 确认能连上 RPC 端点并写出 `reports/latest.md`,再交给调度。

## 架构

```
src/rpc.mjs           传输层:JSON-RPC over fetch,故障转移+退避
src/metrics.mjs       纯函数层:原始返回 → 指标(全部可离线单测)
src/render.mjs        纯函数层:digest → Markdown
src/orchestration.mjs 纯函数层:报告日期、STATUS.md 文本、日志截断判定
src/notify.mjs        可选 Slack 告警(仅当 CHAIN_PULSE_SLACK_WEBHOOK 存在时推送)
src/run.mjs           编排层:采集 → 聚合 → 渲染 → 落盘 → git(副作用依赖可注入)
```

## 调度(macOS LaunchAgent)

每晚 02:20(本地时间)触发一次,标准输出/错误统一重定向到 `$HOME/logs/chain-pulse-cron.log`。

在**仓库根目录**执行下面这段(会按当前 clone 位置与当前用户生成 plist,无需手工填任何绝对路径):

```bash
mkdir -p "$HOME/logs" "$HOME/Library/LaunchAgents"
PLIST="$HOME/Library/LaunchAgents/local.chain-pulse.plist"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.chain-pulse</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v node)</string>
    <string>$PWD/src/run.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$PWD</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>20</integer></dict>
  <key>StandardOutPath</key><string>$HOME/logs/chain-pulse-cron.log</string>
  <key>StandardErrorPath</key><string>$HOME/logs/chain-pulse-cron.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null   # 已装载过时先卸载,幂等
launchctl load "$PLIST"
launchctl list | grep chain-pulse       # 确认已注册
```

`Label` 可自定义,但要与 plist 文件名保持一致。改完 plist 后重新 `launchctl unload` + `launchctl load` 才会生效。停止调度:`launchctl unload "$PLIST"`。

立刻触发一次(不等到凌晨),用于验证调度链路:

```bash
launchctl start local.chain-pulse
tail -n 50 "$HOME/logs/chain-pulse-cron.log"
```

日志轮转由 `config/config.json` 的 `logRotation` 控制,默认指向上面这个日志文件、超过 5 MiB 时截断保留尾半段(配置里以 `~` 前缀书写,由 `src/run.mjs` 展开为当前用户 home)。

## 运维

### 如何验证它还活着

```bash
# 查看最近几次自动 commit(git 心跳,成功为 "... auto",失败为 "... failed")
git log --oneline -5

# 查看 repo 内运行状态(每次运行无论成败都会更新)
cat reports/STATUS.md

# 查看外部 cron 日志尾部
tail -n 50 "$HOME/logs/chain-pulse-cron.log"
```

若 `git log` 长时间没有新的 `chain-pulse: ... auto`/`... failed` 提交,或 `reports/STATUS.md` 长时间未更新,说明管道已静默死亡,需要人工介入。
