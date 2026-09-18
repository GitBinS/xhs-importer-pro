// 回归测试：单元测试 + frontmatter 渲染（调用真实插件方法，不手抄逻辑）
//
// 用法：cd xhs-importer-pro && node dev/verify.mjs
// 改完 main.js 必跑。失败时退出码为 1。
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

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
const Plugin = mod.default;

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
// 时区回归：凌晨必须算当天。曾用 new Date().toISOString()（UTC）算「创建日期」，
// 东八区 00:00–08:00 导入会写成前一天。这条用本地构造的 00:43，与机器时区无关。
check('凌晨 00:43 算作当天（不是前一天）', T.formatPublishDate(new Date(2026, 8, 19, 0, 43).getTime()), '2026-09-19');

console.log('\n--- 2. normalizeCount（缺失不能是 0，否则污染看板排序）---');
check('字符串数字', T.normalizeCount('265'), '265');
check('真实零保留', T.normalizeCount('0'), '0');
check('undefined → 空', T.normalizeCount(undefined), '');
check('空串 → 空', T.normalizeCount(''), '');
check('null → 空', T.normalizeCount(null), '');

console.log('\n--- 3. sanitizeFilenamePreserveEmoji ---');
const emojiTitle = '董姐太🐮了；昏迷式睡了14个小时，太爽了❗';
const out = T.sanitizeFilenamePreserveEmoji(emojiTitle);
check('emoji 是否保留', /🐮/.test(out) && /❗/.test(out), 'true');
console.log(`       原文字符数: ${Array.from(emojiTitle).length} / 结果: ${out}`);
check('非法字符被替换', T.sanitizeFilenamePreserveEmoji('a<b>c:d/e'), 'a-b-c-d-e');
check('emoji 不被截断', Array.from(T.sanitizeFilenamePreserveEmoji('🎉'.repeat(60))).length, 50);

console.log('\n--- 4. 链接提取 ---');
const L1 = 'https://www.xiaohongshu.com/discovery/item/6aa000bc000000002b00194b?xsec_source=app_share&xsec_token=AAA=';
const L2 = 'https://www.xiaohongshu.com/discovery/item/6aa6802500000000280001a3?xsec_source=pc_share&xsec_token=BBB=';
const S1 = 'https://xhslink.com/a/AbCdEf';
check('长链+短链混合', T.extractAllXHSURLs(`看看${L1} 还有 ${S1} 很好`).length, 2);
check('两条长链', T.extractAllXHSURLs(`${L1}\n${L2}`).length, 2);
check('同链去重', T.extractAllXHSURLs(`${L1} ${L1} ${L2}`).length, 2);
check('非小红书域名忽略', T.extractAllXHSURLs('https://www.baidu.com/abc').length, 0);
check('空文本', T.extractAllXHSURLs('').length, 0);

console.log('\n--- 5. 正文清理 ---');
check('tab 伪空行', T.normalizeContentLines('a\n\t\nb'), 'a\n\nb');
check('行尾空白', T.normalizeContentLines('a   \nb'), 'a\nb');
check('连续空行压缩', T.normalizeContentLines('a\n\n\n\n\nb'), 'a\n\nb');
// 小红书用不可见字符伪造空行，其中 U+200B / U+3164 不属 \s → /^\s+$/ 判不出来
check('U+3164 韩文填充符（ㅤ）伪空行', T.normalizeContentLines('a\n\u3164\nb'), 'a\n\nb');
check('U+200B 零宽空格伪空行', T.normalizeContentLines('a\n\u200b\nb'), 'a\n\nb');
check('行尾不可见字符被清掉', T.normalizeContentLines('a\u3164\nb'), 'a\nb');
check('行内不可见字符保留（不误删正文）', T.normalizeContentLines('a\u200bb'), 'a\u200bb');

console.log(`\n单元测试: ${pass} 通过 / ${fail} 失败\n`);

// —— 渲染测试：调用**真实插件方法**（不是手抄的副本），离线可跑 ——
console.log('=== frontmatter 渲染（真实插件方法 / 固定测试配置）===');

