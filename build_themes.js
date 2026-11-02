/**
 * 主题候选匹配 v2：加「标题包含」和「正文首句包含」两级回退。
 * 库里大量名篇带组诗前缀（王维《鹿柴》实际叫「輞川集 鹿柴」），
 * 宋词又只有词牌没有副题（《念奴娇·赤壁怀古》只有「念奴娇」），
 * 所以单靠标题精确匹配会漏掉一半。
 */
const fs = require('fs');
const OpenCC = require('opencc-js');

const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

function norm(s) {
  return t2s(String(s || ''))
    .replace(/[\s\u3000]/g, '')
    .replace(/[·・•．.、，,。：:；;！!？?“”"'‘’（）()《》〈〉【】\[\]—\-…]/g, '')
    .toLowerCase();
}

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
for (const f of fs.readdirSync('data/song_shards')) {
  if (!f.endsWith('.json')) continue;
  for (const p of JSON.parse(fs.readFileSync('data/song_shards/' + f, 'utf8'))) {
    all.push({ cat: 'song', t: p.t, a: p.a, p: p.p });
  }
}
console.log('全库条目', all.length, '— 正在预计算归一化索引…');

const idx = all.map(it => ({
  it,
  nt: norm(it.t),
  na: norm(it.a),
  nf: norm((it.p && it.p[0] || '').slice(0, 24)),
}));
const byTitle = new Map();
for (const r of idx) {
  if (!byTitle.has(r.nt)) byTitle.set(r.nt, []);
  byTitle.get(r.nt).push(r);
}

const authorOk = (r, na) => r.na.includes(na) || na.includes(r.na);

function match(title, author) {
  const nt = norm(title);
  const na = norm(author);
  // 1) 标题精确
  let r = (byTitle.get(nt) || []).find(c => authorOk(c, na));
  if (r) return { r, how: '标题精确' };
  // 2) 标题包含（组诗前缀）
  r = idx.find(c => c.nt.includes(nt) && authorOk(c, na));
  if (r) return { r, how: '标题包含' };
  // 3) 正文首句包含（宋词靠首句定位）
  r = idx.find(c => c.nf.includes(nt) && authorOk(c, na));
  if (r) return { r, how: '首句' };
  return null;
}

const THEMES = require('./themes_src.js');
const out = {};
const missing = [];
let total = 0, hitCount = 0;

for (const th of THEMES) {
  const found = [];
  for (const [title, author] of th.works) {
    total++;
    const m = match(title, author);
    if (m) {
      hitCount++;
      // 存完整条目（含正文）：主题名篇要能直接置顶展示，
      // 而宋诗作品在分片里，搜索时未必扫到，不能靠 poemStore 二次查找。
      found.push({ t: m.r.it.t, a: m.r.it.a, c: m.r.it.cat, p: m.r.it.p });
    } else {
      missing.push({ theme: th.name, title, author });
    }
  }
  out[th.name] = { aliases: th.aliases, works: found };
}

console.log(`\n命中 ${hitCount}/${total}`);
console.log('\n=== 未匹配 ===');
for (const m of missing) console.log(`[${m.theme}] ${m.title} / ${m.author}`);
console.log('\n=== 各主题 ===');
for (const [k, v] of Object.entries(out)) console.log(`  ${k}: ${v.works.length}`);

fs.writeFileSync('data/themes.json', JSON.stringify(out), 'utf8');
const sz = fs.statSync('data/themes.json').size;
console.log(`\n已写 data/themes.json  ${(sz / 1024).toFixed(1)} KB`);
