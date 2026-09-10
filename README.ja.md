# mdok — Markdown OK

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

`.md` ファイル用のターミナル TUI エディタ:サイドバーエクスプローラ + ソース +
ライブプレビュー、テーマ、タブ、検索/置換、lint、シェル実行、そして BYOK LLM
(質問 + リライト)。

## インストール

```sh
npm install -g @daystar7777/mdok
```

> `mdok: command not found`? シェルが npm のグローバル bin を見ていません。
> インストーラが正しい `export PATH=…` を表示します。
> 手動確認: `npm prefix -g` の `<prefix>/bin` が `PATH` にあるか。

ソースから (Node.js 22+ が必要):

```sh
npm install
npm run build
npm link  # または: node dist/index.js
```

## 使い方

```sh
mdok README.md      # 指定したファイルだけ開く
mdok                # 前回のセッションを再開
mdok view README.md # 非対話式のきれいな表示 (パイプ、スクリプト用)
mdok README.md | less

# 開いているファイルに LLM で質問 (BYOK、ストリーミング)
export MDOK_API_KEY=sk-...
mdok ask README.md -q "この文書を3行で要約して"

# lint + export (TUI 内でも可)
mdok lint README.md
mdok export README.md -o out.html

# 設定 (TUI 内で ^O c からも全部できる)
mdok config --url https://api.openai.com/v1 --model gpt-4o-mini
mdok config --key sk-... --theme ocean --git on --lang ko
```

設定は `~/.mdok.json` に保存 (`MDOK_API_KEY`、`MDOK_BASE_URL`、`MDOK_MODEL`、
`MDOK_LANG` 環境変数が優先)。セッション (開いているタブ、カーソル、未保存バッファ)
は `~/.mdok-session.json`。

## 言語 & テーマ

- UI 言語: 日本語 / English / 한국어。設定で切替 (`^O c` → language)、
  `mdok config --lang ko`、または `MDOK_LANG=ko`。TUI と CLI メッセージに適用。
- テーマ: `forest · ocean · sunset · mono · rose`、`^O t` で循環 (記憶される)。
  `~/.mdok-themes.json` で自作も可能:
  ```json
  { "themes": [{ "name": "mine", "focus": "cyan", "selBg": "blue",
    "selFg": "white", "findBg": "yellow", "findFg": "black",
    "findCurBg": "red", "findCurFg": "white", "accent": "cyan" }] }
  ```
- CJK テキスト (한글/漢字/emoji) は表示幅で測るので、編集中もカーソル・選択・
  マウスクリックがずれない。

## TUI キー

| キー | 動作 |
|---|---|
| `Ctrl+O`, `Tab` / `e` / `p` | ペイン切替 · ソース/プレビューへ移動 |
| `Ctrl+O`, `1`–`9` / `w` | タブ切替 / タブを閉じる |
| `Ctrl+O`, `v` | 分割 / ソース / プレビューを循環 |
| `Ctrl+O`, `b` | サイドバー切替 (最近 · 目次 · 作業フォルダ) |
| `Ctrl+O`, `f` | ファイルメニュー (保存 · 新規 · 開く… · 実行… · HTML書出 · タブを閉じる) |
| `Ctrl+O`, `a` | 開いているファイルに LLM で質問、プレビューにストリーミング (`Esc` で中止) |
| `Ctrl+O`, `R` | 選択範囲を AI リライト、diff を見て適用/破棄 |
| `Ctrl+O`, `/` | 検索; `Tab` = 置換欄、`Enter` = 検索/置換、`n`/`N` 次/前 |
| `Ctrl+O`, `!` | シェルコマンド実行、結果はエディタ内に表示 |
| `Ctrl+O`, `L` / `F` | 問題一覧 / バッファ整形 |
| `Ctrl+O`, `\|` | カーソル位置のパイプテーブル整形 |
| `Ctrl+O`, `t` / `l` | テーマ循環 (記憶される) / 行番号 |
| `Ctrl+O`, `V` | vim モード (hjkl/i/a/A/o/x/0/$/G、`Esc` = normal) |
| `Ctrl+O`, `m` または `F10` (Alt+M も可) | メニューバーにフォーカス |
| `←`/`→`, `Enter`, `Esc` (メニューバー) | 移動 · 実行 · キャンセル |
| `Ctrl+O`, `g` | git 同期パネル (push / pull --rebase / commit / 自動切替) |
| `Ctrl+O`, `c` / `?` | 設定 / ヘルプ |
| `Ctrl+O`, `s` または `Ctrl+S` | 保存 |
| `Ctrl+O`, `q` または `Ctrl+Q` | 終了 (変更があれば2回) |
| `Shift`+矢印 | テキスト選択 |
| `Tab` (ソース内) | スペース2つ挿入 |

トップバーのボタン (`[>]` `[Split]` `[Ask]` `[Find]` `[File]` `[Shell]` `[Set]` `[?]` `[X]`、
`[+]` 付きタブバー) はクリック可能で上記キーと1対1対応。サイドバーとシェル出力は
初期状態で閉じている (`^O b`、`[Shell]` ボタン)。

(注意: `Ctrl+M` は使えない — 端末が Enter として報告するため。`F10`/`^O m` を使う。)

## マウス

クリックでカーソル配置 / タブ切替 / ボタン押下、ドラッグ選択 (入力すると置換)、
ホイールはポインタ下のペインをスクロール。SGR 対応端末 (iTerm2、WezTerm、Ghostty、
VSCode など) とレガシー X10 端末 (macOS 標準ターミナル: クリック可、ホイール不可 —
Apple の制限) に対応。

tmux: `~/.tmux.conf` に `set -g mouse on` が必要。代替: ドラッグ時に `Shift` を
押しながらで端末ネイティブ選択。

## 同期 (ファイル + git)

- mdok はアトミックに保存 (一時ファイル + rename) するので iCloud / Dropbox /
  Syncthing が書きかけのファイルを上げることがない。ノートを同期フォルダに置くだけ。
- git リポジトリ内では (無効化: `mdok config --git off` または `^O c`):
  保存すると3秒後に自動コミット (`mdok: <ファイル>`)、`^O g` で push、pull
  (`--rebase --autostash`)、手動コミット、ステータスバーに `git:<ブランチ>⇡⇣` +
  競合警告。初回 push 時に upstream を自動設定。競合は表示のみで解決は git で。

## ロードマップ

- [x] TUI — サイドバー + ソース + ライブプレビュー、タブ、テーマ、セッション復元
- [x] `view` — 端末向けきれいな描画
- [x] `ask` — ストリーミング単一/複数ファイル Q&A (BYOK、OpenAI 互換)
- [x] 検索/置換、lint、整形、表整形、HTML 書出、git バッジ、監視
- [x] インライン AI リライト + diff、vim モード、シェル実行、最近使ったファイル
- [ ] `mdok ask` の他プロバイダ (Anthropic ネイティブ API)
- [ ] ローカル Ollama プリセット (`--url http://localhost:11434/v1`)
