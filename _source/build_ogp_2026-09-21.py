"""OGP 画像から説明文「文化祭実行委員として出逢った、味村ハナエへの物語」を消す(2026-09-21 本人指示)。

土台は build_ogp_2026-09-11.py(2行目を消した時)と同じで、文字の帯の中を
「背景 × 幕の濃さ」で作り直して貼り替える。幕の濃さは、文字・ロゴ・立ち絵を除いた
周りの画素から正規化畳み込みでなめらかに補う。

この行には2行目に無かった事情がある —— **行末の「物語」がハナエの左袖に掛かっている**。
袖の上の文字は背景では作り直せない(そこに写っているのは背景ではなく白い袖)ので、二段構えにする:

1. 袖より左: 背景で作り直して貼り替える
2. 袖の上: 白い袖に白い文字が重なっているので、見えているのは黒い縁取りと影だけ。
   その暗い画素だけを拾って周りの袖から塗り直す(inpaint)。白い本体は袖の白に溶ける

袖の境目は、文字の無い行(帯の上下)で「白が始まる x」を測り、帯の中は直線で補う。

    uv run --with pillow --with numpy --with opencv-python-headless python _source/build_ogp_2026-09-21.py assets/ogp.jpg [preview.png]
"""
import sys

import cv2
import numpy as np
from PIL import Image, ImageOps

SRC = "_source/ogp_2026-09-13.jpg"   # 2026-09-13 版の assets/ogp.jpg をそのまま残したもの
BG = "_source/bg_kyoshitsu.png"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ogp_new.jpg"
PREVIEW = sys.argv[2] if len(sys.argv) > 2 else None

# 貼り替える帯。文字は 446〜473 行(実測)、影がその下 7〜8 行に伸びる
BY0, BY1, BX0 = 438, 486, 60
FEATHER = 5
SLEEVE_X0, SLEEVE_X1 = 700, 860     # 袖の境目を探す範囲
TAIL_X1 = 840                        # 「語」+ 影の右端(812 + 数 px)より右は触らない

ogp = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
H, W, _ = ogp.shape
bg0 = np.asarray(ImageOps.fit(Image.open(BG).convert("RGB"), (W, H), Image.LANCZOS)).astype(np.float32)
light = ogp.mean(axis=2)

# ---- 袖の境目(白が始まる x)を、文字の無い行から測って直線で補う ----
def sleeve_edge(y):
    row = light[y, SLEEVE_X0:SLEEVE_X1]
    for i in range(len(row) - 6):
        if (row[i:i + 6] > 200).all():
            return SLEEVE_X0 + i
    return None


clean = [(y, sleeve_edge(y)) for y in list(range(424, 438)) + list(range(487, 500))]
clean = [(y, x) for y, x in clean if x is not None]
ys = np.array([y for y, _ in clean], float)
xs = np.array([x for _, x in clean], float)
slope, intercept = np.polyfit(ys, xs, 1)
resid = float(np.abs(np.polyval([slope, intercept], ys) - xs).max())
print(f"袖の境目: x = {slope:.2f}*y + {intercept:.1f} (最大ずれ {resid:.1f}px, {len(clean)}行から)")
if resid > 6:
    sys.exit("袖の境目が直線で表せない。範囲を測り直すこと")

edge = np.polyval([slope, intercept], np.arange(H)).astype(int)   # 行ごとの境目
xs_all = np.arange(W)[None, :]
left_of_sleeve = xs_all < (edge[:, None] - 2)                      # 袖の手前 2px から先は触らない

# ---- 1. 袖より左: 背景で作り直す ----
known = np.ones((H, W), np.float32)
known[BY0:BY1, BX0:TAIL_X1] = 0       # 帯(ここを作り直す)
known[570:602, 70:270] = 0            # Purple Games
known[140:400, 70:680] = 0            # ロゴ
known[~left_of_sleeve] = 0            # 立ち絵
known[light > 200] = 0                # 取りこぼした白い画素


def smooth(a, m, s):
    num = cv2.GaussianBlur(a * m, (0, 0), s)
    den = cv2.GaussianBlur(m, (0, 0), s)
    return num / np.maximum(den, 1e-4)


