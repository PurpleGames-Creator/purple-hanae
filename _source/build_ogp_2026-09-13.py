"""OGP 画像の説明文「文化祭実行委員として出会った、味村ハナエへの物語」の「会」を「逢」に差し替える(2026-09-13)。

「であう」は「出逢う」で統一する(本人指示)。文字は 2026-09-04 に Pillow + メイリオで焼き込んだもので、
書体・大きさ・影の付け方が残っていない。一行ぜんぶ描き直すと他の文字まで変わるので、
「会」のまわりだけを貼り替える。

1. 書体と大きさ: 候補を総当たりで描き、原本の白い文字との相関(TM_CCOEFF_NORMED)が最大のものを採る
2. 文字の下の背景: build_ogp_2026-09-11.py と同じく、_source/bg_kyoshitsu.png に「幕の濃さ」を掛けて作り直す
3. 影: 縁取りの太さ・ずらし量・ぼかし・濃さを総当たりし、文字のまわりで原本との誤差が最小のものを採る
4. 検査: その条件で旧文字列を描き直した誤差が、文字を描かない時の誤差の 40% を超えたら止める
   (= 書体か影の当て方が外れている。外れたまま「逢」だけ描くと、そこだけ浮く)
5. 新旧の文字列で描画が変わる画素(「会」「逢」とその影)だけを、少しぼかした境目で貼り替える。
   ほかの23文字は原本の画素のまま

    uv run --with pillow --with numpy --with opencv-python-headless python _source/build_ogp_2026-09-13.py assets/ogp.jpg [preview.png]
"""
import itertools
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

SRC = "_source/ogp_2026-09-11.jpg"   # 2026-09-11 版の assets/ogp.jpg をそのまま残したもの
BG = "_source/bg_kyoshitsu.png"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ogp_new.jpg"
PREVIEW = sys.argv[2] if len(sys.argv) > 2 else None

OLD = "文化祭実行委員として出会った、味村ハナエへの物語"
NEW = "文化祭実行委員として出逢った、味村ハナエへの物語"

# 1行目の文字は 448〜473 行、影は 480 行あたりまで(build_ogp_2026-09-11.py の実測)。
# 右端はハナエの袖に掛かるので、x 780 から先は相関にも誤差にも使わない
BY0, BY1 = 430, 496
SX0, SX1 = 30, 840
SLEEVE = 780

FONTS = [
    ("C:/Windows/Fonts/meiryob.ttc", 0), ("C:/Windows/Fonts/meiryob.ttc", 1),
    ("C:/Windows/Fonts/meiryo.ttc", 0), ("C:/Windows/Fonts/meiryo.ttc", 1),
    ("C:/Windows/Fonts/YuGothB.ttc", 0), ("C:/Windows/Fonts/YuGothM.ttc", 0),
    ("C:/Windows/Fonts/BIZ-UDGothicB.ttc", 0), ("C:/Windows/Fonts/msgothic.ttc", 0),
]
SIZES = range(22, 39)

ogp = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
H, W, _ = ogp.shape
light = ogp.mean(axis=2)


def draw_alpha(text, font, origin, stroke=0):
    im = Image.new("L", (W, H), 0)
    ImageDraw.Draw(im).text(origin, text, font=font, fill=255, stroke_width=stroke, stroke_fill=255)
    return np.asarray(im).astype(np.float32) / 255


# ---- 1. 書体と大きさ ----
white = np.clip((light[BY0:BY1, SX0:SX1] - 110) / 145, 0, 1).astype(np.float32)
white[:, SLEEVE - SX0:] = 0

