/**
 * 诗词站回归测试。
 * 用法（poetry-web 目录）：node test_site.js [端口]
 *
 * 设计原则：每条断言都必须「能挂」——如果实现退化成旧的错误版本，它必须变红。
 * 因此断言尽量卡在具体值上（找到几条、第一条是谁），而不是「大于 0」。
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

/**
 * 自动定位本机已下载的 Chromium。
 * playwright-core 版本与已装浏览器版本常不一致，直接 launch() 会报
 * 「Executable doesn't exist」——这里扫一遍缓存目录，取版本号最大的那个。
 */
function findChromium() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright'),
    path.join(process.env.HOME || '', '.cache', 'ms-playwright'),
    '/c/Users/Admin/AppData/Local/ms-playwright',
  ].filter(Boolean);

  const candidates = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      // 优先完整 chromium，其次 headless shell
      const full = path.join(root, dir, 'chrome-win64', 'chrome.exe');
      const shell = path.join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
      if (fs.existsSync(full)) candidates.push({ p: full, v: parseInt(dir.replace(/\D/g, ''), 10) || 0, full: 1 });
      if (fs.existsSync(shell)) candidates.push({ p: shell, v: parseInt(dir.replace(/\D/g, ''), 10) || 0, full: 0 });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.full - a.full) || (b.v - a.v));
  return candidates[0].p;
}

