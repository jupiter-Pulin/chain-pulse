// 融资纯函数层单测:解析/金额/标签/过滤,手工构造或 RSS 截样 fixture 驱动,禁网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFundingEvents, parseAmountUsd, extractTags, filterFundingEvents } from '../../src/funding.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(HERE, '../fixtures/funding-rss-sample.xml'), 'utf8');

test('parseFundingEvents:解析 RSS 截样,剥 CDATA/解码 HTML 实体,announcedDate 按时区推导 (AC-002)', () => {
  const { events } = parseFundingEvents(fixture, 'Asia/Shanghai');
  assert.equal(events.length, 1);
  const e = events[0];
  assert.deepEqual(Object.keys(e).sort(), ['amountUsd', 'announcedDate', 'link', 'tags', 'title']);
  assert.equal(e.title, 'Velocity raises $38M in Series B funding');
  assert.equal(e.link, 'https://cointelegraph.com/news/velocity-raises-38m');
  assert.equal(e.announcedDate, '2026-07-31');
  assert.equal(e.amountUsd, 38_000_000);
  assert.doesNotMatch(e.title, /CDATA|&amp;/);
});

test('parseFundingEvents:坏 pubDate 单条计入 parseFailures,不升级为整体失败,其余条正常解析保留 (AC-008)', () => {
  const { events, parseFailures } = parseFundingEvents(fixture, 'Asia/Shanghai');
  assert.equal(parseFailures, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].link, 'https://cointelegraph.com/news/velocity-raises-38m');
});

test('parseAmountUsd:紧随融资动词的 $ 值按 M/B 换算,非融资语境金额与无可解析金额置 null (AC-003)', () => {
  assert.equal(parseAmountUsd('Velocity raises $38M in Series B'), 38_000_000);
  assert.equal(parseAmountUsd('Foo raises $1.2B in mega round'), 1_200_000_000);
  assert.equal(
    parseAmountUsd('Kalshi seeks funding at $40B valuation, nearly doubling last raise'),
    null,
  );
  assert.equal(parseAmountUsd('No amount mentioned in this title'), null);
});

test('extractTags:tier1/asia/wallet 全文大小写不敏感包含匹配,同一事件可带多标签 (AC-005)', () => {
  assert.deepEqual(extractTags('Backed by paradigm and building a wallet'), ['tier1', 'wallet']);
  assert.deepEqual(extractTags('Backed by Dragonfly Capital'), ['asia']);
  assert.deepEqual(extractTags('No investor mentioned here'), []);
  assert.deepEqual(extractTags('a16z and HashKey Capital co-led the round for a new wallet'), [
    'tier1',
    'asia',
    'wallet',
  ]);
});

test('filterFundingEvents:保留近 7 天窗内且(金额≥5M 或 VC 命中)的事件,窗外/两条件皆不满足的被剔除 (AC-004)', () => {
  const now = new Date('2026-08-01T10:00:00Z'); // Asia/Shanghai 本地 2026-08-01 18:00
  const events = [
    { title: 'in-window-amount', link: 'l1', announcedDate: '2026-07-31', amountUsd: 6_000_000, tags: [] },
    { title: 'in-window-vc-null-amount', link: 'l2', announcedDate: '2026-07-27', amountUsd: null, tags: ['tier1'] },
    { title: 'in-window-no-hit', link: 'l3', announcedDate: '2026-07-30', amountUsd: 1_000_000, tags: [] },
    { title: 'out-of-window', link: 'l4', announcedDate: '2026-07-25', amountUsd: 10_000_000, tags: [] },
    { title: 'edge-boundary-day7', link: 'l5', announcedDate: '2026-07-26', amountUsd: 5_000_000, tags: [] },
  ];
  const kept = filterFundingEvents(events, { now, timeZone: 'Asia/Shanghai' });
  const keptLinks = kept.map((e) => e.link).sort();
  assert.deepEqual(keptLinks, ['l1', 'l2', 'l5']);
});
