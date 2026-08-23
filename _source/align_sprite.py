# 表情差分の位置合わせ。
#
# ChatGPT に表情差分を作らせると、毎回わずかに違う構図・大きさで描かれる。
# そのまま並べるとクロスフェードで顔が飛ぶので、ベース画像へ合わせ込む。
#
# 方式:
#   ・水平位置と頭頂は「頭の輪郭」から直接取る(安定している)
#   ・倍率だけは、上半身のシルエット一致度(IoU)が最大になる値を総当たりで探す
#     肩の位置を幅から推定する方式は、ポニーテールの広がりで16%ずれたため不採用
#   ・脚の切れる位置は絵ごとに違うので、比較は上から60%の範囲に限定する
#
# 使い方:
#   uv run --with pillow --with numpy python _source/align_sprite.py <切り抜き済みPNG> <出力PNG> [基準webp]
#
# 前提: 入力は背景透過済み(rembg 済み)であること。
import sys
import numpy as np
from PIL import Image

ALPHA_THR = 12


def mask_of(im):
    a = np.array(im.split()[3])
    return a > ALPHA_THR


def head_anchor(m):
    """頭頂の行と、頭頂付近の水平中心を返す。ポニーテールの影響を避けるため
    中心は頭頂から少しだけ下までの行で取る。"""
    rows = np.where(m.any(axis=1))[0]
    if rows.size == 0:
        raise SystemExit("不透明ピクセルが見つかりません")
    top = int(rows[0])
    span = max(3, int(m.shape[0] * 0.05))
    seg = m[top:top + span]
    cols = np.where(seg.any(axis=0))[0]
    cx = float((cols[0] + cols[-1]) / 2.0) if cols.size else m.shape[1] / 2.0
    return top, cx


def place(src_im, scale, ref_size, ref_top, ref_cx):
    """src を scale 倍して、頭頂と水平中心が基準に一致する位置へ置く"""
    w = max(1, int(round(src_im.width * scale)))
    h = max(1, int(round(src_im.height * scale)))
    sc = src_im.resize((w, h), Image.LANCZOS)
    t, cx = head_anchor(mask_of(sc))
    dx = int(round(ref_cx - cx))
    dy = int(round(ref_top - t))
    canvas = Image.new("RGBA", ref_size, (0, 0, 0, 0))
    canvas.paste(sc, (dx, dy), sc)
    return canvas, scale, dx, dy


def iou_upper(a, b, ratio=0.6):
    """上から ratio の範囲だけで重なり具合を測る。
    脚の切れる位置は絵ごとに違うので下半身は比較しない。"""
    rows = np.where(a.any(axis=1))[0]
    if rows.size == 0:
        return 0.0
    lo, hi = int(rows[0]), int(rows[0] + (rows[-1] - rows[0]) * ratio)
    aa, bb = a[lo:hi], b[lo:hi]
    inter = np.logical_and(aa, bb).sum()
    union = np.logical_or(aa, bb).sum()
    return float(inter) / union if union else 0.0


def main():
    if len(sys.argv) < 3:
        raise SystemExit("引数: <入力PNG> <出力PNG> [基準webp]")
    src_path, out_path = sys.argv[1], sys.argv[2]
    ref_path = sys.argv[3] if len(sys.argv) > 3 else "assets/hanae_summer.webp"

    ref = Image.open(ref_path).convert("RGBA")
    src = Image.open(src_path).convert("RGBA")
    ref_m = mask_of(ref)
    ref_top, ref_cx = head_anchor(ref_m)

    # 粗探索 → 細探索
    best = None
    for step, lo, hi in ((0.02, 0.60, 1.60), (0.002, None, None)):
        if lo is None:
            lo, hi = best[1] - 0.03, best[1] + 0.03
        s = lo
        while s <= hi + 1e-9:
            cand, sc, dx, dy = place(src, s, ref.size, ref_top, ref_cx)
            score = iou_upper(ref_m, mask_of(cand))
            if best is None or score > best[0]:
                best = (score, sc, dx, dy)
            s += step

    score, scale, dx, dy = best
    out, _, _, _ = place(src, scale, ref.size, ref_top, ref_cx)
    out.save(out_path)

    done_m = mask_of(out)
    d_top, d_cx = head_anchor(done_m)
    print("基準  : %dx%d 頭頂y=%d 頭中心x=%.1f" % (ref.width, ref.height, ref_top, ref_cx))
    print("入力  : %dx%d" % (src.width, src.height))
    print("補正  : 倍率 %.4f / 平行移動 (%d, %d)" % (scale, dx, dy))
    print("一致度: 上半身シルエット IoU = %.4f" % score)
    print("検証  : 頭頂y=%d(差 %+d) 頭中心x=%.1f(差 %+.1f)"
          % (d_top, d_top - ref_top, d_cx, d_cx - ref_cx))
    if score < 0.90:
        print("警告  : 一致度が低い。ポーズか構図が元画像と違う可能性がある")


if __name__ == "__main__":
    main()
