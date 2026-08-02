// 纯函数层:融资 RSS 解析、金额语境锚定解析、7 天窗过滤、VC/wallet 标签匹配。零副作用,可离线单测。
// 2026-08-02 调整:金额/VC 从「过滤门槛」降级为「⭐ 标注」——源是编辑精选低流量 RSS,
// 按金额拦截会把标题不带数字的真官宣一并丢掉;宽召回全量出报,取舍留给晨检(人/agent)。
import { reportDateStr } from './orchestration.mjs';

// VC 名单(模块内常量,不进 config.json,详见 spec 契约⑤)。
export const TIER1_VCS = ['Paradigm', 'a16z', 'Pantera', 'Polychain', 'Coinbase Ventures'];
export const ASIA_VCS = ['Dragonfly', 'HashKey Capital', 'Spartan Group'];

// 仅匹配紧随融资动词的 $ 数值(如 "raises $38M"),避免估值/流入等非融资语境金额误判。
const FUNDING_AMOUNT_RE = /\b(?:raises?|raised|lands?|secures?|closes?)\s+\$\s*([\d.,]+)\s*([MB])\b/i;

function decodeHtmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripCdataAndDecode(raw) {
  const s = raw.trim();
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return decodeHtmlEntities(m ? m[1] : s);
}

function extractTag(itemXml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = itemXml.match(re);
  return m ? stripCdataAndDecode(m[1]) : '';
}

// 从 RSS2.0 XML 中抽取各 item 的 title/link/pubDate/description(CDATA 已剥离、常见 HTML 实体已解码)。
export function extractRawItems(xml) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    items.push({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link'),
      pubDate: extractTag(block, 'pubDate'),
      description: extractTag(block, 'description'),
    });
  }
  return items;
}

// 仅取紧随融资动词的 $ 数值,$…M→×10^6、$…B→×10^9;解析不出/非融资语境金额置 null。
export function parseAmountUsd(title) {
  const m = title.match(FUNDING_AMOUNT_RE);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(num)) return null;
  const mult = m[2].toUpperCase() === 'B' ? 1_000_000_000 : 1_000_000;
  return Math.round(num * mult);
}

// title+description 全文大小写不敏感包含匹配,命中打 tier1/asia/wallet 标签,同一事件可带多个。
export function extractTags(fullText) {
  const lower = fullText.toLowerCase();
  const tags = [];
  if (TIER1_VCS.some((v) => lower.includes(v.toLowerCase()))) tags.push('tier1');
  if (ASIA_VCS.some((v) => lower.includes(v.toLowerCase()))) tags.push('asia');
  if (lower.includes('wallet')) tags.push('wallet');
  return tags;
}

// 单条归一化:announcedDate 由 pubDate 按 timeZone 推导。坏 pubDate 时 reportDateStr 对 Invalid Date
// 抛 RangeError,向上传播供 parseFundingEvents 做单条 try/catch(INV-4),不在此吞错。
function normalizeEvent(raw, timeZone) {
  const announcedDate = reportDateStr(new Date(raw.pubDate), timeZone);
  return {
    title: raw.title,
    link: raw.link,
    announcedDate,
    amountUsd: parseAmountUsd(raw.title),
    tags: extractTags(`${raw.title} ${raw.description}`),
  };
}

// 解析整份 RSS 为归一化事件数组。单条字段坏(如 pubDate 无法归窗)计入 parseFailures,
// 不使整体解析升级为失败;extractRawItems 本身若抛错(整体解析失败)则不捕获、向上传播。
export function parseFundingEvents(xml, timeZone) {
  const rawItems = extractRawItems(xml);
  const events = [];
  let parseFailures = 0;
  for (const raw of rawItems) {
    try {
      events.push(normalizeEvent(raw, timeZone));
    } catch {
      parseFailures++;
    }
  }
  return { events, parseFailures };
}

function daysBeforeDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export const HIGHLIGHT_AMOUNT_USD = 5_000_000;
const MAX_EVENTS = 40;

// 保留 announcedDate 落在近 7 天窗(含当日,日界按 timeZone,基准为注入的 now)的**全部**事件,
// 金额 ≥ 5M 或 VC 名单(tier1/asia)命中只置 highlight 标注、不再拦截;wallet 标签不触发 highlight。
// 排序 highlight 优先、组内按 announcedDate 降序;超过 maxEvents 截断防灌爆,截断数计入 omitted。
export function prepareFundingEvents(events, { now, timeZone, maxEvents = MAX_EVENTS }) {
  const todayStr = reportDateStr(now, timeZone);
  const cutoffStr = daysBeforeDateStr(todayStr, 6);
  const inWindow = events
    .filter((e) => e.announcedDate >= cutoffStr && e.announcedDate <= todayStr)
    .map((e) => ({
      ...e,
      highlight:
        (e.amountUsd !== null && e.amountUsd >= HIGHLIGHT_AMOUNT_USD) ||
        e.tags.includes('tier1') ||
        e.tags.includes('asia'),
    }));
  inWindow.sort((a, b) => {
    if (a.highlight !== b.highlight) return a.highlight ? -1 : 1;
    if (a.announcedDate !== b.announcedDate) return a.announcedDate < b.announcedDate ? 1 : -1;
    return 0;
  });
  return {
    events: inWindow.slice(0, maxEvents),
    omitted: Math.max(0, inWindow.length - maxEvents),
  };
}
