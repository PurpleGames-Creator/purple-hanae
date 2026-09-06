# -*- coding: utf-8 -*-
"""タイトルロゴの円形マークから、ホーム画面用アイコンを作る。

    uv run --with pillow python _source/build_icon.py

元: _source/logo_title_2026-08-25.png(ロゴ全体。左端に円形の紋章がある)
出力: assets/icon-180.png(iOS のホーム画面)
      assets/icon-192.png / icon-512.png(Android・manifest)
      assets/icon-maskable-512.png(Android の切り抜き対策。内側80%に収める)

背景は透明にしない —— iOS は透明を黒で埋めるので、下地の紫を敷いてから
円を置く。円の外側にわずかな余白を取り、角丸で削られても欠けないようにする。
"""
import io, os, sys
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC = os.path.join(HERE, "logo_title_2026-08-25.png")
OUT = os.path.join(REPO, "assets")

BG_TOP = (43, 31, 61)      # style.css の --bg-top
BG_BOTTOM = (74, 42, 69)   # style.css の --bg-bottom


def emblem():
    """ロゴの左側から円形の紋章だけを切り出す。

    紋章と文字の間に透明な隙間は無く(文字の光彩が紋章側へ伸びている)、
    左側だけを見た外接矩形も文字を拾ってしまう。そこで**円であること**を使う:

      1. 左端から続く不透明の帯がいちばん長い行を探す —— それが円の直径
      2. その直径ぶんの正方形で切り出す
      3. さらに円形のマスクを掛けて、角に入り込んだ文字の欠片を落とす
    """
    im = Image.open(SRC).convert("RGBA")
    W, H = im.size
    px = im.split()[3].load()
    best = (0, 0, 0)
    for y in range(0, H, 2):
        x = 0
        while x < W and px[x, y] <= 40:
            x += 1
        if x >= W:
            continue
        left = x
        while x < W and px[x, y] > 40:
            x += 1
        if x - left > best[0]:
            best = (x - left, y, left)
    d, ymid, x0 = best
    # 中心列をたどって円の上端を出す
    top = ymid
    while top > 0 and px[x0 + d // 2, top - 1] > 40:
        top -= 1
    print("  紋章: 左端 x=%d / 上端 y=%d / 直径 %dpx" % (x0, top, d))

    mark = im.crop((x0, top, x0 + d, top + d))
    ring = Image.new("L", (d * 4, d * 4), 0)
    ImageDraw.Draw(ring).ellipse((0, 0, d * 4 - 1, d * 4 - 1), fill=255)
    ring = ring.resize((d, d), Image.LANCZOS)          # 4倍で描いて縮め、縁を滑らかに
    out = Image.new("RGBA", (d, d), (0, 0, 0, 0))
    out.paste(mark, (0, 0), ring)
    return out, d


def gradient(size):
    """下地。上から下へ、本編と同じ紫のグラデーション。"""
    g = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        g.putpixel((0, y), tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)))
    return g.resize((size, size))


def build(size, ratio, name):
    mark, _ = emblem()
    inner = round(size * ratio)
    m = mark.resize((inner, inner), Image.LANCZOS)
    canvas = gradient(size).convert("RGBA")
    off = (size - inner) // 2
    canvas.alpha_composite(m, (off, off))
    p = os.path.join(OUT, name)
    canvas.convert("RGB").save(p, "PNG", optimize=True)
    print("  %-24s %dx%d  紋章 %d%%  %.1fKB" % (name, size, size, ratio * 100, os.path.getsize(p) / 1024))


if __name__ == "__main__":
    _, side = emblem()
    print("紋章の切り出し: %dpx 四方" % side)
    build(180, 0.94, "icon-180.png")           # iOS。角丸で削られる程度の余白
    build(192, 0.94, "icon-192.png")
    build(512, 0.94, "icon-512.png")
    build(512, 0.76, "icon-maskable-512.png")  # Android は外周20%を削ることがある
