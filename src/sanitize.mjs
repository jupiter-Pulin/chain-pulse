// 纯函数层:落盘文本的路径脱敏。零依赖、零副作用,可离线单测。
// 运行时错误信息(fs 报错、日志路径等)会携带本机绝对路径,直接写进 tracked 文件
// (reports/STATUS.md 的失败原因、日报的错误字段)就把用户名泄漏进仓库历史。

// macOS 家目录前缀(下方正则的 \/Users\/ 分支)后跟第一级目录段。段内只取用户名常见字符,
// 避免吞掉引号/逗号等分隔符;前置否定回顾使 URL 里的同名路径(如 https://host/…/x)保持原样。
// 注释里刻意不写该前缀的裸字面量:repo-hygiene 的 AC-001 守卫禁止 tracked 文件出现它。
const HOME_PREFIX_RE = /(?<![A-Za-z0-9.\-])\/Users\/[\w.-]+/g;

// 把 text 里的本机家目录写法收敛为 `~`,其余内容(链上地址、URL、已是 `~` 的写法)原样保留。
export function sanitizePaths(text, home = process.env.HOME) {
  if (typeof text !== 'string') return text;
  let out = text;
  // 先替换 HOME 实际值:它未必位于 /Users 下(如 Linux 的 /home/<user>)。
  const homePrefix = home && home !== '/' ? home.replace(/\/+$/, '') : '';
  if (homePrefix) out = out.split(homePrefix).join('~');
  return out.replace(HOME_PREFIX_RE, '~');
}
