# chain-pulse

夜间自动运行的 EVM 链上数据日报管道。每晚 cron 触发:采集以太坊主网公开数据 → 聚合指标 → 生成 Markdown 日报 → git 固化。

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

## 运行

```bash
npm test        # 离线单测
npm run dry     # 跑一次但不 commit
npm run run     # 完整流程(采集+报告+commit)
```

## 架构

```
src/rpc.mjs      传输层:JSON-RPC over fetch,故障转移+退避
src/metrics.mjs  纯函数层:原始返回 → 指标(全部可离线单测)
src/render.mjs   纯函数层:digest → Markdown
src/run.mjs      编排层:采集 → 聚合 → 渲染 → 落盘 → git
```

调度:crontab 每晚 02:20 运行,日志在 `~/logs/chain-pulse-cron.log`。
