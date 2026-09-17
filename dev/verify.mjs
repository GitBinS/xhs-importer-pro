// 验证改造后的 xhs-importer：单元测试 + 端到端 frontmatter 渲染
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// —— mock obsidian（必须在 require main.js 之前）——
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'obsidian') {
    class Noop {}
    return {
      Modal: Noop,
      Notice: class { constructor() {} },
      Plugin: Noop,
      PluginSettingTab: Noop,
      Setting: Noop,
      normalizePath: (p) => p,
      requestUrl: async () => ({ text: '' }),
    };
  }
  return origLoad.call(this, request, ...rest);
};

// 相对本文件解析，跨机器可用。
// （原版写死 `E:/第二大脑/.obsidian/plugins/xhs-importer/main.js` —— 那是旧插件的绝对路径，
//  1.0.12 起本插件已独立成 xhs-importer-pro，该路径下是"上游原版"，测不到任何东西。）
const MAIN = fileURLToPath(new URL('../main.js', import.meta.url));
const mod = require(MAIN);
const T = mod.__test;

console.log('=== 加载成功，导出函数:', Object.keys(T).join(', '), '\n');

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) console.log(`       实际: ${actual}\n       期望: ${expected}`);
  else console.log(`       ${actual}`);
};

console.log('--- 1. formatPublishDate ---');
check('时间戳 → 日期', T.formatPublishDate(1789296677000), '2026-09-13');
check('空值', T.formatPublishDate(null), '');
check('垃圾值', T.formatPublishDate('abc'), '');

console.log('\n--- 2. normalizeCount ---');
check('字符串数字', T.normalizeCount('265'), '265');
check('undefined', T.normalizeCount(undefined), '0');
check('空串', T.normalizeCount(''), '0');

console.log('\n--- 3. sanitizeFilenamePreserveEmoji ---');
const emojiTitle = '董姐太🐮了；昏迷式睡了14个小时，太爽了❗';
const out = T.sanitizeFilenamePreserveEmoji(emojiTitle);
check('emoji 是否保留', /🐮/.test(out) && /❗/.test(out), 'true');
console.log(`       原文字符数: ${Array.from(emojiTitle).length} / 结果: ${out}`);
check('非法字符被替换', T.sanitizeFilenamePreserveEmoji('a<b>c:d/e'), 'a-b-c-d-e');
check('emoji 不被截断', Array.from(T.sanitizeFilenamePreserveEmoji('🎉'.repeat(60))).length, 50);

console.log(`\n单元测试: ${pass} 通过 / ${fail} 失败\n`);

// —— 端到端：抓真实笔记 → 渲染 frontmatter ——
const URL_SHARE = 'https://www.xiaohongshu.com/discovery/item/6aa6802500000000280001a3?source=webshare&xhsshare=pc_web&xsec_token=ABwY4fWUde15BoS_WyRmlJTkLsRQddgErjXb9LRwpDOII=&xsec_source=pc_share';

const HEADERS = T.XHS_REQUEST_HEADERS;

function formatPublishDate(ts) { return T.formatPublishDate(ts); }
function normalizeCount(v) { return T.normalizeCount(v); }

function buildContext({ title, source, date, videoUrl, note }) {
  const interact = note?.interactInfo || {};
  return {
    date: date || '', title: title || '', source: source || '', videoUrl: videoUrl || '',
    noteId: note?.noteId || '', author: note?.user?.nickname || '', authorId: note?.user?.userId || '',
    publishDate: formatPublishDate(note?.time), ipLocation: note?.ipLocation || '',
    noteType: note?.type || '', likedCount: normalizeCount(interact.likedCount),
    collectedCount: normalizeCount(interact.collectedCount), commentCount: normalizeCount(interact.commentCount),
    shareCount: normalizeCount(interact.shareCount),
    noteTags: (note?.tagList || []).map((t) => (typeof t === 'string' ? t : t?.name || '')).filter(Boolean).join(' '),
  };
}

function replacePlaceholders(value, context) {
  return value.replace(/\{\{(\w+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(context, key) ? context[key] : m);
}

function buildFrontmatter(context) {
  const fields = [
    { key: 'aliases', value: '' },
    { key: 'published', value: '{{publishDate}}' },
    { key: 'imported', value: '{{date}}' },
    { key: 'author', value: '{{author}}' },
    { key: 'stats', value: '赞{{likedCount}} 藏{{collectedCount}} 评{{commentCount}}' },
    { key: 'source', value: '{{source}}' },
    { key: 'tags', value: '- 类型/摘录\n- 状态/待加工' },
    { key: '上级概念', value: '' },
  ];
  const lines = ['---'];
  for (const f of fields) {
    const v = replacePlaceholders(f.value, context);
    if (v.trim() === '') { lines.push(`${f.key}:`); continue; }
    if (v.includes('\n')) { lines.push(`${f.key}:`); v.split('\n').forEach((l) => lines.push(`  ${l}`)); continue; }
    lines.push(`${f.key}: ${v}`);
  }
  lines.push('---');
  return lines.join('\n');
}

console.log('=== 端到端：抓真实笔记并渲染 frontmatter ===');
try {
  const r = await fetch(URL_SHARE, { redirect: 'manual', headers: HEADERS });
  const html = await r.text();
  const state = JSON.parse(html.match(/window\.__INITIAL_STATE__=(.*?)<\/script>/s)[1].trim().replace(/undefined/g, 'null'));
  const note = Object.values(state.note.noteDetailMap).map((e) => e?.note).find(Boolean);

  const ctx = buildContext({
    title: note.title, source: URL_SHARE,
    date: new Date().toISOString().slice(0, 10), videoUrl: '', note,
  });

  console.log('\n渲染结果：\n');
  console.log(buildFrontmatter(ctx));
  console.log(`\n# ${note.title}\n`);
  console.log('图片数:', note.imageList?.length, '| 文件名预览:',
    T.sanitizeFilenamePreserveEmoji(note.title) + '-0.jpg');
} catch (e) {
  console.log('端到端失败:', e.message);
}
