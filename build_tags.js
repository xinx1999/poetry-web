/**
 * 从《唐诗三百首》《宋词三百首》自带 tags 生成 data/tags.json。
 *
 * 数据集里 646 首精选都带主题标签（思乡 35、送别 29、思念 32…），
 * 这是标注好的现成数据，比人工猜主题可靠。全唐诗/全宋诗/全宋词正文库
 * 本身没有 tags，所以主题覆盖范围就是这 646 首 —— 也正是用户想要的「名篇」。
 *
 * 做法：把三百首的 title/author 对到库内完整条目（含正文），
 * 宋词只有词牌没有副题，靠首句定位。
 */
const fs = require('fs');
const OpenCC = require('opencc-js');

const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
const SRC = '../chinese-poetry';

function norm(s) {
  return t2s(String(s || ''))
    .replace(/[\s\u3000]/g, '')
    .replace(/[·・•．.、，,。：:；;！!？?“”"'‘’（）()《》〈〉【】\[\]—\-…]/g, '')
    .toLowerCase();
}

// ---------- 库内索引 ----------
const src = fs.readFileSync('data/inline_data.js', 'utf8');
const INLINE = new Function(src + '; return INLINE_DATA;')();
const CAT_OF = {
  full_tang: 'tang', full_ci: 'ci', full_yuanqu: 'yuanqu',
  full_shijing: 'shijing', full_chuci: 'chuci',
  full_lunyu: 'lunyu', full_mengxue: 'mengxue',
};
const all = [];
for (const [k, list] of Object.entries(INLINE)) {
  for (const p of list) all.push({ cat: CAT_OF[k] || k, t: p.t, a: p.a, p: p.p });
}
const idx = all.map(it => ({ it, nt: norm(it.t), na: norm(it.a), nf: norm((it.p && it.p[0] || '').slice(0, 24)) }));
const byTitle = new Map();
for (const r of idx) {
  if (!byTitle.has(r.nt)) byTitle.set(r.nt, []);
  byTitle.get(r.nt).push(r);
}
const authorOk = (r, na) => r.na.includes(na) || na.includes(r.na);

function match(title, author) {
  const nt = norm(title), na = norm(author);
  let r = (byTitle.get(nt) || []).find(c => authorOk(c, na));
  if (r) return r;
  r = idx.find(c => c.nt.includes(nt) && authorOk(c, na));
  if (r) return r;
  r = idx.find(c => c.nf.includes(nt) && authorOk(c, na));
  return r || null;
}

// ---------- 读三百首 ----------
// 体裁/来源类标签对「按主题找诗」没意义，剔掉
const DROP = /三百首|言律诗|言绝句|言古诗|古诗|乐府|^诗$|^词$|初中|小学|高中|隋|唐$|宋$|五代/;

const tags = {};
const seen = new Set();
const missed = [];

function ingest(file, kind) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const p of list) {
    // 唐诗用 title，宋词用 rhythmic（宋词三百首里 title 是副题，rhythmic 是词牌）
    const title = kind === 'ci'
      ? (p.rhythmic || p.title || '')
      : (p.title || p.rhythmic || '');
    const author = p.author || '';
    const m = match(title, author);
    if (!m) { missed.push(`${title}/${author}`); continue; }
    const key = `${m.it.t}|${m.it.a}`;
    for (const tag of p.tags || []) {
      if (DROP.test(tag)) continue;
      if (!tags[tag]) tags[tag] = [];
      if (seen.has(tag + '::' + key)) continue;
      seen.add(tag + '::' + key);
      tags[tag].push({ t: m.it.t, a: m.it.a, c: m.it.cat, p: m.it.p });
    }
  }
}

ingest(`${SRC}/全唐诗/唐诗三百首.json`, 'tang');
ingest(`${SRC}/宋词/宋词三百首.json`, 'ci');

// 按作品数排序，方便人工核对
const ordered = {};
for (const k of Object.keys(tags).sort((a, b) => tags[b].length - tags[a].length)) {
  ordered[k] = tags[k];
}

const totalWorks = Object.values(ordered).reduce((s, v) => s + v.length, 0);
console.log('标签数', Object.keys(ordered).length, '| 标签-作品对', totalWorks);
console.log('\n前 30 个标签:');
for (const [k, v] of Object.entries(ordered).slice(0, 30)) console.log(`  ${k}: ${v.length}`);
console.log('\n未匹配', missed.length, '首');
for (const m of missed.slice(0, 15)) console.log('  ', m);

fs.writeFileSync('data/tags.json', JSON.stringify(ordered), 'utf8');
console.log(`\n已写 data/tags.json  ${(fs.statSync('data/tags.json').size / 1024).toFixed(1)} KB`);
