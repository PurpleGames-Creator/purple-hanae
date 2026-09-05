# -*- coding: utf-8 -*-
"""手書きの「はよ動け」(白線・黒地)を、紙に載せられる形にする。

本人が黒地に白で書いたものを受け取るので、
  1. 明るさをそのまま alpha に移す(白い線 = 不透明、黒地 = 透明)
  2. JPEG のノイズを切るため、下側にしきい値を置く
  3. 色は本編の鉛筆と同じ #2b2b33 に置き換える
  4. 線のある範囲だけに切り詰める

使い方:
  uv run --with pillow python _source/build_bubble.py _source/hanae_hukidashi_2026-09-05.jpg
"""
import sys
from PIL import Image

LO, HI = 38, 185          # これ以下は透明、これ以上は不透明
INK = (43, 43, 51, 255)   # 本編の鉛筆と同じ色


def build(src, out="assets/draw_bubble.webp"):
    g = Image.open(src).convert("L")
    a = g.point(lambda v: 0 if v <= LO else (255 if v >= HI else int((v - LO) * 255 / (HI - LO))))
    a = a.crop(a.getbbox())
    im = Image.new("RGBA", a.size, INK)
    im.putalpha(a)
    im.save(out, "WEBP", quality=94, method=6)
    print("%s %s 縦横比 %.3f" % (out, im.size, im.size[0] / im.size[1]))


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "assets/draw_bubble.webp")
