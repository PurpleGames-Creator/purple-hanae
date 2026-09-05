# -*- coding: utf-8 -*-
"""41歳ハナエの写真を、本編の立ち絵と同じ枠に組み直す。

4枚(素・怒り3段階)は、押すたびに 180ms のクロスフェードで入れ替わる。
枠に対して適当に置くと切り替わるたびに顔が飛ぶので、**顔の中心と大きさを
揃えて**から置く。顔の位置は OpenCV の顔検出で取る。

  - 揃える先(FACE_*)は、最初に置いた素の1枚の位置。すでに公開済みなので動かさない
  - 悪魔の1枚は角が頭より上に出る。枠の上端に合わせると顔が下がってしまうので、
    ここでも基準は顔。角は枠から少しはみ出してよい
  - バストアップなので下端が切れる。そのままだと板を貼ったように見えるので、
    枠の中で下 150px を alpha で溶かす(立ち絵の CSS マスクは要素の下 16% に
    しか効かないため、画像側で処理する必要がある)

使い方: 2段構え。

  1) 背景を抜いて *_cut.png を作る(中間ファイルは git 管理外なので毎回ここから)

     uv run --python 3.12 --with rembg --with onnxruntime --with pillow python -c "
     from rembg import remove, new_session
     from PIL import Image
     s = new_session('u2net_human_seg')
     im = Image.open('_source/hanae_adult_2026-09-05.jpg')
     remove(im, session=s, alpha_matting=True, alpha_matting_foreground_threshold=250,
            alpha_matting_background_threshold=15, alpha_matting_erode_size=8
           ).save('_source/hanae_adult_cut.png')"

     悪魔の1枚だけは u2net_human_seg だと三叉槍が落ちるので isnet-general-use を使う。
     そのモデルだと髪の上に階段状の欠けが出るので、alpha に
     MaxFilter(5) → MinFilter(5) → GaussianBlur(0.7) を掛けて埋める。

  2) 枠に組む

     uv run --with pillow --with numpy --with "opencv-python-headless<5"        python _source/build_adult.py

"""
import sys

import cv2
import numpy as np
from PIL import Image

SPRITE_W, SPRITE_H = 566, 1000   # 本編の立ち絵と同じ枠
FACE_CX, FACE_CY = 316.0, 210.0  # 揃える先: 顔の中心(枠の座標)
FACE_SIZE = 245.0                # 揃える先: 顔の一辺
FADE = 150                       # 下端を溶かす距離

JOBS = [
    ("_source/hanae_adult_cut.png", "hanae_adult", None),
    ("_source/hanae_adult_angry1_cut.png", "hanae_adult_angry1", None),
    ("_source/hanae_adult_angry2_cut.png", "hanae_adult_angry2", None),
    # 悪魔だけは顔で揃えない。角が頭の上に大きく出るうえ三叉槍まで持っているので、
    # 顔を他と同じ大きさにすると角も槍も枠からはみ出して切れてしまう。
    # ここは「全体を枠に収める」を優先し、上端を 8px に合わせる(最終形態なので
    # 一段大きく見えても違和感がない)
    ("_source/hanae_adult_angry3_cut.png", "hanae_adult_angry3", "fit"),
]


def find_face(im):
    """白地に置いてから顔を探す。背景を抜いた画像そのままだと輪郭が拾えない"""
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, (0, 0), im)
    gray = cv2.cvtColor(np.array(bg), cv2.COLOR_RGB2GRAY)
    cas = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    for sf in (1.05, 1.08, 1.12, 1.2):
        found = cas.detectMultiScale(gray, sf, 4, minSize=(150, 150))
        if len(found):
            x, y, w, h = max(found, key=lambda r: r[2] * r[3])
            return float(x), float(y), float(w), float(h)
    raise SystemExit("顔が見つからない: 手で座標を入れる必要がある")


def build(src_path, out_name, mode=None):
    im = Image.open(src_path).convert("RGBA")
    bb0 = im.getchannel("A").getbbox()

    if mode == "fit":
        # 枠の幅に全体を収め、上端(角の先)を 8px に置く
        scale = (SPRITE_W - 12) / (bb0[2] - bb0[0])
        nw, nh = round(im.width * scale), round(im.height * scale)
        im = im.resize((nw, nh), Image.LANCZOS)
        ox = round((SPRITE_W - (bb0[2] - bb0[0]) * scale) / 2 - bb0[0] * scale)
        oy = round(8 - bb0[1] * scale)
    else:
        fx, fy, fw, fh = find_face(im)
        scale = FACE_SIZE / fw
        nw, nh = round(im.width * scale), round(im.height * scale)
        im = im.resize((nw, nh), Image.LANCZOS)
        # 顔の中心が揃うように置く
        cx = (fx + fw / 2) * scale
        cy = (fy + fh / 2) * scale
        ox, oy = round(FACE_CX - cx), round(FACE_CY - cy)

    canvas = Image.new("RGBA", (SPRITE_W, SPRITE_H), (0, 0, 0, 0))
    canvas.paste(im, (ox, oy), im)

    # 枠の中での体の下端を見て、そこから上へ溶かす
    bb = canvas.getchannel("A").getbbox()
    if bb is None:
        raise SystemExit("空の画像になった: " + src_path)
    bottom = bb[3]
    a = canvas.getchannel("A")
    px = a.load()
    if bottom > FADE:
        for y in range(max(0, bottom - FADE), bottom):
            k = (bottom - 1 - y) / FADE          # 1 → 0
            k = k * k * (3 - 2 * k)              # 端で急に切れないよう滑らかに
            for x in range(SPRITE_W):
                v = px[x, y]
                if v:
                    px[x, y] = int(v * k)
    canvas.putalpha(a)

    out = "assets/%s.webp" % out_name
    canvas.save(out, "WEBP", quality=92, method=6)
    print("%-26s 倍率%.3f 置き位置(%+d,%+d) 頭の上端 y=%s 体の下端 y=%d"
          % (out_name, scale, ox, oy, bb[1], bottom))
    return canvas


if __name__ == "__main__":
    jobs = JOBS
    if len(sys.argv) > 2:
        jobs = [(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)]
    for job in jobs:
        build(*job)
