# _source — 生成元画像の置き場

**画像生成AIで作った元画像(高解像度PNG)は、全部ここに入れる。**

`assets/` に入っている webp は、ここのPNGから変換した**公開用の軽量版**。
直接 `assets/` を差し替えるのではなく、まずここに原本を置く。

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

立ち絵の背景透過は `rembg`(anime向けモデル)で行う。

```bash
uvx --from "rembg[cli,cpu]" rembg i -m isnet-anime 入力.png 出力.png
```