const PORT = process.argv[2] || 8765;
const BASE = `http://localhost:${PORT}/index.html`;

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else {
    fail++; failures.push(name);
    console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`);
  }
}

async function run() {
  const exe = findChromium();
  if (!exe) {
    console.error('找不到 Chromium，请先 npx playwright install chromium');
    process.exit(1);
  }
  console.log(`浏览器: ${exe}`);
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  const fresh = async () => {
    await page.goto(BASE);
    await page.waitForTimeout(1400);
  };

  const search = async (q, cat) => {
    await page.evaluate(({ q, cat }) => {
      goView('search');
      document.getElementById('search-input').value = q;
      document.getElementById('search-cat').value = cat;
    }, { q, cat });
    await page.evaluate(async () => { await doSearch(); });
    await page.waitForTimeout(400);
  };

  const meta = () => page.evaluate(() => document.getElementById('search-meta').textContent);
  const titles = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.result-item .ri-title')).map(e => e.textContent));
  const authors = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.result-item .ri-author')).map(e => e.textContent));

  // ---------- 首页 ----------
  console.log('\n[首页]');
  await fresh();
  const dailyTitle = await page.textContent('#daily-title');
  check('每日推荐有标题', dailyTitle.trim().length > 0, dailyTitle);
  const dailyLines = await page.locator('#daily-body p').count();
  check('每日推荐正文非空', dailyLines > 0, `${dailyLines} 行`);
  const dateText = await page.textContent('#daily-date');
  check('日期标签含「每日一诗」', dateText.includes('每日一诗'), dateText);

  const catCount = await page.locator('.cat-card').count();
  check('分类卡片 8 个', catCount === 8, String(catCount));

  // 每日推荐按日期固定：同一天刷新两次应一致
  const before = await page.textContent('#daily-title');
  await page.reload(); await page.waitForTimeout(1400);
  const after = await page.textContent('#daily-title');
  check('同日刷新推荐不变（按日期固定）', before === after, `${before} vs ${after}`);

  // 换一首应真的换
  let changed = false;
  for (let i = 0; i < 5 && !changed; i++) {
    await page.click('.refresh-btn');
    await page.waitForTimeout(120);
    if ((await page.textContent('#daily-title')) !== before) changed = true;
  }
  check('「换一首」能换到别的诗', changed);

  // ---------- 繁简搜索 ----------
  console.log('\n[繁简搜索]');
  await fresh();
  await search('静夜思', 'tang');
  const jt = await titles();
  check('简体「静夜思」能搜到繁体唐诗', jt.length === 2, `命中 ${jt.length} 条: ${jt.join(' / ')}`);
  check('结果第一条是《静夜思》', jt[0] === '静夜思', jt[0]);
  const ja = await authors();
  check('《靜夜思》作者是李白', ja[0] && ja[0].includes('李白'), ja[0]);
  const markText = await page.evaluate(() => document.querySelector('.result-item mark')?.textContent);
  check('高亮落在简体字上', markText === '静夜思', markText);

  // 繁体输入也要能用
  await search('靜夜思', 'tang');
  const tt = await titles();
  check('输入繁体「靜夜思」同样能搜到', tt.length === 2 && tt[0] === '静夜思', tt.join(' / '));

  // ---------- 全文展示 ----------
  console.log('\n[全文展示]');
  await search('静夜思', 'tang');
  await page.locator('.result-item').first().click();
  await page.waitForTimeout(300);
  const modalOpen = await page.locator('#modal-overlay.show').count();
  check('点击结果弹出详情', modalOpen === 1);
  const bodyText = await page.evaluate(() => document.getElementById('m-body').textContent);
  check('详情显示完整正文（非截断）', bodyText.length > 10 && bodyText.includes('低头思故乡'), bodyText.slice(0, 40));
  const bodyLines = await page.locator('#m-body p').count();
  check('正文按句分行', bodyLines === 2, `${bodyLines} 行`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Esc 关闭弹窗', (await page.locator('#modal-overlay.show').count()) === 0);

  // ---------- 排序 ----------
  console.log('\n[排序]');
  await search('苏轼', 'song');
  const sa = await authors();
  check('搜作者名，本人作品排第一', sa[0] && sa[0].includes('苏轼'), sa[0]);
  const saTop = sa.slice(0, 3);
  check('前三条都是苏轼本人作品', saTop.every(a => a.includes('苏轼')), saTop.join(' | '));

  // ---------- 分类浏览 ----------
  console.log('\n[分类浏览]');
  await fresh();
  await page.evaluate(async () => { await browseCategory('shijing'); });
  await page.waitForTimeout(500);
  const sjMeta = await meta();
  const sjTitles = await titles();
  check('诗经共 305 首', sjMeta.includes('305'), sjMeta);
  check('诗经第一篇是《关雎》', sjTitles[0] === '关雎', sjTitles[0]);

  await page.evaluate(async () => { await browseCategory('song'); });
  await page.waitForTimeout(900);
  const songMeta = await meta();
  check('宋诗浏览标注了总量与截断说明',
    songMeta.includes('254,248') && songMeta.includes('前 200'), songMeta);
  check('宋诗浏览有内容', (await page.locator('.result-item').count()) === 20);

  // ---------- 诗人跳转 ----------
  console.log('\n[诗人跳转]');
  await fresh();
  await page.locator('.poet-chip').first().click();
  await page.waitForTimeout(2600);
  const poetInput = await page.evaluate(() => document.getElementById('search-input').value);
  check('点诗人chip带出作者名', poetInput === '白居易', poetInput);
  const poetAuthors = await authors();
  check('跳转后结果都是该作者', poetAuthors[0] && poetAuthors[0].includes('白居易'), poetAuthors[0]);

  // ---------- 边界 ----------
  console.log('\n[边界情况]');
  await search('   ', 'all');
  const emptyMeta = await meta();
  check('空查询不报错且提示输入', emptyMeta.includes('输入关键词'), emptyMeta);

  await search('zzzz不存在的词zzzz', 'all');
  const noneMeta = await meta();
  const noneCount = await page.locator('.result-item').count();
  const hasEmptyState = await page.locator('.empty').count();
  check('无结果时给出明确提示而非空白',
    noneMeta.includes('没有找到') && noneCount === 0 && hasEmptyState === 1,
    `meta="${noneMeta}" 结果${noneCount}条 空状态${hasEmptyState}个`);

  await search('<script>alert(1)</script>', 'all');
  const xssInjected = await page.evaluate(() =>
    document.querySelectorAll('#search-results script').length);
  check('搜索词不会注入 script', xssInjected === 0, String(xssInjected));

  // 分页
  await search('明月', 'tang');
  const firstPage = await page.locator('.result-item').count();
  check('首屏 20 条', firstPage === 20, String(firstPage));
  await page.evaluate(() => loadMore());
  await page.waitForTimeout(200);
  const secondPage = await page.locator('.result-item').count();
  check('加载更多后变 40 条', secondPage === 40, String(secondPage));

  // ---------- 无 JS 错误 ----------
  console.log('\n[运行时]');
  check('页面无 JS 异常', pageErrors.length === 0, pageErrors.join(' ; '));

  // ---------- 布局：按钮不能压标签 ----------
  console.log('\n[布局]');
  // 换一首按钮是绝对定位，标签换行时容易压上去；用几何关系卡住
  for (const w of [1100, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await fresh();
    const overlap = await page.evaluate(() => {
      const btn = document.querySelector('.refresh-btn');
      const tags = document.getElementById('daily-tags');
      const b = btn.getBoundingClientRect();
      const t = tags.getBoundingClientRect();
      return {
        btnTop: Math.round(b.top), tagsBottom: Math.round(t.bottom),
        collides: b.top < t.bottom - 1 && b.left < t.right,
      };
    });
    check(`${w}px 下「换一首」不压标签`, !overlap.collides,
      `按钮top=${overlap.btnTop} 标签bottom=${overlap.tagsBottom}`);
  }

  // ---------- 可用性改进 ----------
  console.log('\n[可用性]');
  await page.setViewportSize({ width: 1100, height: 900 });
  await fresh();

  // 搜索框必须在首屏常驻，不用先切页面就能搜
  const searchVisibleOnHome = await page.evaluate(() => {
    const el = document.getElementById('search-input');
    const r = el.getBoundingClientRect();
    return r.width > 100 && r.top >= 0 && r.top < 300;
  });
  check('首页首屏即有搜索框', searchVisibleOnHome);

  // 在首页直接输入并回车，应自动跳到搜索页并出结果
  await fresh();
  await page.fill('#search-input', '静夜思');
  await page.press('#search-input', 'Enter');
  // 不能固定 sleep：全库 34 万条的繁简匹配耗时随 JIT 冷热波动，
  // 1200ms 偶尔不够会误报 FAIL。改成轮询，超时则照常让断言挂掉。
  await page.waitForFunction(() =>
    document.getElementById('view-search').classList.contains('active') &&
    document.querySelectorAll('.result-item').length > 0,
    null, { timeout: 8000 }
  ).catch(() => {});
  const autoJump = await page.evaluate(() => ({
    onSearchView: document.getElementById('view-search').classList.contains('active'),
    count: document.querySelectorAll('.result-item').length,
  }));
  check('首页输入回车自动进搜索页出结果',
    autoJump.onSearchView && autoJump.count > 0,
    `搜索页=${autoJump.onSearchView} 结果${autoJump.count}条`);

  // 首页诗人只放精选，不能把 186 个按钮全铺上去
  await fresh();
  const homeChips = await page.locator('#home-poets .poet-chip').count();
  check('首页诗人精选 36 个（12×3）', homeChips === 36, `${homeChips} 个`);
  const allChips = await page.evaluate(() => {
    goView('poets');
    return document.querySelectorAll('#poets-view .poet-chip').length;
  });
  check('诗人页才是完整 150 个（50×3）', allChips === 150, `${allChips} 个`);

  // 夜间模式
  await fresh();
  const beforeTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'));
  await page.click('#theme-btn');
  await page.waitForTimeout(200);
  const afterTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'));
  check('主题可切换', beforeTheme !== afterTheme, `${beforeTheme} -> ${afterTheme}`);
  // 暗色下正文颜色必须真的变亮，否则等于没切
  const darkInk = await page.evaluate(() => {
    const c = getComputedStyle(document.body).color;
    const m = c.match(/\d+/g).map(Number);
    return (m[0] + m[1] + m[2]) / 3;
  });
  check('夜间模式正文为浅色', darkInk > 120, `平均亮度 ${darkInk.toFixed(0)}`);
  // 刷新后应记住
  await page.reload();
  await page.waitForTimeout(900);
  const persisted = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'));
  check('主题选择刷新后保留', persisted === afterTheme, persisted);
  // 复位，避免影响后面的截图与断言
  await page.evaluate(() => { localStorage.setItem('poetry-theme', 'light'); applyTheme('light'); });

  // 「/」聚焦搜索
  await fresh();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('/');
  await page.waitForTimeout(150);
  const slashFocus = await page.evaluate(() =>
    document.activeElement && document.activeElement.id === 'search-input');
  check('「/」快捷键聚焦搜索框', slashFocus);

  // 复制按钮：点击后要有反馈（成功或失败都要说，不能静默）
  await fresh();
  await page.click('.hero-actions .btn:nth-child(2)');
  await page.waitForTimeout(300);
  const toastText = await page.evaluate(() =>
    document.getElementById('toast').textContent);
  check('点「复制」有明确反馈', toastText.includes('复制'), `"${toastText}"`);

  // 详情抽屉应占满高度（长诗要能滚动读完）
  await search('离骚', 'chuci');
  await page.locator('.result-item').first().click();
  await page.waitForTimeout(400);
  const drawerGeom = await page.evaluate(() => {
    const d = document.querySelector('.drawer');
    const r = d.getBoundingClientRect();
    const body = document.getElementById('drawer-body');
    return {
      heightRatio: r.height / window.innerHeight,
      scrollable: body.scrollHeight > body.clientHeight,
      lines: document.querySelectorAll('#m-body p').length,
    };
  });
  check('详情抽屉占满视口高度', drawerGeom.heightRatio > 0.95,
    `占比 ${drawerGeom.heightRatio.toFixed(2)}`);
  check('长诗可在抽屉内滚动', drawerGeom.scrollable, `${drawerGeom.lines} 行`);

  // ---------- 主题检索 ----------
  console.log('\n[主题]');

  // 宋词原始数据只有 rhythmic 字段没有 title，漏了回退会让 2 万首词全变「无题」
  await search('念奴娇', 'all');
  const ciStat = await page.evaluate(() => {
    const ci = poemStore.ci || [];
    return { total: ci.length, empty: ci.filter(p => !p.t).length };
  });
  check('宋词标题无空值（词牌已回退）',
    ciStat.total > 20000 && ciStat.empty === 0,
    `${ciStat.total} 首中 ${ciStat.empty} 首为空`);

  // 搜主题词时，该主题的代表作必须置顶 —— 这是「思乡搜不到静夜思」的修复点
  await search('思乡', 'all');
  const themeTop = await page.evaluate(() => ({
    meta: document.getElementById('search-meta').textContent,
    items: Array.from(document.querySelectorAll('.result-item')).slice(0, 6).map(el => ({
      t: (el.querySelector('.ri-title') || {}).textContent || '',
      badge: (el.querySelector('.ri-theme') || {}).textContent || '',
    })),
  }));
  check('搜「思乡」前 6 条都是名篇（带角标）',
    themeTop.items.filter(x => x.badge).length === 6,
    themeTop.items.map(x => x.badge || '(无)').join(' '));
  check('「思乡」第一条是《静夜思》',
    themeTop.items[0].t.includes('静夜思'), themeTop.items[0].t);
  check('「思乡」统计行标注置顶数量',
    /思乡.*名篇\s*\d+\s*首已置顶/.test(themeTop.meta), themeTop.meta);

  // 别名：搜「乡愁」应等同于搜「思乡」
  await search('乡愁', 'all');
  const aliasMeta = await meta();
  check('别名「乡愁」映射到「思乡」',
    aliasMeta.includes('「思乡」'), aliasMeta);

  // 元曲原始数据按曲牌拆开，《醉思乡王粲登楼》有 38 条，必须归并成一条
  await search('醉思乡', 'all');
  const yqStat = await page.evaluate(() => {
    const hits = searchResults.filter(r => (r.t || '').includes('醉思乡'));
    return {
      count: hits.length,
      frags: hits[0] ? hits[0]._fragCount : 0,
      paras: hits[0] ? (hits[0].p || []).length : 0,
    };
  });
  check('元曲同剧只出一条（不再刷屏）', yqStat.count === 1, `${yqStat.count} 条`);
  check('元曲归并保留全剧正文',
    yqStat.frags > 10 && yqStat.paras > yqStat.frags,
    `${yqStat.frags} 折 / ${yqStat.paras} 段`);

  // 简体化是在数据层做的（opencc 整句转换），不是前端逐字替换。
  // 逐字替换会把「乾坤」转成「干坤」——「乾」读 qián 时不该转。
  await search('乾坤', 'all');
  const qiankun = await page.evaluate(() => {
    const hit = searchResults.find(r => (r.p || []).join('').includes('乾坤'));
    return { found: !!hit, hasBad: searchResults.some(r => (r.p || []).join('').includes('干坤')) };
  });
  check('「乾坤」未被误转成「干坤」', qiankun.found && !qiankun.hasBad,
    qiankun.found ? '保留乾坤' : '未找到含乾坤的作品');

  // 诗人名同样要简体（诗人榜来自 poets.json，也走过转换）
  await page.evaluate(() => goView('poets'));
  await page.waitForTimeout(300);
  const poetSimp = await page.evaluate(() => {
    const names = Array.from(document.querySelectorAll('#poets-view .poet-chip'))
      .map(e => e.textContent.trim());
    return { total: names.length, bad: names.filter(n => /[劉蘇黃鄉萬雲後發靜齊貫陸楊趙韓陳張黃歐陽]/.test(n)) };
  });
  check('诗人名已转简体', poetSimp.total === 150 && poetSimp.bad.length === 0,
    `${poetSimp.total} 个中 ${poetSimp.bad.length} 个仍含繁体：${poetSimp.bad.slice(0, 3).join(' ')}`);

  // 全站可见文本不能有繁体。之前 to_simplified.js 只认 t/a/p 字段，
  // 而 featured.json 用的是 title/author/paragraphs，导致 646 首每日推荐整份漏转，
  // 首页主推的《关山月》一直是繁体。逐页扫一遍才不会漏。
  const TRAD_RE = /[詩萬雲後發鄉關國學時會點說話這樣麼頭東車馬鳥魚龍鳳靜劉蘇黃楊趙陳張歐陸齊貫韋韓溫賈島錢許]/;
  const scanTrad = async () => await page.evaluate((src) => {
    const m = document.body.innerText.match(new RegExp(src, 'g'));
    return m ? [...new Set(m)].join('') : '';
  }, TRAD_RE.source);

  const tradPoets = await scanTrad();
  check('诗人页无繁体残留', tradPoets === '', tradPoets ? `残留：${tradPoets}` : '干净');

  await fresh();
  const tradHome = await scanTrad();
  check('首页无繁体残留（含每日一诗）', tradHome === '', tradHome ? `残留：${tradHome}` : '干净');

  await search('思乡', 'all');
  const tradSearch = await scanTrad();
  check('搜索结果无繁体残留', tradSearch === '', tradSearch ? `残留：${tradSearch}` : '干净');

  // ---------- 视觉规整度 ----------
  console.log('\n[视觉]');
  await fresh();
  // 诗人网格不能出现残缺的末行（12 个用 6 列、50 个用 5 列，都能整除）
  const gridCheck = await page.evaluate(() => {
    const out = [];
    for (const grid of document.querySelectorAll('#home-poets .poet-grid')) {
      const chips = Array.from(grid.querySelectorAll('.poet-chip'));
      const firstTop = chips[0].getBoundingClientRect().top;
      const cols = chips.filter(c =>
        Math.abs(c.getBoundingClientRect().top - firstTop) < 2).length;
      out.push({ total: chips.length, cols, ragged: chips.length % cols !== 0 });
    }
    return out;
  });
  check('首页诗人网格无残缺末行',
    gridCheck.length === 3 && gridCheck.every(g => !g.ragged),
    gridCheck.map(g => `${g.total}/${g.cols}列`).join(' '));

  // 榜单口径：诗人榜按「收录数量」排，不是「文学地位」。
  // 「TOP 50」会被读成「历史上最有名的 50 位」，而榜上实际有「不詳」「無名氏」，
  // 宋诗前列也多是存诗多而非名气大的作者。标题和说明必须把口径说破。
  const poetCopy = await page.evaluate(() => {
    const note = document.querySelector('#view-home .poet-note');
    const secHead = note ? note.previousElementSibling : null;
    return {
      title: secHead ? secHead.querySelector('.sec-title').textContent.trim() : '',
      note: note ? note.textContent.trim() : '',
    };
  });
  check('首页诗人区标题是「存诗最多」而非「热门」',
    poetCopy.title === '存诗最多', `实际「${poetCopy.title}」`);
  check('首页诗人区有口径说明且点明不代表文学地位',
    poetCopy.note.includes('不代表文学地位'), `「${poetCopy.note}」`);

  // 首页说明的背景是透明的，要往上找第一个不透明的祖先才能算对比度。
  // 用 --ink-3 时这里只有 4.62:1，贴着及格线，所以按 5.0 卡。
  const homeNoteContrast = await page.evaluate(() => {
    const el = document.querySelector('#view-home .poet-note');
    const effBg = (node) => {
      let n = node;
      while (n) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
        n = n.parentElement;
      }
      return 'rgb(255,255,255)';
    };
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map(Number).map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bg = effBg(el);
    const l1 = lum(getComputedStyle(el).color), l2 = lum(bg);
    return { ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), bg };
  });
  check('首页诗人区说明对比度 ≥ 5:1', homeNoteContrast.ratio >= 5,
    `实际 ${homeNoteContrast.ratio.toFixed(2)}:1（底 ${homeNoteContrast.bg}）`);

  await page.evaluate(() => goView('poets'));
  await page.waitForTimeout(350);
  const poetPage = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('#poets-view .poet-group h4')].map(x => x.textContent.trim()),
    lead: (document.querySelector('#poets-view .poet-note--lead') || {}).textContent || '',
  }));
  check('诗人页三组标题写明「存诗/存词最多」',
    poetPage.heads.length === 3 &&
    poetPage.heads[0].includes('存诗最多') &&
    poetPage.heads[1].includes('存诗最多') &&
    poetPage.heads[2].includes('存词最多'),
    poetPage.heads.join(' / '));
  check('诗人页标题不再出现 TOP 50 字样',
    !poetPage.heads.some(h => h.includes('TOP')), poetPage.heads.join(' / '));
  check('诗人页顶部有存世量说明',
    poetPage.lead.includes('存世量'), `「${poetPage.lead.slice(0, 24)}…」`);

  // 说明文字是小字（12px），对比度不能只卡 4.5 —— 之前用 --ink-3 时只有 4.62，
  // 贴着及格线，任何一次微调都会掉下去。这里按 5.0 卡。
  const leadContrast = async () => await page.evaluate(() => {
    const el = document.querySelector('#poets-view .poet-note--lead');
    const cs = getComputedStyle(el);
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map(Number).map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const l1 = lum(cs.color), l2 = lum(cs.backgroundColor);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });
  const leadLight = await leadContrast();
  check('诗人榜说明文字对比度 ≥ 5:1（亮色）', leadLight >= 5, `实际 ${leadLight.toFixed(2)}:1`);
  await page.evaluate(() => applyTheme('dark'));
  await page.waitForTimeout(500);
  const leadDark = await leadContrast();
  check('诗人榜说明文字对比度 ≥ 5:1（暗色）', leadDark >= 5, `实际 ${leadDark.toFixed(2)}:1`);
  await page.evaluate(() => applyTheme('light'));
  await page.waitForTimeout(420);
  await fresh();

  // 暗色模式主按钮：白字压在朱砂底上，对比度必须够读
  // 注意：按钮有 .16s 的 background-color 过渡，切换主题后必须等过渡结束再读
  // computed style，否则量到的是中间色，断言会假通过。
  await page.evaluate(() => applyTheme('dark'));
  await page.waitForTimeout(420);
  const contrast = await page.evaluate(() => {
    const btn = document.querySelector('.btn-primary');
    const cs = getComputedStyle(btn);
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map(Number).map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const l1 = lum(cs.backgroundColor);
    const l2 = lum(cs.color);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });
  check('暗色主按钮对比度 ≥ 4.5:1', contrast >= 4.5, `实际 ${contrast.toFixed(2)}:1`);
  await page.evaluate(() => applyTheme('light'));
  await page.waitForTimeout(420);

  // 信息噪音：已按体裁筛选时，每条结果不该再重复同一个体裁标签
  await search('明月', 'tang');
  const catTagsFiltered = await page.locator('.result-item .ri-cat').count();
  check('限定体裁时不重复显示体裁标签', catTagsFiltered === 0, `${catTagsFiltered} 个`);

  await search('明月', 'all');
  const catTagsAll = await page.locator('.result-item .ri-cat').count();
  check('「全部」时显示体裁标签', catTagsAll > 0, `${catTagsAll} 个`);

  // 详情里的朝代与体裁应合成「唐诗」一项，且整处详情里只出现一次（不重复、不拆碎）
  await search('静夜思', 'tang');
  await page.locator('.result-item').first().click();
  await page.waitForTimeout(350);
  const detailKind = await page.evaluate(() => {
    const badge = document.querySelector('#m-author .dyn');
    const tagTexts = Array.from(document.querySelectorAll('#m-tags span'))
      .map(e => e.textContent);
    const authorText = document.getElementById('m-author').textContent;
    return {
      badge: badge ? badge.textContent : null,
      tagTexts,
      // 「唐」或「诗」单独出现即为拆碎
      split: tagTexts.includes('唐') || tagTexts.includes('诗'),
      // 「唐诗」在作者行与标签区各出现一次即为重复
      dupCount: (authorText.match(/唐诗/g) || []).length +
                tagTexts.filter(t => t === '唐诗').length,
    };
  });
  check('详情朝代体裁合并为「唐诗」', detailKind.badge === '唐诗', String(detailKind.badge));
  check('详情不拆碎成「唐」「诗」', !detailKind.split, detailKind.tagTexts.join(' / '));
  check('「唐诗」在详情里只出现一次', detailKind.dupCount === 1, `出现 ${detailKind.dupCount} 次`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  await browser.close();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`通过 ${pass} 条，失败 ${fail} 条`);
  if (fail) {
    console.log('失败项：');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过');
}

run().catch(e => { console.error(e); process.exit(1); });
