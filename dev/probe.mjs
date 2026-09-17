// 小红书无登录可采字段探测
//
// 用法: node dev/probe.mjs <分享链接> [更多链接...]
//
// ⚠️ 必须用「分享链接」——App 里「分享 → 复制链接」，或网页版的分享按钮。
//    不能用浏览器地址栏里复制的 explore/<id>?xsec_token=... —— 那种 token 绑定登录会话，
//    裸请求必被拦（302 → 登录页 或 error_code 300031）。
//
// 实测结论（2026-09-17）：无登录可拿到标题 / 正文 / 图片 / 视频直链 / 发布时间 / IP 属地 /
// 作者昵称 / 点赞·收藏·评论·分享数 / 话题标签。评论区内容需要登录。
import process from 'node:process';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (args.length === 0) {
  console.log('用法: node dev/probe.mjs <分享链接> [更多链接...]');
  console.log('提示: 必须用分享链接；浏览器地址栏链接的 token 绑会话，会被 302 拦掉。');
  process.exit(1);
}

const TARGETS = {};
args.forEach((u, i) => {
  TARGETS[`目标 ${i + 1}`] = u;
});

function summarize(label, v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === 'object') return `Object{${Object.keys(v).slice(0, 10).join(',')}}`;
  return JSON.stringify(v).slice(0, 70);
}

async function probe(name, url) {
  console.log(`\n${'='.repeat(60)}\n===== ${name} =====`);
  let r, t;
  try {
    r = await fetch(url, { redirect: 'manual', headers: HEADERS });
    t = await r.text();
  } catch (e) {
    console.log('  fetch 失败:', e.message);
    return;
  }
  console.log(`  HTTP ${r.status} / ${t.length} 字节`);
  const loc = r.headers.get('location');
  if (loc) console.log('  → 重定向到:', loc.slice(0, 90));
  if (t.length < 1000) { console.log('  响应体过短，内容:', t.slice(0, 200)); return; }

  const m = t.match(/window\.__INITIAL_STATE__=(.*?)<\/script>/s);
  if (!m) { console.log('  ❌ 未找到 __INITIAL_STATE__'); return; }

  let state;
  try {
    state = JSON.parse(m[1].trim().replace(/undefined/g, 'null'));
  } catch (e) {
    console.log('  ❌ JSON 解析失败:', e.message, '长度', m[1].length);
    return;
  }

  console.log('  ✅ __INITIAL_STATE__ 解析成功');
  console.log('  顶层 keys:', Object.keys(state).join(', '));

  const ndm = state?.note?.noteDetailMap;
  if (!ndm) { console.log('  ❌ 无 note.noteDetailMap'); return; }

  const maps = Object.entries(ndm);
  console.log(`  noteDetailMap 条目: ${maps.length}`);
  for (const [id, entry] of maps) {
    const note = entry?.note;
    console.log(`  ── entry[${id.slice(0, 12)}] keys: ${Object.keys(entry || {}).join(',')}`);
    if (!note) { console.log('     (无 note 对象)'); continue; }
    console.log(`     === note 全字段 ===`);
    for (const [k, v] of Object.entries(note)) console.log(`       ${k.padEnd(22)} ${summarize(k, v)}`);
    console.log('     === 关键值 ===');
    console.log('       title       :', note.title);
    console.log('       desc        :', (note.desc || '').replace(/\n/g, ' | ').slice(0, 140));
    console.log('       type        :', note.type);
    console.log('       time        :', note.time, note.time ? new Date(note.time).toISOString().slice(0, 10) : '');
    console.log('       ipLocation  :', note.ipLocation);
    console.log('       author      :', note.user?.nickname, '/', note.user?.userId);
    console.log('       interact    :', JSON.stringify(note.interactInfo));
    console.log('       图片数       :', note.imageList?.length ?? 0);
    console.log('       视频        :', note.video ? `有 (${Object.keys(note.video).join(',')})` : '无');
    if (note.video) {
      const st = note.video.media?.stream;
      console.log('       视频直链     :', st?.h264?.[0]?.masterUrl?.slice(0, 80) ?? st?.h265?.[0]?.masterUrl?.slice(0, 80) ?? '未找到');
    }
    console.log('       标签        :', (note.tagList || []).map((x) => x.name || x.title).join(' / '));
  }

  // 评论是否随页面下发
  console.log('  ── 评论相关 ──');
  console.log('     state.comment 存在:', !!state.comment);
  if (state.comment) console.log('     comment keys:', Object.keys(state.comment).join(','));
  const commentHit = (t.match(/commentList|subComments|comments"/g) || []).length;
  console.log('     页面内 comment 相关字段命中数:', commentHit);
}

(async () => {
  for (const [name, url] of Object.entries(TARGETS)) await probe(name, url);
  console.log('\n完成');
})();