def recon(blur):
    bg = cv2.GaussianBlur(bg0, (0, 0), blur) if blur else bg0
    gain = np.stack([smooth(ogp[..., c], known, 14) / np.maximum(smooth(bg[..., c], known, 14), 1)
                     for c in range(3)], axis=2)
    return bg * gain


# 背景のぼかし具合は、帯のすぐ下(2026-09-11 に2行目を消した帯。背景だけが写っている)で決める
probe = (slice(500, 560), slice(280, 740))
errs = {b: float(np.abs(recon(b)[probe] - ogp[probe]).mean()) for b in (0, 0.6, 1.0, 1.5, 2.0, 3.0)}
blur = min(errs, key=errs.get)
rec = recon(blur)

alpha = np.zeros((H, W), np.float32)
alpha[BY0:BY1, BX0:TAIL_X1] = 1
alpha = cv2.blur(alpha, (FEATHER * 2 + 1, FEATHER * 2 + 1))
alpha[BY0 + FEATHER:BY1 - FEATHER, BX0 + FEATHER:TAIL_X1 - FEATHER] = 1
alpha *= left_of_sleeve                                            # 袖には掛けない
out = ogp * (1 - alpha[..., None]) + rec * alpha[..., None]

# ---- 2. 袖の上: 黒い縁取りと影だけを塗り直す ----
u8 = np.clip(out, 0, 255).astype(np.uint8)
dark = np.zeros((H, W), np.uint8)
zone = np.zeros((H, W), bool)
zone[BY0:BY1 + 6, :TAIL_X1] = True
zone &= ~left_of_sleeve
dark[zone & (u8.mean(axis=2) < 150)] = 255
dark = cv2.dilate(dark, np.ones((5, 5), np.uint8))
fixed = cv2.inpaint(cv2.cvtColor(u8, cv2.COLOR_RGB2BGR), dark, 4, cv2.INPAINT_TELEA)
out = cv2.cvtColor(fixed, cv2.COLOR_BGR2RGB).astype(np.float32)

# ---- 検査 ----
band = (slice(BY0, BY1), slice(BX0, TAIL_X1))
# (1) 袖の手前: 作り直した背景から外れた画素が残っていないか(= 文字の消し残り)
m_left = left_of_sleeve[band]
off = float((np.abs(out[band] - rec[band]).max(axis=2)[m_left] > 40).mean() * 100)
# (2) 袖の上: 暗い画素(縁取り・影)が残っていないか。
# 境目のすぐ内側(2px)は背景側の画素が混じるので、そこは数えない
m_sleeve = (xs_all >= (edge[:, None] + 2))[band]
dark_left = int((out[band].mean(axis=2)[m_sleeve] < 150).sum())
# (3) 継ぎ目: 帯のすぐ外(手を入れていない行)で、作り直した背景が原本とどれだけずれるか
ring = np.zeros((H, W), bool)
ring[BY0 - 6:BY0, BX0:TAIL_X1] = True
ring[BY1:BY1 + 6, BX0:TAIL_X1] = True
ring &= (light < 200) & left_of_sleeve
seam = float(np.abs(rec[ring] - ogp[ring]).mean())

Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(OUT, quality=90, optimize=True)
print(f"blur={blur} errs={ {k: round(v, 2) for k, v in errs.items()} }")
print(f"消し残り: 袖の手前 {off:.2f}% / 袖の上 {dark_left}px   seam_mae={seam:.2f} -> {OUT}")
if off > 0.5:
    sys.exit("袖の手前に文字が残っている")
if dark_left > 20:
    sys.exit("袖の上に縁取りか影が残っている")
if seam > 6:
    sys.exit(f"継ぎ目が合っていない(mae {seam:.2f})")

if PREVIEW:
    crop = (BX0 - 20, BY0 - 30, TAIL_X1 + 60, BY1 + 30)
    before = Image.open(SRC).convert("RGB").crop(crop)
    after = Image.open(OUT).convert("RGB").crop(crop)
    sheet = Image.new("RGB", (before.width, before.height * 2 + 6), (255, 0, 255))
    sheet.paste(before, (0, 0))
    sheet.paste(after, (0, before.height + 6))
    sheet.save(PREVIEW)
    print(f"preview (上=原本 / 下=消したあと) -> {PREVIEW}")
