# chain-pulse 转 public 审计

本文记录仓库从 private 转 public 前的敏感信息审计:扫了什么、怎么扫的、扫出什么、以及发车前必须逐项确认的清单。审计日期 2026-08-02,覆盖当时全部 10 个 commit(`refs/heads/main`、`refs/remotes/origin/main` 及任务分支)。

## 一、git 全历史敏感串扫描

### 1.1 扫描范围

- **工作树 tracked 文件**:当前 HEAD 检出的全部受版本控制文件。
- **全历史 blob 内容**:`git rev-list --all` 枚举所有 ref 可达的每个 commit,对每个 commit 的树逐一 `git grep`。这覆盖的是**每个 commit 快照的完整内容**,而不只是 diff 增量——一个串即使从未在某次 diff 中新增,只要在那个 commit 的树里存在就会被命中。
- **不在范围内**:commit 元数据(作者名/邮箱/时间)、commit message、`.gitignore` 排除的本地文件(`node_modules/`、`*.log`)、GitHub 侧的 issue/PR/release 文本。元数据的处置见 §2。

### 1.2 扫描模式清单

下表即本次使用的模式清单(POSIX ERE)。为避免本文件自身被这些扫描命中,每个模式的首字符用单字符类包裹:`[s]` 是"只匹配一个字符 `s`"的字符类,与裸写该字符语义完全等价,去掉方括号即为裸写形态。两种写法在本仓上的命中结果一致(均为 0),照抄下表即可复现。

| 模式 | 目标 |
| --- | --- |
| `[s]k-` | OpenAI / Anthropic 风格 API key 前缀 |
| `[g]hp_` | GitHub personal access token |
| `AKIA[0-9A-Z]{16}` | AWS access key ID |
| `-----BEGIN.*[P]RIVATE KEY` | PEM 私钥块头(RSA / EC / OPENSSH / 通用) |
| `xox[bap]-` | Slack bot / app / user token |
| `/[U]sers/` | macOS home 绝对路径(机器路径,非密钥) |

已知误报类:`[s]k-` 会命中一切以该三字符序列结尾的普通英文词(`ta[s]k-`、`ri[s]k-`、`di[s]k-` 等连字符复合词)。本仓 tracked 内容当前 0 命中,但**本仓的部分 commit message 含此类词**,故 §1.3 的扫描不覆盖 message——即便命中也是误报,不必处理。

### 1.3 扫描命令

模式一律经 `-e` 传入:以 `-` 开头的 PEM 模式若直接跟在选项后,会被 `git grep` 当成命令行选项解析而报错。

```bash
PATTERNS='[s]k-|[g]hp_|AKIA[0-9A-Z]{16}|-----BEGIN.*[P]RIVATE KEY|xox[bap]-'

# (1) 当前 tracked 文件
git grep -I -nE -e "$PATTERNS"
git grep -I -nE -e '/[U]sers/'

# (2) 全历史:每个 commit 的完整树
for c in $(git rev-list --all); do
  git grep -I -nE -e "$PATTERNS" "$c" --
  git grep -I -nE -e '/[U]sers/' "$c" --
done | sort -u

# (3) 交叉验证:pickaxe 按 diff 增删定位引入/移除点
git log --all --oneline -S'/[U]sers/' --pickaxe-regex
```

三条都是纯本地操作,不联网。`git grep` 无命中时退出码为 1,是正常结果而非错误。

### 1.4 结论

| 项 | 当前 tracked | 全历史 |
| --- | --- | --- |
| 五类密钥模式 | 0 命中 | 0 命中 |
| macOS home 绝对路径 | 0 命中 | **6 个 commit 命中** |

- **密钥:干净。** 全历史无任何密钥模式命中。设计上也不该有:本仓只读公开链上数据,不持私钥、不接交易接口;唯一的密文类配置 `CHAIN_PULSE_SLACK_WEBHOOK` 只从环境变量读取,`src/notify.mjs` 不把它写进任何文件或报告。
- **机器路径:历史残留,当前已清。** `config/config.json` 的 `logRotation.path` 曾写死为 `/[U]sers/<用户名>/logs/chain-pulse-cron.log` 形态的绝对路径,引入于 `1e3b8b4`,存在于 `1e3b8b4`、`6fc8001`、`74d6db1`、`f5cffbe`、`7d1a84b`、`968662e` 共 6 个 commit,已在 `a914c78` 改为 `~` 前缀写法(由 `src/run.mjs` 展开为当前用户 home)。**这些历史 commit 里的绝对路径不会因当前修复而消失**——处置路线见 §3。
- 泄漏内容的实质:一个 macOS 登录名和一个日志目录名。不含凭据、私钥、内网主机名或 IP,不构成任何访问能力。

## 二、转 public 前逐项检查清单

发车前逐项确认,每项都要么打勾要么写明为何豁免。

