# _source/bgm — BGM の元ファイル

配布元: **DOVA-SYNDROME** (https://dova-s.jp/)

ここに置いた `.mp3` は `.gitignore` で **git 管理外**。素材そのものを公開リポジトリに
置くと再配布に当たりうるため。GitHub にバックアップされないので、消すと戻らない。

`assets/bgm/*.m4a` が公開用の変換結果。作品に組み込んだ状態なので、そちらは追跡する。

## 変換手順

音量は素材ごとにバラバラ(実測で最大 8.4dB 差)なので、そのまま使うと場面が
変わるたびに音量が跳ねる。loudnorm の2パスで全曲 -16 LUFS / -1.5dBTP に揃える。

```bash
# 1パス目: 測定
ffmpeg -i _source/bgm/日常・準備期間.mp3 \
  -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -

# 2パス目: 測定値を渡して変換(measured_* は1パス目の出力から)
ffmpeg -y -i _source/bgm/日常・準備期間.mp3 \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=...:measured_TP=...:measured_LRA=...:measured_thresh=...:offset=...:linear=true" \
  -ar 44100 -c:a aac -b:a 96k -movflags +faststart assets/bgm/daily1.m4a
```

形式は **m4a(AAC)**。iOS Safari の ogg 対応が不安定なため。

## ファイルの対応

| 元ファイル | 公開ファイル | 使う場面 |
|---|---|---|
| タイトル.mp3 | `title.m4a` | タイトル画面・プロローグ |
| 日常・準備期間.mp3 | `daily1.m4a` | 日常イベント |
| 日常・準備期間2.mp3 | `daily2.m4a` | 〃 |
| 日常・準備期間3.mp3 | `daily3.m4a` | 〃 |
| 日常・準備期間4.mp3 | `daily4.m4a` | 〃 |
| 日常・準備期間5.mp3 | `daily5.m4a` | 〃 |
| 静かな場面.mp3 | `quiet1.m4a` | 喫茶店・雨・E19 |
| 静かな場面2.mp3 | `quiet2.m4a` | 告白 |
| 緊張・不穏.mp3 | `tension.m4a` | トラブル・吉沢・噂 |
| エンド成立.mp3 | `end_true.m4a` | 成立エンド2種 |
| エンド不成立.mp3 | `end_false.m4a` | 友達・すれ違い・気まずい |
| エンド不成立2.mp3 | `end_rival.m4a` | 吉沢エンド |

## クレジット表記

エンディング画面に DOVA-SYNDROME へのリンクを入れてある。
DOVA は全体としてはクレジット表記を必須にしていないが、**楽曲ごとに作者が
個別規約を設けている場合がある**。12曲の配布ページを確認し、作者名の表記が
必要なものがあればここに書き足して、`index.html` の `.credits` にも反映する。

| 公開ファイル | 楽曲名 | 作者 | 個別規約 |
|---|---|---|---|
| (未記入) | | | |
