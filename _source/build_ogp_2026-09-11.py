"""OGP 画像から2行目の説明文を消す(2026-09-11)。

元の assets/ogp.jpg(2026-09-04 作成。原本は _source/ogp_2026-09-04.jpg)は Pillow でその場で
合成したもので、作り方が残っていない。作り直すと見た目が変わるので、原本の2行目
「好感度は表示されない。返ってくる言葉と、その顔だけが手がかり。」の帯だけを、背景で作り直して
貼り替える。好感度表示をオンにできるようになり、事実と合わなくなったため(本人指示)。

分かったこと(輪郭の相関で実測):
- 背景は _source/bg_kyoshitsu.png(1920x1080)を ImageOps.fit で 1200x630 に敷いたもの
  (0.625 倍 → 1200x675、上下の中央を切り出し)。明るさで比べると左から掛かった暗い幕に
  引っ張られて一致しない(NCC 0.64)が、輪郭で比べると 0.92 で一致する
- 文字には黒い影が付いていて、白い画素だけを塗り直す(インペイント)と影が残る

やり方: 帯の中を「背景 × 幕の濃さ」で作り直す。幕の濃さは、文字・ロゴ・立ち絵を除いた
周りの画素から、正規化畳み込みでなめらかに補う。上下の境目は数ピクセルかけてなじませる。

    uv run --with pillow --with numpy --with opencv-python-headless python _source/build_ogp_2026-09-11.py assets/ogp.jpg
"""
import sys

import cv2
import numpy as np
from PIL import Image, ImageOps

SRC = "_source/ogp_2026-09-04.jpg"
BG = "_source/bg_kyoshitsu.png"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ogp_new.jpg"

# 貼り替える帯。2行目の文字は 494〜516 行、影がその下 4〜6 行に伸びる。
# 1行目(448〜473 行)の影は 480 行あたりまでなので、上端は 486 にする
BY0, BY1, BX0, BX1 = 486, 530, 70, 800
FEATHER = 5

ogp = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
H, W, _ = ogp.shape
bg_full = ImageOps.fit(Image.open(BG).convert("RGB"), (W, H), Image.LANCZOS)
bg0 = np.asarray(bg_full).astype(np.float32)

# 周りの「背景だけが写っている」画素。文字の行・ロゴ・立ち絵・帯そのものを除く
known = np.ones((H, W), np.float32)
known[BY0:BY1, BX0:BX1] = 0          # 帯(ここを作り直す)
known[440:486, 70:820] = 0           # 1行目とその影
known[570:602, 70:270] = 0           # Purple Games
known[140:400, 70:680] = 0           # ロゴ
known[:, 790:] = 0                   # 立ち絵
light = ogp.mean(axis=2)
known[light > 200] = 0               # 取りこぼした白い文字の画素

def smooth(a, m, s):
    num = cv2.GaussianBlur(a * m, (0, 0), s)
    den = cv2.GaussianBlur(m, (0, 0), s)
    return num / np.maximum(den, 1e-4)

# 背景にぼかしが掛かっているかを、机の帯(帯の下、Purple Games の右)の誤差で決める
def recon(blur):
    bg = cv2.GaussianBlur(bg0, (0, 0), blur) if blur else bg0
    gain = np.stack([smooth(ogp[..., c], known, 14) / np.maximum(smooth(bg[..., c], known, 14), 1)
                     for c in range(3)], axis=2)
    return bg * gain
probe = (slice(532, 568), slice(280, 780))
errs = {b: float(np.abs(recon(b)[probe] - ogp[probe]).mean()) for b in (0, 0.6, 1.0, 1.5, 2.0, 3.0)}
blur = min(errs, key=errs.get)
rec = recon(blur)

# 帯の上下の端はなじませる(外側の原本へ向けて重みを 0 に落とす)
alpha = np.zeros((H, W), np.float32)
alpha[BY0:BY1, BX0:BX1] = 1
alpha = cv2.blur(alpha, (FEATHER * 2 + 1, FEATHER * 2 + 1))
alpha[BY0 + FEATHER:BY1 - FEATHER, BX0 + FEATHER:BX1 - FEATHER] = 1

# 帯の右端はハナエの左の袖(x 760 前後)に掛かる。袖は触らない。
# 白い塊のうち、帯の外まで上下につながっているものが立ち絵(文字は帯の中で完結している)
lab_rows = slice(BY0 - 10, BY1 + 10)
bright = (light[lab_rows] > 150).astype(np.uint8)
# 最後の「。」と「り」の一画は袖の縁と数ピクセルしか離れておらず、そのままだと袖と
# ひと続きに見える。先に細らせて(オープニング)細いつながりを切ってから塊を分ける
bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
n, labels = cv2.connectedComponents(bright, connectivity=8)
top_ids = set(np.unique(labels[0])) | set(np.unique(labels[-1]))
top_ids.discard(0)
sprite = np.zeros((H, W), np.uint8)
sprite[lab_rows] = np.isin(labels, list(top_ids)).astype(np.uint8)
sprite[:, :700] = 0                  # 立ち絵は右にしかいない(背景の明るい点は拾わない)
# 袖の縁の線(1〜2px)まで守る。広げすぎると「。」が守る側に入る
sprite = cv2.dilate(sprite, np.ones((5, 5), np.uint8))
keep = cv2.GaussianBlur(sprite.astype(np.float32), (0, 0), 0.8)
alpha *= 1 - np.clip(keep * 2, 0, 1)
out = ogp * (1 - alpha[..., None]) + rec * alpha[..., None]

# 袖の縁に「。」の黒い影が 2〜3px の点で残る(袖を守った範囲に入るため)。
# 袖の縁の線は灰色なので、それよりはっきり暗い点だけを拾って周りから塗り直す
u8 = np.clip(out, 0, 255).astype(np.uint8)
speck = np.zeros((H, W), np.uint8)
zone = (slice(496, 524), slice(738, 764))
speck[zone] = (u8[zone].mean(axis=2) < 80).astype(np.uint8) * 255
speck = cv2.dilate(speck, np.ones((3, 3), np.uint8))
fixed = cv2.inpaint(cv2.cvtColor(u8, cv2.COLOR_RGB2BGR), speck, 3, cv2.INPAINT_TELEA)
out = cv2.cvtColor(fixed, cv2.COLOR_BGR2RGB).astype(np.float32)
print(f"speck px: {int((speck > 0).sum())}")

# 継ぎ目の検査: 帯のすぐ外(手を入れていない行)で、作り直した背景が原本とどれだけずれるか
ring = np.zeros((H, W), bool)
ring[BY0 - 6:BY0, BX0:BX1] = True
ring[BY1:BY1 + 6, BX0:BX1] = True
ring &= light < 200
seam = float(np.abs(rec[ring] - ogp[ring]).mean())
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(OUT, quality=90, optimize=True)
print(f"blur={blur} errs={ {k: round(v, 2) for k, v in errs.items()} } seam_mae={seam:.2f} -> {OUT}")
