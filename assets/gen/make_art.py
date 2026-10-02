#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数墙（Nurikabe）本仓的美术资产工厂 —— 一条命令重现全部位图。

    python3 assets/gen/make_art.py            # 写 icons/ 与 assets/img/
    python3 assets/gen/make_art.py --check    # 只把每张成品的类型/尺寸/平均色打出来

母题（先定风格再落笔，全部来自玩法本身，不凭空借形）：
  数墙只有两种墨水 —— 纸白的岛、压到最暗的靛海；数字住在岛上，海上有"云点"，
  琥珀色是本仓唯一允许说"看这里/这是你的手"的颜色（见 js/theme.js 的 Palette）。
  所以图标 = 一张真解开的 5×5 盘（岛凑满、墙连成一片、无 2×2 全黑），
  云点的位置直接移植 js/render/board.js 的 cloudOf() 那个整数散列，
  于是商品图上的每一格都能被引擎逐格复算 —— 图标里不许躺着一个不成立的盘。
  盘面来自 assets/gen/board.json（由 assets/gen/board_fixture.mjs 从引擎生成，是提交进仓的定值），
  所以本脚本不需要 node 也能重算；换母题请先换那颗 seed。

产物（都是真 PNG，无 SVG 冒充、无 0 字节）：
  icons/icon-1024.png / icon-512 / icon-192 / icon-512-maskable / apple-touch-icon(180)
  icons/icon-96 / icon-48 / icon-32 / favicon-16
  assets/img/og-cover.png（1200×630 社交卡）
  assets/img/texture-sea-256.png / texture-paper-256.png（可平铺纹理，画布与样式表都在用）
  assets/img/sprite-spark-64.png（通关粒子用的 sprite）

