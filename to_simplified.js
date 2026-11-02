/**
 * 把 data/ 下所有数据转成简体。
 *
 * 为什么在数据层做、而不是前端显示时逐字替换：
 * 繁简不是一一对应，「乾」在「乾坤」里读 qián 不能转成「干」，
 * 在「乾燥」里才转「干」。逐字替换会把「乾坤」变成「干坤」。
 * opencc 整句转换会看词组，只有它才判得准。
 *
 * 用法（在 poetry-web 目录）：node to_simplified.js
 * 顺序：build_data.py → to_simplified.js → build_tags.js → build_themes.js
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const t2cn = OpenCC.Converter({ from: 'tw', to: 'cn' });

let changed = 0;
const conv = (s) => {
  if (typeof s !== 'string' || !s) return s;
  const r = t2cn(s);
  if (r !== s) changed++;
  return r;
};

// 两套字段名都要处理：正文库用 t/a/p，featured.json 用 title/author/paragraphs。
// 只认 t/a/p 会让 646 首每日推荐原封不动留成繁体。
function convPoem(p) {
  const o = { ...p };
  for (const k of ['t', 'a', 'title', 'author']) {
    if (typeof o[k] === 'string') o[k] = conv(o[k]);
  }
  for (const k of ['p', 'paragraphs']) {
    if (Array.isArray(o[k])) o[k] = o[k].map(conv);
  }
  if (Array.isArray(o.tags)) o.tags = o.tags.map(conv);
  return o;
}

// ---------- inline_data.js ----------
const inlinePath = 'data/inline_data.js';
const raw = fs.readFileSync(inlinePath, 'utf8');
const INLINE = new Function(raw + '; return INLINE_DATA;')();
for (const k of Object.keys(INLINE)) {
  INLINE[k] = INLINE[k].map(convPoem);
}
fs.writeFileSync(
  inlinePath,
  'const INLINE_DATA = ' + JSON.stringify(INLINE) + ';\n',
  'utf8'
);
console.log(`  inline_data.js  ${(fs.statSync(inlinePath).size / 1048576).toFixed(1)} MB`);

// ---------- 宋诗分片 ----------
const shardDir = 'data/song_shards';
let shardCount = 0;
for (const f of fs.readdirSync(shardDir)) {
  if (!f.endsWith('.json') || f === 'manifest.json') continue;
  const fp = path.join(shardDir, f);
  const list = JSON.parse(fs.readFileSync(fp, 'utf8')).map(convPoem);
  fs.writeFileSync(fp, JSON.stringify(list), 'utf8');
  shardCount++;
}
console.log(`  song_shards/  ${shardCount} 片`);

// ---------- 小文件 ----------
const featured = JSON.parse(fs.readFileSync('data/featured.json', 'utf8')).map(convPoem);
fs.writeFileSync('data/featured.json', JSON.stringify(featured), 'utf8');

const poets = JSON.parse(fs.readFileSync('data/poets.json', 'utf8'));
for (const k of Object.keys(poets)) {
  poets[k] = poets[k].map(p => ({ ...p, name: conv(p.name) }));
}
fs.writeFileSync('data/poets.json', JSON.stringify(poets), 'utf8');

for (const name of ['tags.json', 'themes.json']) {
  const fp = 'data/' + name;
  if (!fs.existsSync(fp)) continue;
  const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) out[k] = v.map(convPoem);
    else if (v && v.works) out[k] = { ...v, works: v.works.map(convPoem) };
    else out[k] = v;
  }
  fs.writeFileSync(fp, JSON.stringify(out), 'utf8');
}

console.log(`  改动字符串 ${changed.toLocaleString()} 处`);
console.log('完成。');