const inst = Object.create(Plugin.prototype);
// 固定测试配置：证明占位符 → 字段 的映射生效，不依赖库内 data.json
inst.settings = {
  frontmatterFields: [
    { key: 'type', value: 'raw', enabled: true, order: 0 },
    { key: 'aliases', value: '', enabled: true, order: 1 },
    { key: '创建日期', value: '{{date}}', enabled: true, order: 2 },
    { key: '发布日期', value: '{{publishDate}}', enabled: true, order: 3 },
    { key: '博主', value: '{{author}}', enabled: true, order: 4 },
    { key: '笔记链接', value: '{{source}}', enabled: true, order: 5 },
    { key: '点赞', value: '{{likedCount}}', enabled: true, order: 6 },
    { key: '收藏', value: '{{collectedCount}}', enabled: true, order: 7 },
    { key: '评论', value: '{{commentCount}}', enabled: true, order: 8 },
    { key: '转发', value: '{{shareCount}}', enabled: true, order: 9 },
    { key: 'tags', value: '- 类型/摘录\n- 状态/待加工', enabled: true, order: 10 },
    { key: '上级概念', value: '', enabled: true, order: 11 },
  ],
};

const note = {
  noteId: '6aa000bc000000002b00194b',
  user: { nickname: '十月的星星', userId: '6992cc78000000002100b023' },
  time: Date.UTC(2026, 8, 8),
  ipLocation: '浙江',
  type: 'normal',
  interactInfo: { likedCount: '1252', collectedCount: '708', commentCount: '293', shareCount: '51' },
  tagList: [{ name: '助眠' }, { name: '精油' }],
};

const ctx = inst.buildPlaceholderContext({
  title: '示例标题', source: 'https://xhslink.cn/o/xxxx', date: '2026-09-18', videoUrl: '', note,
});
const rendered = inst.buildFrontmatter(ctx);
console.log('\n' + rendered + '\n');

let rpass = 0, rfail = 0;
const rcheck = (name, cond) => {
  cond ? rpass++ : rfail++;
  console.log(`  ${cond ? '✅' : '❌'} ${name}`);
};
rcheck('type: raw 写在首行', rendered.startsWith('---\ntype: raw'));
rcheck('创建日期 有值', rendered.includes('创建日期: 2026-09-18'));
rcheck('发布日期 格式化正确', rendered.includes('发布日期: 2026-09-08'));
rcheck('博主 正确', rendered.includes('博主: 十月的星星'));
rcheck('笔记链接 有值', rendered.includes('笔记链接: https://xhslink.cn/o/xxxx'));
rcheck('点赞 有值', rendered.includes('点赞: 1252'));
rcheck('收藏 有值', rendered.includes('收藏: 708'));
rcheck('评论 有值', rendered.includes('评论: 293'));
rcheck('转发 有值', rendered.includes('转发: 51'));
rcheck('中文键不加引号（YAML 合法）', !rendered.includes('"创建日期"') && !rendered.includes("'点赞'"));
rcheck('tags 多行缩进正确', rendered.includes('tags:\n  - 类型/摘录\n  - 状态/待加工'));
// 守门：除 Obsidian 内置（aliases/tags）与看板锚点（type）外，不应再有英文键
rcheck(
  '英文键已清空（仅剩 type / aliases / tags）',
  !/^(created|published|author|source|likes|saves|comments|shares):/m.test(rendered),
);

// 数据缺失的边界：不能出现 undefined，也不能伪装成 0
const edge = Object.create(Plugin.prototype);
edge.settings = inst.settings;
const edgeOut = edge.buildFrontmatter(
  edge.buildPlaceholderContext({
    title: 't', source: 's', date: '2026-09-18', videoUrl: '',
    note: { noteId: 'y', user: { nickname: 'n' }, interactInfo: {} },
  }),
);
rcheck('缺失计数不出现 undefined', !edgeOut.includes('undefined'));
rcheck('缺失计数渲染为空键（不是 0）', /^点赞:$/m.test(edgeOut) && /^收藏:$/m.test(edgeOut));