依赖：Pillow（`python3 -m pip install pillow`）。字体按平台找，找不到就不写字，
不产"文字是方块"的成品 —— 见 text()，宁缺毋滥是这条线的纪律。
"""
import argparse
import json
import os
import struct
import sys
import zlib

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("缺 Pillow：python3 -m pip install pillow —— 本脚本不产占位图，宁可停在这里")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEN = os.path.join(ROOT, 'assets', 'gen')
ICON_DIR = os.path.join(ROOT, 'icons')
IMG_DIR = os.path.join(ROOT, 'assets', 'img')

# 颜色只抄 js/theme.js 的 Palette（唯一来源），这里写死是为了让位图与画布在同一套色上对齐。
C = {
    'bgTop': (8, 11, 22), 'bgBottom': (19, 26, 46), 'surface': (16, 22, 39),
    'line': (36, 48, 80), 'lineHeavy': (58, 74, 114),
    'ink': (242, 245, 251), 'inkDim': (178, 187, 203), 'inkFaint': (120, 130, 150),
    'accent': (255, 200, 92), 'accentEdge': (255, 227, 166),
    'wall': (8, 12, 24), 'wallEdge': (32, 44, 72), 'land': (237, 242, 250), 'landInk': (12, 18, 32),
    'unknown': (20, 28, 49), 'success': (61, 220, 145), 'hint': (123, 184, 255),
}
WHITE, BLACK, UNKNOWN = 1, 2, 0

SS = 2  # 母图的上采样倍数：1024 这一档按 2048 画再降回来，圆角与云点才不带锯齿


# ---------------------------------------------------------------- 小工具

def lcg_hash(*nums):
    """整数散列：与 js/render/board.js 的 cloudOf() 同一个思路（Knuth 乘数），用于云点与噪声。"""
    k = 0x9e3779b9
    for n in nums:
        k = (k * 2654435761 + (n & 0xFFFFFFFF) + 1) & 0xFFFFFFFF
    return k


def cloud_of(t, cell):
    """移植 js/render/board.js:24 cloudOf()：图标上的云点必须和画布上的是同一批位置。"""
    k = (t * 2654435761) & 0xFFFFFFFF

    def r(shift, mod):
        return ((k >> shift) % mod) / mod

    return [
        {'x': 0.18 + r(3, 22) / 100.0, 'y': 0.24 + r(9, 26) / 100.0, 's': 0.155},
        {'x': 0.56 + r(15, 20) / 100.0, 'y': 0.60 + r(21, 22) / 100.0, 's': 0.130},
        {'x': 0.66 + r(6, 14) / 100.0, 'y': 0.28 + r(12, 16) / 100.0, 's': 0.095},
    ]


def mix(a, b, f):
    return tuple(int(round(a[i] + (b[i] - a[i]) * f)) for i in range(3))


def vgrad(size, top, bottom):
    """竖直渐变底：与样式表 html,body 的那一条 linear-gradient 同一个形状。"""
    w, h = size
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        c = mix(top, bottom, y / max(1, h - 1))
        for x in range(w):
            px[x, y] = c
    return img


def vnoise(x, y, period, seed=1):
    """可平铺的值噪声：格点取模 period，所以 256 的瓦片四边接得上。"""
    xi, yi = int(x), int(y)
    xf, yf = x - xi, y - yi
    g = [[lcg_hash(seed, (xi + dx) % period, (yi + dy) % period) / 0xFFFFFFFF for dy in (0, 1)] for dx in (0, 1)]
    sx, sy = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    a = g[0][0] + (g[1][0] - g[0][0]) * sx
    b = g[0][1] + (g[1][1] - g[0][1]) * sx
    return a + (b - a) * sy


def round_rect(draw, box, rad, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=rad, fill=fill, outline=outline, width=width)


def find_font(candidates, pixels):
    for path in candidates:
        for index in (0, 1, 2):
            try:
                from PIL import ImageFont
                f = ImageFont.truetype(path, pixels, index=index)
                return f
            except Exception:
                continue
    return None


CJK_FONTS = ['/System/Library/Fonts/Hiragino Sans GB.ttc', '/System/Library/Fonts/PingFang.ttc',
             '/System/Library/Fonts/STHeiti Medium.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
             '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc']
MONO_FONTS = ['/System/Library/Fonts/SFNSMono.ttf', '/System/Library/Fonts/Menlo.ttc',
              '/System/Library/Fonts/Supplemental/Courier New.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf']


# ---------------------------------------------------------------- 母题：一张解开的盘

def hand_cell(board):
    """琥珀圈该套在哪一格：套在"把某座岛逼满的那块墙"上 —— 即白格邻居最多的黑格。
    这条选择完全由盘面决定（同一份 board.json 永远同一个格子），不是美术口味。"""
    w, h, cell = board['w'], board['h'], board['cell']
    best, best_n = -1, -1
    for t, v in enumerate(cell):
        if v != BLACK:
            continue
        x, y = t % w, t // w
        n = sum(1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= x + dx < w and 0 <= y + dy < h and cell[(y + dy) * w + x + dx] == WHITE)
        if n > best_n:
            best, best_n = t, n
    return best


def motif(size, board, *, corner=0.0, pad=0.18, bg=True, grid=True, hand=True):
    """把一张盘画成边长 size 的方图（返回 RGBA，已按 corner 削角）。"""
    n = size * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    layer = Image.new('RGBA', (n, n), (0, 0, 0, 255))
    if bg:
        base = vgrad((n, n), C['bgTop'], C['bgBottom']).convert('RGBA')
        layer = base
    d = ImageDraw.Draw(layer)
    w, h = board['w'], board['h']
    cell = board['cell']
    clue = board['clue']
    m = int(n * pad)
    side = n - 2 * m
    cw, ch = side / w, side / h

    # 海面：一整片最暗的靛，格子之间只留一条极细的线（线是"海"的分隔，不是岛的分隔）
    d.rectangle([m, m, m + side, m + side], fill=C['wall'] + (255,))
    if grid:
        lw = max(1, int(n * 0.0016))
        for i in range(w + 1):
            x = int(m + i * cw)
            d.rectangle([x - lw // 2, m, x + lw - lw // 2, m + side], fill=C['line'] + (255,))
        for j in range(h + 1):
            y = int(m + j * ch)
            d.rectangle([m, y - lw // 2, m + side, y + lw - lw // 2], fill=C['line'] + (255,))

    # 岛：纸白的整块 + 岛上那个号（号的颜色跟着底走，和画布一致）
    for t, v in enumerate(cell):
        if v != WHITE:
            continue
        x, y = t % w, t // w
        box = [int(m + x * cw), int(m + y * ch), int(m + (x + 1) * cw), int(m + (y + 1) * ch)]
        d.rectangle(box, fill=C['land'] + (255,))

    fs = int(cw * 0.5)
    font = find_font(MONO_FONTS, fs) if fs >= 9 else None
    for t, v in enumerate(cell):
        if v != BLACK:
            continue
        x, y = t % w, t // w
        ox, oy = m + x * cw, m + y * ch
        for c in cloud_of(t, cw):
            r = max(1.0, cw * c['s'])
            cx, cy = ox + c['x'] * cw, oy + c['y'] * ch
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=C['wallEdge'] + (255,))

    if font is not None:
        for num in board['numbers']:
            t = num['cell']
            x, y = t % w, t // w
            ox, oy = m + x * cw, m + y * ch
            ink = C['landInk'] if cell[t] == WHITE else (C['success'] if num['idx'] >= 0 else C['ink'])
            txt = str(num['size'])
            bb = font.getbbox(txt)
            d.text((ox + (cw - (bb[2] - bb[0])) / 2 - bb[0], oy + (ch - (bb[3] - bb[1])) / 2 - bb[1]),
                   txt, font=font, fill=ink + (255,))
            # 凑满的岛：数字外套一环（画布上"这块的账平了"用的就是这一环）
            r = cw * 0.34
            d.ellipse([ox + cw / 2 - r, oy + ch / 2 - r, ox + cw / 2 + r, oy + ch / 2 + r],
                      outline=C['success'] + (255,), width=max(1, int(cw * 0.045)))

    if hand:
        t = hand_cell(board)
        if t >= 0:
            x, y = t % w, t // w
            lw = max(2, int(cw * 0.09))
            box = [m + x * cw + lw / 2, m + y * ch + lw / 2, m + (x + 1) * cw - lw / 2, m + (y + 1) * ch - lw / 2]
            d.rectangle(box, outline=C['accent'] + (255,), width=lw)

    img = Image.alpha_composite(img, layer)
    if corner > 0:
        mask = Image.new('L', (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * corner), fill=255)
        img.putalpha(ImageChops_multiply(img, mask))
    return img.resize((size, size), Image.LANCZOS)


def ImageChops_multiply(img, mask):
    from PIL import ImageChops
    a = img.getchannel('A')
    return ImageChops.multiply(a, mask)


def opaque(img, color):
    """iOS 的 App Icon 不许带 alpha：把削掉的角填成底色。"""
    base = Image.new('RGBA', img.size, color + (255,))
    return Image.alpha_composite(base, img)


# ---------------------------------------------------------------- 纹理与 sprite

def texture_sea(size=256):
    """海（黑墙）的可平铺纹理：底是最暗的靛，上面两到三层同周期的波纹 + 云点。
    平均亮度被压在 24 以下 —— 画布拿它铺黑格时，任何采样点都不可能靠近纸白。"""
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            n = vnoise(x / 18.0, y / 18.0, max(1, size // 18), seed=7)
            band = 0.5 + 0.5 * vnoise(x / 6.0, y / 26.0, max(1, size // 6), seed=11)
            streak = abs(((y / 21.0) + n * 0.55) % 1.0 - 0.5) * 2.0
            f = 0.55 * n + 0.45 * (1.0 - streak)
            px[x, y] = mix(C['wall'], (23, 33, 58), 0.20 + 0.55 * f)
    # 云点：和画布同一批位置（16px 一块），所以图标、纹理、盘面说的是同一种海
    d = ImageDraw.Draw(img)
    for gy in range(size // 32):
        for gx in range(size // 32):
            t = gy * (size // 32) + gx
            for c in cloud_of(t, 32):
                r = max(1.0, 32 * c['s'] * 0.8)
                cx, cy = gx * 32 + c['x'] * 32, gy * 32 + c['y'] * 32
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=C['wallEdge'])
    return img.convert('RGBA')


def texture_paper(size=256):
    """岛纸的可平铺纹理：纸白 + ±6 以内的颗粒 + 几根极淡的纤维。
    压到 6 不是审美折中：浏览器闸对岛上取样点的容差是 8（tools/scenarios.js:901），
    这张图将来真的会进画布，幅度必须让那 755 条断言照样绿。"""
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            a = vnoise(x / 5.0, y / 5.0, max(1, size // 5), seed=3)
            b = vnoise(x / 2.0, y / 2.0, max(1, size // 2), seed=5)
            f = (a * 0.7 + b * 0.3) * 2 - 1
            px[x, y] = mix(mix(C['land'], (222, 230, 243), max(0.0, -f)), (252, 253, 255), max(0.0, f))
    d = ImageDraw.Draw(img)
    for i in range(size // 16):
        k = lcg_hash(17, i)
        x0, y0 = (k % size), ((k >> 9) % size)
        ln = 10 + ((k >> 5) % 26)
        d.line([x0, y0, (x0 + ln) % size, y0 + ((k >> 13) % 5) - 2], fill=(228, 236, 248), width=1)
    return img.convert('RGBA')


def sprite_spark(size=64):
    """通关粒子：一枚琥珀色的径向火花（中心亮、外圈全透明），加色叠在画布留白区。"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    px = img.load()
    c = (size - 1) / 2.0
    for y in range(size):
        for x in range(size):
            dx, dy = (x - c) / c, (y - c) / c
            r = (dx * dx + dy * dy) ** 0.5
            if r > 1.0:
                continue
            core = max(0.0, 1.0 - r) ** 2.4
            halo = max(0.0, 1.0 - r) ** 0.8 * 0.35
            a = min(1.0, core + halo)
            px[x, y] = mix(mix((255, 176, 92), C['accentEdge'], core), C['accent'], 0.4) + (int(a * 255),)
    return img


