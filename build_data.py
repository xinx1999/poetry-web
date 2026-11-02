#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从 chinese-poetry 仓库构建本站数据。

用法（在 poetry-web 目录下）：
    python build_data.py

输入：../chinese-poetry/
输出：data/
    featured.json      每日推荐池（唐诗三百首 366 + 宋词三百首 280）
    poets.json         唐/宋/词 诗人各 50 位（按收录数量降序）
    inline_data.js     唐诗、宋词、元曲、诗经、楚辞、论语、蒙学（页面直载）
    song_shards/       宋诗分片（254k 首，65MB，逐片流式加载）
    t2s_map.js         繁简转换表
"""
import json
import os
import re
import glob
import subprocess
from collections import Counter

SRC = '../chinese-poetry'
OUT = 'data'

# 方括号缺字标记：原书用 [X] 表示存疑/异文，如「[爽]節在重九」。
# 阅读场景下直接去掉括号保留字，读起来才通顺。
BRACKET = re.compile(r'\[([^\]]{1,4})\]')

def clean(text):
    if not isinstance(text, str):
        return text
    return BRACKET.sub(r'\1', text)

def clean_paras(paras):
    if not isinstance(paras, list):
        return []
    return [clean(p) for p in paras if isinstance(p, str)]

def write_json(path, obj, compact=True):
    with open(path, 'w', encoding='utf-8') as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        else:
            json.dump(obj, f, ensure_ascii=False)
    return os.path.getsize(path)

def build_poems(files, dynasty, kind):
    items = []
    for fn in files:
        with open(fn, encoding='utf-8') as f:
            for p in json.load(f):
                # 宋词原始数据没有 title 字段，词牌在 rhythmic 里。
                # 漏掉这层回退会让 2 万首词全部变成「无题」，词牌名也搜不到。
                title = p.get('title') or p.get('rhythmic') or ''
                items.append({
                    't': clean(title),
                    'a': p.get('author', ''),
                    'd': dynasty,
                    'y': kind,
                    'p': clean_paras(p.get('paragraphs', [])),
                })
    return items

def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(f'{OUT}/song_shards', exist_ok=True)

    print('=== 1/5 读取原始数据 ===')
    tang = build_poems(sorted(glob.glob(f'{SRC}/全唐诗/poet.tang.*.json')), '唐', '诗')
    song = build_poems(sorted(glob.glob(f'{SRC}/全唐诗/poet.song.*.json')), '宋', '诗')
    ci = build_poems(sorted(glob.glob(f'{SRC}/宋词/ci.song.*.json')), '宋', '词')
    print(f'  唐诗 {len(tang):,} / 宋诗 {len(song):,} / 宋词 {len(ci):,}')

    # 诗经
    shijing = []
    with open(f'{SRC}/诗经/shijing.json', encoding='utf-8') as f:
        for p in json.load(f):
            shijing.append({
                't': clean(p.get('title', '')), 'a': '佚名', 'd': '先秦', 'y': '诗',
                'p': clean_paras(p.get('content', [])),
                's': f"{p.get('chapter', '')}·{p.get('section', '')}".strip('·'),
            })

    # 楚辞
    chuci = []
    with open(f'{SRC}/楚辞/chuci.json', encoding='utf-8') as f:
        for p in json.load(f):
            chuci.append({
                't': clean(p.get('title', '')), 'a': p.get('author', '屈原'),
                'd': '战国', 'y': '楚辞',
                'p': clean_paras(p.get('content', [])),
                's': p.get('section', ''),
            })

    # 元曲
    yuanqu = []
    with open(f'{SRC}/元曲/yuanqu.json', encoding='utf-8') as f:
        for p in json.load(f):
            yuanqu.append({
                't': clean(p.get('title', '')), 'a': p.get('author', ''),
                'd': '元', 'y': '曲',
                'p': clean_paras(p.get('paragraphs', [])),
            })

    # 论语
    lunyu = []
    with open(f'{SRC}/论语/lunyu.json', encoding='utf-8') as f:
        for p in json.load(f):
            lunyu.append({
                't': clean(p.get('chapter', '')), 'a': '孔子及弟子',
                'd': '先秦', 'y': '经',
                'p': clean_paras(p.get('paragraphs', [])),
            })

    # 蒙学：每个文件是一个 dict，结构有两种（平铺 paragraphs / 嵌套 content）
    mengxue = []
    MENG_MAP = {
        'sanzijing-new.json': '三字经', 'sanzijing-traditional.json': '三字经(繁体)',
        'baijiaxing.json': '百家姓', 'dizigui.json': '弟子规',
        'guwenguanzhi.json': '国文观止', 'qianjiashi.json': '千家诗',
        'qianziwen.json': '千字文', 'shenglvqimeng.json': '声律启蒙',
        'wenzimengqiu.json': '文字蒙求', 'youxueqionglin.json': '幼学琼林',
        'zengguangxianwen.json': '增广贤文', 'zhuzijiaxun.json': '朱子家训',
        'tangshisanbaishou.json': '唐诗三百首',
    }
    for fn, name in MENG_MAP.items():
        path = f'{SRC}/蒙学/{fn}'
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        if not isinstance(d, dict):
            continue
        title = clean(d.get('title', name))
        author = d.get('author', '')
        if 'paragraphs' in d:
            mengxue.append({'t': title, 'a': author, 'd': '古代', 'y': '蒙学',
                            'p': clean_paras(d['paragraphs']), 's': name})
        elif 'content' in d:
            for sec in d['content']:
                if not isinstance(sec, dict):
                    continue
                if 'paragraphs' in sec:
                    paras = sec['paragraphs']
                    sec_title = sec.get('chapter', '') or name
                elif isinstance(sec.get('content'), list):
                    paras = []
                    for sub in sec['content']:
                        if isinstance(sub, dict):
                            paras.extend(sub.get('paragraphs', []))
                    sec_title = sec.get('type', '') or name
                else:
                    continue
                paras = clean_paras(paras)
                if paras:
                    mengxue.append({'t': title, 'a': sec.get('author', author),
                                    'd': '古代', 'y': '蒙学',
                                    'p': paras, 's': sec_title})
    print(f'  诗经 {len(shijing)} / 楚辞 {len(chuci)} / 元曲 {len(yuanqu):,} '
          f'/ 论语 {len(lunyu)} / 蒙学 {len(mengxue)}')

    print('\n=== 2/5 写出内嵌数据 ===')
    inline = {
        'full_tang': tang, 'full_ci': ci, 'full_yuanqu': yuanqu,
        'full_shijing': shijing, 'full_chuci': chuci,
        'full_lunyu': lunyu, 'full_mengxue': mengxue,
    }
    with open(f'{OUT}/inline_data.js', 'w', encoding='utf-8') as f:
        f.write('const INLINE_DATA = ')
        json.dump(inline, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';')
    print(f'  inline_data.js  {os.path.getsize(f"{OUT}/inline_data.js")/1024/1024:.1f} MB')

    print('\n=== 3/5 宋诗分片 ===')
    for old in glob.glob(f'{OUT}/song_shards/*.json'):
        os.remove(old)
    SHARD = 10000
    manifest = []
    for i in range(0, len(song), SHARD):
        chunk = song[i:i + SHARD]
        rel = f'song_shards/shard_{i // SHARD}.json'
        size = write_json(f'{OUT}/{rel}', chunk)
        manifest.append({'file': rel, 'count': len(chunk), 'size': round(size / 1024 / 1024, 1)})
    write_json(f'{OUT}/song_shards/manifest.json', manifest)
    print(f'  {len(manifest)} 片，共 {sum(m["count"] for m in manifest):,} 首，'
          f'{sum(m["size"] for m in manifest):.0f} MB')

    print('\n=== 4/5 每日推荐池 ===')
    featured = []
    with open(f'{SRC}/全唐诗/唐诗三百首.json', encoding='utf-8') as f:
        for p in json.load(f):
            featured.append({
                'title': clean(p.get('title', '')), 'author': p.get('author', ''),
                'dynasty': '唐', 'type': '诗',
                'paragraphs': clean_paras(p.get('paragraphs', [])),
                'tags': p.get('tags', []),
            })
    with open(f'{SRC}/宋词/宋词三百首.json', encoding='utf-8') as f:
        for p in json.load(f):
            rhythmic = p.get('rhythmic', '')
            title = p.get('title', '') or rhythmic
            if rhythmic and p.get('title') and rhythmic not in title:
                title = f'{rhythmic}·{title}'
            featured.append({
                'title': clean(title), 'author': p.get('author', ''),
                'dynasty': '宋', 'type': '词',
                'paragraphs': clean_paras(p.get('paragraphs', [])),
                'tags': p.get('tags', []),
            })
    write_json(f'{OUT}/featured.json', featured)
    print(f'  featured.json  {len(featured)} 首')

    print('\n=== 5/5 诗人排行 ===')
    poets = {
        'tang': [{'name': n, 'count': c} for n, c in Counter(p['a'] for p in tang).most_common(50)],
        'song': [{'name': n, 'count': c} for n, c in Counter(p['a'] for p in song).most_common(50)],
        'ci':   [{'name': n, 'count': c} for n, c in Counter(p['a'] for p in ci).most_common(50)],
    }
    write_json(f'{OUT}/poets.json', poets)
    print(f'  poets.json  唐/宋/词 各 50 位（按收录数量降序）')

    # 繁简表依赖最终用字，放在最后生成
    print('\n=== 生成繁简转换表 ===')
    charset_path = '../_charset.txt'
    chars = set()
    def collect(o):
        if isinstance(o, str):
            chars.update(o)
        elif isinstance(o, list):
            for x in o:
                collect(x)
        elif isinstance(o, dict):
            for v in o.values():
                collect(v)
    for v in inline.values():
        collect(v)
    for m in manifest[:5]:          # 抽样即可覆盖常用字
        with open(f'{OUT}/{m["file"]}', encoding='utf-8') as f:
            collect(json.load(f))
    with open(charset_path, 'w', encoding='utf-8') as f:
        f.write(''.join(sorted(chars)))
    print(f'  数据集用字 {len(chars):,} 个')

    r = subprocess.run(
        ['node', 'make_t2s.js', charset_path, f'{OUT}/t2s_map.js'],
        capture_output=True, text=True
    )
    print(r.stdout.strip())
    if r.returncode != 0:
        print('  [警告] 繁简表生成失败：', r.stderr.strip())
        print('  请先 npm install opencc-js')

    print('\n完成。')

if __name__ == '__main__':
    main()
