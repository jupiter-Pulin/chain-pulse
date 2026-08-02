// 仓库卫生单测(转 public 预备),禁网络:只跑本地 git grep 与读文件。
// 所有扫描模式的首字符用单字符类包裹(如 `[U]sers`),正则语义与裸写完全等价,
// 但可避免本文件自身被这些扫描命中。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 对 tracked 文件跑 git grep -I -nE,返回命中行。无命中时 git 退出码为 1。
// 模式一律经 -e 传入,否则以 `-` 开头的模式(PEM 头)会被当成命令行选项。
function grepTracked(pattern) {
  const res = spawnSync('git', ['grep', '-I', '-nE', '-e', pattern], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(
    res.status === 0 || res.status === 1,
    `git grep 执行异常(status=${res.status}): ${res.stderr}`,
  );
  return res.stdout.trim();
}

const SECRET_PATTERNS = [
  '[s]k-',
  '[g]hp_',
  'AKIA[0-9A-Z]{16}',
  '-----BEGIN.*[P]RIVATE KEY',
  'xox[bap]-',
];

test('AC-001:tracked 文件不含 macOS home 绝对路径', () => {
  assert.equal(grepTracked('/[U]sers/'), '');
});

test('AC-002:tracked 文件不含常见密钥模式', () => {
  for (const pattern of SECRET_PATTERNS) {
    assert.equal(grepTracked(pattern), '', `密钥模式命中:${pattern}`);
  }
});

test('AC-003:README 对陌生 clone 者可跑通,日志路径统一 $HOME 写法', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

  // 安装:前置条件 + 可复制的 clone 命令
  assert.match(readme, /^## 安装/m);
  assert.match(readme, /git clone/);
  assert.match(readme, /Node/);

  // 运行:三条 npm 脚本
  for (const cmd of ['npm test', 'npm run dry', 'npm run run']) {
    assert.ok(readme.includes(cmd), `README 缺少运行命令:${cmd}`);
  }

  // 调度:LaunchAgent 从生成到装载到卸载,命令可复制执行
  assert.match(readme, /LaunchAgents/);
  assert.match(readme, /StartCalendarInterval/);
  assert.match(readme, /launchctl load/);
  assert.match(readme, /launchctl unload/);

  // 日志路径统一 $HOME/logs/... ,不出现 ~ 前缀写法
  assert.ok(
    readme.includes('$HOME/logs/chain-pulse-cron.log'),
    'README 缺少 $HOME/logs/chain-pulse-cron.log 日志路径',
  );
  assert.ok(!readme.includes('~/logs'), 'README 仍有 ~/ 前缀的日志路径写法');
  assert.ok(!readme.includes('~/Library'), 'README 仍有 ~/ 前缀的 LaunchAgents 路径写法');
});

test('AC-004:审计文档记录全历史扫描、检查清单与两条处置路线', () => {
  const path = join(ROOT, 'docs/public-release-audit.md');
  assert.ok(existsSync(path), '缺少 docs/public-release-audit.md');
  const doc = readFileSync(path, 'utf8');

  // (a) 全历史扫描方法与结论
  assert.match(doc, /git rev-list --all/);
  assert.match(doc, /结论/);
  for (const pattern of SECRET_PATTERNS) {
    assert.ok(doc.includes(pattern), `审计文档缺少扫描模式:${pattern}`);
  }

  // (b) 逐项检查清单
  const checklistItems = doc.match(/^- \[ \] /gm) || [];
  assert.ok(checklistItems.length >= 5, `检查清单条目过少:${checklistItems.length}`);

  // (c) 两条路线 + 默认路线的风险评级理由
  assert.match(doc, /不重写历史/);
  assert.match(doc, /干净起点重建公开仓/);
  assert.match(doc, /风险评级/);
});

test('AC-005:零依赖,package.json 不声明任何依赖', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.ok(!(field in pkg), `package.json 出现依赖字段:${field}`);
  }
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    assert.ok(!existsSync(join(ROOT, lock)), `出现锁文件:${lock}`);
  }
});