# ---------------------------------------------------------------- 社交卡

def og_cover(board, path):
    W, H = 1200, 630
    img = vgrad((W, H), C['bgTop'], C['bgBottom']).convert('RGBA')
    d = ImageDraw.Draw(img)
    # 底纹：右上角铺一层海纹理（只压这一层的透明度 —— 整张卡必须全不透明，
    # 带 alpha 的 og 图会被社交平台铺成一张灰卡，实测第一版就是这么灰的）
    sea = texture_sea(256).resize((512, 512), Image.BILINEAR)
    img.alpha_composite(fade(sea, 0.5), (W - 512, -80))
    d = ImageDraw.Draw(img)
    board_img = motif(372, board, corner=0.145, pad=0.12)
    img.alpha_composite(board_img, (W - 372 - 64, (H - 372) // 2))
    # 左侧的一条琥珀色边是本仓"这是你的手"的那个颜色，也是整张卡唯一的暖色
    d.rectangle([0, 0, 10, H], fill=C['accent'] + (255,))

    cjk = find_font(CJK_FONTS, 104)
    cjk_sm = find_font(CJK_FONTS, 40)
    mono = find_font(MONO_FONTS, 30)
    x0, y = 62, 96
    if cjk:
        d.text((x0, y), '数墙', font=cjk, fill=C['ink'] + (255,))
        y += 132
    if mono:
        d.text((x0, y), 'N U R I K A B E', font=mono, fill=C['hint'] + (255,))
        y += 62
    if cjk_sm:
        for line in ('数字写着那座白岛有几格', '所有黑墙连成一整块海', '任何一个 2×2 都不许全黑'):
            d.text((x0, y), line, font=cjk_sm, fill=C['inkDim'] + (255,))
            y += 56
        y += 16
        d.text((x0, y), '每一局唯一解 · 每一局都能用逻辑推到底', font=cjk_sm, fill=C['accent'] + (255,))
    if not (cjk or mono):
        raise SystemExit('找不到可用字体：宁可不写这张卡，也不交一甲方块字。请装 CJK 字体后重跑。')
    img.save(path, 'PNG', optimize=True)
    return img.size


def fade(img, alpha):
    """整层压透明度：alpha_composite 没有这一档，自己乘一遍。"""
    a = img.getchannel('A').point(lambda v: int(v * alpha))
    out = img.copy()
    out.putalpha(a)
    return out


# ---------------------------------------------------------------- 出货

def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=True, compress_level=9)
    return path


def build(check_only=False):
    board = json.load(open(os.path.join(GEN, 'board.json'), encoding='utf-8'))['boards']['icon']
    made = []

    def put(img, rel):
        p = os.path.join(ROOT, rel)
        if check_only:
            made.append(p)
            return
        save(img, p)
        made.append(p)

    master = motif(1024, board, corner=0.145)
    put(master, 'icons/icon-1024.png')
    for s, rel in ((512, 'icons/icon-512.png'), (192, 'icons/icon-192.png'),
                   (96, 'icons/icon-96.png'), (48, 'icons/icon-48.png'),
                   (32, 'icons/icon-32.png'), (16, 'icons/favicon-16.png')):
        put(master.resize((s, s), Image.LANCZOS), rel)
    # apple-touch-icon：iOS 忽略圆角蒙版，直接给满幅不透明的方图，免得桌面上一圈黑边
    put(opaque(motif(180, board, corner=0.0), C['bgTop']), 'icons/apple-touch-icon.png')
    # maskable：内容缩进安全区（中心 74%），Android launcher 裁圆/方都不切岛
    put(opaque(motif(512, board, corner=0.0, pad=0.27), C['bgTop']), 'icons/icon-512-maskable.png')
    put(texture_sea(256), 'assets/img/texture-sea-256.png')
    put(texture_paper(256), 'assets/img/texture-paper-256.png')
    put(sprite_spark(64), 'assets/img/sprite-spark-64.png')
    if not check_only:
        og_cover(board, os.path.join(ROOT, 'assets', 'img', 'og-cover.png'))
    made.append(os.path.join(ROOT, 'assets', 'img', 'og-cover.png'))
    for p in made:
        print('  %s  %s' % (ihdr(p), os.path.relpath(p, ROOT)))


def ihdr(path):
    """自己读 PNG 的 IHDR（不依赖 PIL）：这就是"真图"的证据，不是文件大小猜的。"""
    try:
        with open(path, 'rb') as fh:
            head = fh.read(26)
    except OSError:
        return 'MISSING'
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        return 'NOT-PNG'
    w, h, depth, ctype = struct.unpack('>IIBB', head[16:26])
    return '%dx%d depth=%d colortype=%d bytes=%d' % (w, h, depth, ctype, os.path.getsize(path))


if __name__ == '__main__':
    build(check_only='--check' in sys.argv)
