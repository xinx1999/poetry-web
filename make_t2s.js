// 生成繁简转换表：只保留数据集中真正用到的字，体积从 1.1MB 降到几十 KB。
// 用法：node make_t2s.js <charset.txt> <输出.js>
const fs = require('fs');
const OpenCC = require('opencc-js');

const [, , charsetPath, outPath] = process.argv;
if (!charsetPath || !outPath) {
  console.error('用法: node make_t2s.js <charset.txt> <out.js>');
  process.exit(1);
}

const cn2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
const t2cn = OpenCC.Converter({ from: 'tw', to: 'cn' });

const chars = Array.from(fs.readFileSync(charsetPath, 'utf8'));

// 双向合并：每个字 -> 它的另一种写法（可能是多个）
const table = {};
for (const c of chars) {
  const t = cn2t(c);
  if (t !== c) {
    table[c] = table[c] || [];
    if (!table[c].includes(t)) table[c].push(t);
  }
  const s = t2cn(c);
  if (s !== c) {
    table[c] = table[c] || [];
    if (!table[c].includes(s)) table[c].push(s);
  }
}

const header =
  '// 繁简转换映射表（由 make_t2s.js 自动生成，勿手改）\n' +
  '// 只覆盖数据集中实际出现的字，故体积远小于完整 OpenCC 词典。\n' +
  '// 每项为「该字的其它写法」数组，搜索时用来生成繁简变体。\n';
fs.writeFileSync(outPath, header + 'const T2S_MAP = ' + JSON.stringify(table) + ';\n', 'utf8');

const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`  映射表 ${Object.keys(table).length.toLocaleString()} 字，${kb} KB`);
