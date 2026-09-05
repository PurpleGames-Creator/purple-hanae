# -*- coding: utf-8 -*-
"""41歳ハナエの写真を、本編の立ち絵と同じ枠に組み直す。

やること:
  1. 背景を抜いた PNG(rembg 済み)を読む
  2. 不透明部分だけに切り詰める
  3. 本編の立ち絵(566x1000)と同じ枠に、頭の位置と顔の大きさを合わせて置く
  4. バストアップなので下端が切れる。そのままだと硬い切り口が出るので、
     下を alpha で溶かす(立ち絵の CSS マスクは要素の下 16% にしか効かないため、
     画像側で溶かしておく必要がある)
  5. WebP(alpha 付き)で書き出す

使い方: uv run --with pillow python _source/build_adult.py <入力png> <出力名>
        例) ... _source/hanae_adult_cut.png hanae_adult
"""
import sys
from PIL import Image

SPRITE_W, SPRITE_H = 566, 1000   # 本編の立ち絵と同じ枠
TARGET_W = 540                   # 枠の中でこの幅に収める(左右に少し余白)
HEAD_TOP = 16                    # 髪のてっぺんの位置。本編の立ち絵と揃える
FADE = 150                       # 下端を溶かす距離


def build(src_path, out_name):
    im = Image.open(src_path).convert("RGBA")
    bb = im.getchannel("A").getbbox()
    im = im.crop(bb)
    w, h = im.size

    scale = TARGET_W / w
    nw, nh = round(w * scale), round(h * scale)
    im = im.resize((nw, nh), Image.LANCZOS)

    # 下端を溶かす。バストアップの切り口をそのまま出すと板を貼ったように見える
    a = im.getchannel("A")
    px = a.load()
    fade = min(FADE, nh // 2)
    for y in range(nh - fade, nh):
        k = (nh - 1 - y) / fade          # 1 → 0
        k = k * k * (3 - 2 * k)          # 端で急に切れないよう滑らかに
        for x in range(nw):
            v = px[x, y]
            if v:
                px[x, y] = int(v * k)
    im.putalpha(a)

    canvas = Image.new("RGBA", (SPRITE_W, SPRITE_H), (0, 0, 0, 0))
    canvas.paste(im, ((SPRITE_W - nw) // 2, HEAD_TOP), im)
    out = "assets/%s.webp" % out_name
    canvas.save(out, "WEBP", quality=92, method=6)
    print("%s: %dx%d に配置(元 %dx%d を %.3f 倍)" % (out, SPRITE_W, SPRITE_H, w, h, scale))
    return canvas


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
