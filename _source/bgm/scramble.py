"""assets/bgm/*.bin を作る: _source/bgm/m4a/*.m4a の全バイトを xorshift32 の乱数列で XOR する。

    uv run --no-project python _source/bgm/scramble.py

m4a をそのまま公開しないため(DOVA-SYNDROME / OpenTracks の規約 禁止事項 8)。
audio.js の BGM_KEY と同じ鍵で、audio.js が読み込み時に戻す。暗号ではない。
"""
import glob, os

KEY = 0x4A1E0B27          # audio.js の BGM_KEY と同じ値にする
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

def scramble(data):
    s = KEY & 0xFFFFFFFF
    out = bytearray(data)
    for i in range(len(out)):
        s ^= (s << 13) & 0xFFFFFFFF; s ^= s >> 17; s ^= (s << 5) & 0xFFFFFFFF
        out[i] ^= s & 0xFF
    return bytes(out)

for src in sorted(glob.glob(os.path.join(HERE, "m4a", "*.m4a"))):
    name = os.path.splitext(os.path.basename(src))[0]
    data = open(src, "rb").read()
    dst = os.path.join(ROOT, "assets", "bgm", name + ".bin")
    open(dst, "wb").write(scramble(data))
    print(name, len(data))