best = None
for (path, idx), size in itertools.product(FONTS, SIZES):
    font = ImageFont.truetype(path, size, index=idx)
    l, t, r, b = font.getbbox(OLD)
    im = Image.new("L", (r - l + 8, b - t + 8), 0)
    ImageDraw.Draw(im).text((4 - l, 4 - t), OLD, font=font, fill=255)
    a = np.asarray(im).astype(np.float32) / 255
    ys, xs = np.nonzero(a > 0.02)
    cy, cx = int(ys.min()), int(xs.min())
    tmpl = np.ascontiguousarray(a[cy:ys.max() + 1, cx:xs.max() + 1])
    if tmpl.shape[0] >= white.shape[0] or tmpl.shape[1] >= white.shape[1]:
        continue
    res = cv2.matchTemplate(white, tmpl, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(res)
    if best is None or score > best[0]:
        origin = (SX0 + loc[0] + (4 - l) - cx, BY0 + loc[1] + (4 - t) - cy)
        best = (score, path, idx, size, origin)

score, fpath, fidx, fsize, ORIGIN = best
font = ImageFont.truetype(fpath, fsize, index=fidx)
print(f"font={fpath.split('/')[-1]}#{fidx} size={fsize} origin={ORIGIN} ncc={score:.3f}")
if abs(font.getlength(OLD) - font.getlength(NEW)) > 0.5:
    sys.exit("「会」と「逢」の送り幅が違う。後ろの文字がずれるので、この方法では差し替えられない")

# ---- 2. 文字の下の背景 ----
bg0 = np.asarray(ImageOps.fit(Image.open(BG).convert("RGB"), (W, H), Image.LANCZOS)).astype(np.float32)
known = np.ones((H, W), np.float32)
known[BY0:BY1 + 4, 20:850] = 0       # 1行目とその影
known[570:602, 70:270] = 0           # Purple Games
known[140:400, 70:680] = 0           # ロゴ
known[:, SLEEVE:] = 0                # 立ち絵
known[light > 200] = 0               # 取りこぼした白い画素


def smooth(a, m, s):
    num = cv2.GaussianBlur(a * m, (0, 0), s)
    den = cv2.GaussianBlur(m, (0, 0), s)
    return num / np.maximum(den, 1e-4)


def recon(blur):
    bg = cv2.GaussianBlur(bg0, (0, 0), blur) if blur else bg0
    gain = np.stack([smooth(ogp[..., c], known, 14) / np.maximum(smooth(bg[..., c], known, 14), 1)
                     for c in range(3)], axis=2)
    return bg * gain


probe = (slice(500, 560), slice(280, 760))   # 1行目の下(2026-09-11 に2行目を消した帯。背景だけが写っている)
errs = {b: float(np.abs(recon(b)[probe] - ogp[probe]).mean()) for b in (0, 0.6, 1.0, 1.5, 2.0, 3.0)}
blur = min(errs, key=errs.get)
rec = recon(blur)
print(f"bg blur={blur} probe_mae={errs[blur]:.2f}")

# ---- 3. 影 ----
WIN = (slice(400, 530), slice(0, 900))
A_old = draw_alpha(OLD, font, ORIGIN)
A_new = draw_alpha(NEW, font, ORIGIN)
xs_all = np.arange(W)[None, :]
core = (A_old > 0.9) & (xs_all < SLEEVE)
color = np.median(ogp[core], axis=0)
print(f"text color={color.round(1)}")

zone = np.zeros((H, W), bool)
zone[BY0:BY1, SX0:SLEEVE] = True
near = cv2.dilate((A_old > 0.02).astype(np.uint8), np.ones((13, 13), np.uint8)).astype(bool) & zone

rec_w, ogp_w, near_w = rec[WIN], ogp[WIN], near[WIN]
Aw_old, Aw_new = A_old[WIN], A_new[WIN]
sources = {(txt, s): draw_alpha(txt, font, ORIGIN, s)[WIN] for txt in (OLD, NEW) for s in (0, 1, 2)}
blurred = {}


def compose(A, txt, s, dx, dy, r, a):
    key = (txt, s, r)
    if key not in blurred:
        src = sources[(txt, s)]
        blurred[key] = cv2.GaussianBlur(src, (0, 0), r) if r else src
    S = np.roll(blurred[key], (dy, dx), axis=(0, 1)) * a
    out = rec_w * (1 - S[..., None])
    return out * (1 - A[..., None]) + color * A[..., None]


base_err = float(np.abs(rec_w - ogp_w)[near_w].mean())
fit = None
for s, dx, dy, r, a in itertools.product((0, 1, 2), range(0, 5), range(0, 5), (0, 0.8, 1.5, 2.5),
                                         (0.3, 0.5, 0.7, 0.85, 1.0)):
    err = float(np.abs(compose(Aw_old, OLD, s, dx, dy, r, a) - ogp_w)[near_w].mean())
    if fit is None or err < fit[0]:
        fit = (err, s, dx, dy, r, a)
err, s, dx, dy, r, a = fit
print(f"shadow stroke={s} dx={dx} dy={dy} blur={r} alpha={a}  mae_near_text={err:.2f}  (bg only {base_err:.2f})")

# ---- 4. 検査 ----
if err > base_err * 0.4:
    sys.exit(f"旧文字列の描き直しが原本と合わない(mae {err:.2f} > {base_err * 0.4:.2f})。書体か影の当て方が外れている")

# ---- 5. 変わる画素だけ貼り替える ----
out_old = compose(Aw_old, OLD, s, dx, dy, r, a)
out_new = compose(Aw_new, NEW, s, dx, dy, r, a)
diff = (np.abs(out_new - out_old).max(axis=2) > 2).astype(np.uint8)
m = cv2.dilate(diff, np.ones((5, 5), np.uint8)).astype(np.float32)
m = np.clip(cv2.GaussianBlur(m, (0, 0), 1.2) * 1.5, 0, 1)
ys, xs = np.nonzero(m > 0.01)
y0, y1, x0, x1 = ys.min() + WIN[0].start, ys.max() + WIN[0].start, xs.min() + WIN[1].start, xs.max() + WIN[1].start
print(f"patch rows {y0}-{y1} cols {x0}-{x1}")
if x1 >= SLEEVE:
    sys.exit("貼り替え範囲が立ち絵に掛かる")

final = ogp.copy()
final[WIN] = ogp_w * (1 - m[..., None]) + out_new * m[..., None]
result = Image.fromarray(np.clip(final, 0, 255).round().astype(np.uint8))
result.save(OUT, quality=90, optimize=True)
print(f"-> {OUT}")

if PREVIEW:
    crop = (x0 - 110, y0 - 20, x1 + 110, y1 + 20)
    before = Image.open(SRC).convert("RGB").crop(crop)
    after = Image.open(OUT).convert("RGB").crop(crop)
    sheet = Image.new("RGB", (before.width, before.height * 2 + 6), (255, 0, 255))
    sheet.paste(before, (0, 0))
    sheet.paste(after, (0, before.height + 6))
    sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.LANCZOS)
    sheet.save(PREVIEW)
    print(f"preview (上=原本 / 下=差し替え後) -> {PREVIEW}")
