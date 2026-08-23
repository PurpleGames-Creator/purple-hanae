# _source — 生成元画像の置き場

**画像生成AIで作った元画像(高解像度PNG)は、全部ここに入れる。**

`assets/` に入っている webp は、ここのPNGから変換した**公開用の軽量版**。
直接 `assets/` を差し替えるのではなく、まずここに原本を置く。

## 運用

作者は画像を作るところまでで、**ここへの格納・変換・配置は Claude 側でやる**。
新しい画像を Claude に見せれば、`Downloads` から実体を探して、リネーム → `_source/` へ格納 →
透過・変換 → `assets/` へ配置 までを一続きで行う。作者が手でファイルを動かす必要はない。

## なぜここに置くのか

- Downloads に置いたままだと**バックアップされない**(日次ミラーの対象は Vault と `~/.claude` だけ)。整理や再インストールで消える
- ここは git 管理下なので、GitHub が原本のバックアップになる
- 表情差分を後から足す時、同じ元画像から作り直せる

## ファイル名の付け方

| 種類 | 名前 | 例 |
|---|---|---|
| 立ち絵 | `hanae_<構図>_<YYYY-MM-DD>.png` | `hanae_standing_2026-08-23.png` |
| 背景 | `bg_<ローマ字>.png` | `bg_kyoshitsu.png` |

## assets/ への変換

変換は ffmpeg で行う(手作業でリサイズしない)。

```bash
# 背景: 1280x720 の webp に
ffmpeg -y -i _source/bg_kyoshitsu.png -vf "scale=1280:720" -c:v libwebp -quality 76 assets/bg_classroom.webp

# 立ち絵: 透過PNGを webp に(透過を保つので -quality は高めに)
ffmpeg -y -i cut.png -c:v libwebp -quality 92 assets/hanae_summer.webp
```

## 表情差分の作り方(1枚ずつ)

ChatGPT に作らせる場合、**毎回わずかに違う構図・大きさで描かれる**。そのまま並べると
クロスフェードで顔が飛ぶので、必ず位置合わせを通すこと。

```bash
# 1) ChatGPT の出力を _source に置く(参照画像は _source/ref_hanae_summer.png)

# 2) 背景を透過
uvx --from "rembg[cli,cpu]" rembg i -m isnet-anime _source/xxx.png cut.png

# 3) ベース画像へ位置合わせ(頭の位置と、上半身シルエットの一致度で倍率を決める)
uv run --with pillow --with numpy python _source/align_sprite.py cut.png aligned.png

# 4) webp 化して配置
ffmpeg -y -i aligned.png -c:v libwebp -pix_fmt yuva420p -quality 88 assets/hanae_summer_<expr>.webp
```

`align_sprite.py` は最後に「上半身シルエット IoU」を表示する。**0.90 未満なら警告が出る**ので、
その場合はポーズか構図が元画像と違っている。作り直した方が早い。

実績:

| 表情 | IoU | 倍率 | 頭頂のズレ | 頭中心のズレ |
|---|---|---|---|---|
| trouble | 0.9255 | 0.692 | +0 | 2.5px |
| lonely | 0.9211 | 0.632 | +1 | 0.0px |

倍率が毎回大きく違う(0.69 / 0.63)ことから分かるとおり、ChatGPT は指示しても
構図を揃えてくれない。位置合わせは必須。