// 已知限制（固化为测试）：占位符名必须保持 ASCII。
// replacePlaceholders() 用 /\{\{(\w+)\}\}/，JS 的 \w 只含 [A-Za-z0-9_]，
// 中文占位符会**静默不替换**、原样留在笔记里。
// 若哪天把正则放宽到 [^}]+，这条会失败 —— 那时才说明中文占位符可用了。
const ph = Object.create(Plugin.prototype);
ph.settings = {
  frontmatterFields: [{ key: '点赞', value: '{{点赞数}}', enabled: true, order: 0 }],
};
rcheck('中文占位符不被替换（故占位符保持英文）', ph.buildFrontmatter(ctx).includes('{{点赞数}}'));
ph.settings.frontmatterFields = [{ key: '点赞', value: '{{likedCount}}', enabled: true, order: 0 }];
rcheck('英文占位符正常替换（对照）', ph.buildFrontmatter(ctx).includes('点赞: 1252'));

console.log(`\n渲染测试: ${rpass} 通过 / ${rfail} 失败`);

// —— 设置页占位符说明表：与 buildPlaceholderContext 逐一对齐 ——
// 守门作用：新增占位符却忘了在设置页写说明时，这里会失败。
const ctxKeys = Object.keys(ctx);
const docNames = T.PLACEHOLDER_DOCS.map(([n]) => n.replace(/\{\{|\}\}/g, ''));
const undocumented = ctxKeys.filter((k) => !docNames.includes(k));
const stale = docNames.filter((k) => !ctxKeys.includes(k));
let dpass = 0, dfail = 0;
const dcheck = (name, cond, detail) => {
  cond ? dpass++ : dfail++;
  console.log(`  ${cond ? '✅' : '❌'} ${name}${cond ? '' : ` → ${detail}`}`);
};
console.log('\n=== 设置页占位符说明表 ===');
dcheck(`全部占位符都有说明（共 ${ctxKeys.length} 个）`, undocumented.length === 0, `缺说明: ${undocumented.join(', ')}`);
dcheck('没有过期的说明项', stale.length === 0, `已失效: ${stale.join(', ')}`);
dcheck('说明表非空且无重复', T.PLACEHOLDER_DOCS.length === ctxKeys.length && new Set(docNames).size === docNames.length, `表内 ${T.PLACEHOLDER_DOCS.length} 项`);
console.log(`\n说明表检查: ${dpass} 通过 / ${dfail} 失败`);

// —— 可选：读库内真实配置做一次对照（跨设备无该路径时自动跳过）——
const VAULT_CFG = 'E:/第二大脑/.obsidian/plugins/xhs-importer-pro/data.json';
try {
  if (fs.existsSync(VAULT_CFG)) {
    const cfg = JSON.parse(fs.readFileSync(VAULT_CFG, 'utf8'));
    const keys = inst.normalizeFrontmatterFields(cfg.frontmatterFields).map((f) => f.key);
    console.log('\n库内实际配置字段:', keys.join(', '));
    const countOk = ['点赞', '收藏', '评论', '转发'].every((k) => keys.includes(k));
    const nameOk = ['创建日期', '发布日期', '博主', '笔记链接'].every((k) => keys.includes(k));
    const merged = keys.includes('stats') || keys.includes('统计');
    // type / aliases / tags 是必需保留的英文键（看板 filter 锚点 + Obsidian 内置属性）
    const leftovers = ['created', 'published', 'author', 'source', 'likes', 'saves', 'comments', 'shares']
      .filter((k) => keys.includes(k));
    console.log(`  ${countOk && !merged ? '✅' : '⚠️'} 互动计数为 4 个独立中文键（点赞/收藏/评论/转发）`);
    console.log(`  ${nameOk ? '✅' : '⚠️'} 日期/博主/链接已中文化（创建日期 / 发布日期 / 博主 / 笔记链接）`);
    console.log(
      `  ${leftovers.length === 0 ? '✅' : '⚠️'} 英文键残留: ${leftovers.length ? leftovers.join(', ') : '无（type/aliases/tags 属必需保留）'}`,
    );
  } else {
    console.log('\n（未找到库内插件配置，跳过对照）');
  }
} catch (e) {
  console.log('\n（读库内配置失败，跳过:', e.message + '）');
}

const totalFail = fail + rfail + dfail;
process.exitCode = totalFail > 0 ? 1 : 0;
console.log(`\n总计: 通过 ${pass + rpass + dpass} / 失败 ${totalFail}`);