- [ ] `git grep -I -nE -e '/[U]sers/'` 对 tracked 文件 0 命中(自动化:`tests/unit/repo-hygiene.test.mjs` 的 AC-001 用例)。
- [ ] 五类密钥模式对 tracked 文件 0 命中(自动化:同文件 AC-002 用例)。
- [ ] `npm test` 全绿,且测试全程离线(无 fetch、无真实 RPC)。
- [ ] README 的安装/运行/调度段落在一台干净机器上从 clone 起可复制执行,不含任何机器特定绝对路径。
- [ ] `config/config.json` 内无绝对路径、无 token、无私有端点(自建/付费 RPC 的 API key URL 尤其要查)。
- [ ] `.gitignore` 覆盖 `node_modules/`、`*.log`、`.DS_Store`;确认没有本地日志或 `.env` 被 tracked(`git ls-files | grep -Ei '\.(log|env)'` 应为空)。
- [ ] `reports/` 下的历史报告只含公开链上数据,不含本机环境信息或错误堆栈里的绝对路径(`reports/STATUS.md` 的失败原因字段是最可能泄漏路径的地方,`git grep -I -nE -e '/[U]sers/' -- reports/` 复查)。
- [ ] 确认接受 commit 元数据公开:作者名与邮箱会随每个 commit 永久可见,`git log --all --format='%an <%ae>' | sort -u` 查看当前清单;不接受则必须走 §3 路线 B。
- [ ] 确认接受 §1.4 的历史机器路径按 §3 选定路线处置(默认路线 A:保留)。
- [ ] 仓库设置侧:确认无 GitHub Actions secrets、无 deploy key、无 webhook 指向私有服务;若有 fork 或镜像,同步处置。
- [ ] LICENSE 存在且与 `package.json` 的 `license` 字段一致(当前为 MIT)。
- [ ] README 不承诺任何数据准确性保证——报告金额用浮点转换,存在精度损失,已在 README 说明。

## 三、历史含机器路径:两条处置路线

§1.4 已确认历史中存在 macOS home 绝对路径。二选一,**默认选路线 A**。

### 路线 A:不重写历史(默认)

**风险评级:低。**理由:

1. **泄漏物无访问价值**。暴露的是一个本机登录名和 `logs/chain-pulse-cron.log` 这个目录结构,不是凭据。攻击者拿到它既不能登录任何东西,也不能定位一台可达主机——本仓没有任何服务在公网监听。
2. **同等信息已从别处可得**。commit 作者邮箱本就随每个 commit 公开;登录名的敏感度不高于此。要真正隐藏身份信息,必须同时重写作者元数据,那已经是路线 B 的成本。
3. **改写的代价高于收益**。重写历史会改变全部 commit SHA。本项目的核心可观测手段就是 git 心跳(`chain-pulse: <date> auto` / `... failed` 提交序列),这串历史本身是"管道连续存活"的证据;重写会让已有的 clone、任何外部引用的 SHA 全部失效,换来的只是隐藏一个登录名。
4. **当前状态已止血**。HEAD 及后续所有 commit 都不再含绝对路径,§2 的自动化用例会防止回归。

步骤:

1. 确认 §2 清单全部打勾。
2. 确认当前 HEAD 干净:`git grep -I -nE -e '/[U]sers/'` 返回空。
3. 在仓库设置里切换 Visibility 为 Public。
4. 转 public 后复查一次 §1.3 的全历史扫描,确认结论与本文一致(转换过程不改历史,应完全一致)。

若后续评级升高(例如某个 commit 被发现含真凭据),不要走路线 A 的补丁式修复——凭据一旦公开即视为已泄漏,应先吊销凭据,再评估路线 B。

### 路线 B:干净起点重建公开仓

适用于:不接受历史中出现登录名/邮箱,或将来扫出过真实凭据。代价是丢弃全部历史(含 git 心跳序列)。

步骤:

1. 在私有仓做最终审计,确保**工作树**完全干净(§1.3 的 tracked 扫描 0 命中)。
2. 建一个孤儿分支,把当前工作树压成单个初始 commit:

   ```bash
   git checkout --orphan public-main
   git add -A
   git commit -m "chain-pulse: initial public snapshot"
   ```

3. 若需同时清理作者元数据,在提交时显式指定:

   ```bash
   git -c user.name="<公开用的名字>" -c user.email="<公开用的邮箱>" \
       commit --author="<公开用的名字> <公开用的邮箱>" -m "chain-pulse: initial public snapshot"
   ```

   注意 committer 与 author 是两个字段,`-c user.*` 管 committer,`--author` 管 author,两个都要设。

4. 在 GitHub 新建一个空的 public 仓(**不要**直接把现有 private 仓转 public,否则旧历史仍在),推送孤儿分支为其默认分支:

   ```bash
   git remote add public <新仓地址>
   git push public public-main:main
   ```

5. 在新仓 clone 一份干净副本,跑 §1.3 的全历史扫描 + `npm test`,确认只有一个 commit 且 0 命中。
6. 原 private 仓保留为内部归档(保住心跳历史),后续开发在新公开仓进行;两边不要互相 `git push`,否则旧历史会被带回。

**变体(保留历史但改写内容)**:若既想留历史又要抹掉那 6 个 commit 里的路径,可用 `git filter-repo --replace-text`(需单独安装,非 git 内置)批量替换,再强推到一个**新建**的空仓。这仍会改变全部 SHA,收益/代价与路线 B 接近,但保留了心跳序列;本文不将其列为默认路线,因为它引入了一个外部工具依赖,且一次误操作就会静默丢数据——若选它,务必先在 `git clone --mirror` 出来的副本上演练。
