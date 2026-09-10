# mdok — Markdown OK

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

> Design docs for peer review: [`docs/`](docs/) (architecture, editor, sync, LLM, roadmap).

Terminal TUI editor for `.md` files: sidebar explorer + source + live preview,
themes, tabs, find/replace, lint, shell runner, and BYOK LLM (ask + rewrite).

## Install

```sh
npm install -g @daystar7777/mdok
```

> `mdok: command not found`? Your shell doesn't see npm's global bin dir.
> The installer prints the exact fix (an `export PATH=…` line for your shell).
> Manual check: `npm prefix -g`, then make sure `<prefix>/bin` is on `PATH`.

No Node.js? Download a standalone binary (macOS arm64/x64, Linux x64,
Windows x64) from
[GitHub Releases](https://github.com/daystar7777/mdok-cli/releases) —
`mdok-linux-x64`, `mdok-macos-arm64`, … — and put it on your `PATH`.

From source (needs Node.js 22+):

```sh
npm install
npm run build
npm link  # or: node dist/index.js
```

## Usage

QR export: click `[QR]`, or press `Ctrl+O`, then `r` (or File → item 7) to display the
current buffer as QR frames. Use arrows to step, Space to auto-cycle, Esc to
close. The payload is compressed, **not encrypted**, and needs an MDOK1
receiver (receiver UI is not yet included). [Format and limits](docs/qr-transfer.md).

```sh
mdok README.md      # open only this file
mdok                # resume last session
mdok view README.md # non-interactive pretty-print (pipes, scripts)
mdok README.md | less

# ask LLM about the open files (BYOK, streaming)
export MDOK_API_KEY=sk-...
mdok ask README.md -q "이 문서 3줄 요약해줘"

# lint + export (also inside the TUI)
mdok lint README.md
mdok export README.md -o out.html

# config (all of these are also editable in-TUI via ^O c)
mdok config --url https://api.openai.com/v1 --model gpt-4o-mini
mdok config --key sk-... --theme ocean --git on --lang ko
```

Config lives at `~/.mdok.json` (`MDOK_API_KEY`, `MDOK_BASE_URL`, `MDOK_MODEL`,
`MDOK_LANG` envs win). Session (open tabs, cursors, unsaved buffers) at `~/.mdok-session.json`.

## Language & themes

- UI language: Korean / English. Toggle in settings (`^O c` → language),
  `mdok config --lang ko`, or `MDOK_LANG=ko`. Applies to the TUI and CLI messages.
- Themes: `forest · ocean · sunset · mono · rose`, cycle with `^O t`
  (remembered). Custom schemes via `~/.mdok-themes.json`:
  ```json
  { "themes": [{ "name": "mine", "focus": "cyan", "selBg": "blue",
    "selFg": "white", "findBg": "yellow", "findFg": "black",
    "findCurBg": "red", "findCurFg": "white", "accent": "cyan" }] }
  ```
- CJK text (한글/漢字/emoji) is measured by display width, so the cursor,
  selection, and mouse clicks stay aligned while editing.

## TUI keys

| Key | Action |
|---|---|
| `Ctrl+O`, `Tab` / `e` / `p` | cycle panes · jump to source / preview |
| `Ctrl+O`, `1`–`9` / `w` | switch tab / close tab |
| `Ctrl+O`, `v` | cycle Split / Source / View |
| `Ctrl+O`, `b` | toggle sidebar (Recent · Outline · Cwd files) |
| `Ctrl+O`, `f` | file menu (Save · New · Open… · Run… · Export HTML · Close tab) |
| `Ctrl+O`, `a` | ask LLM about open files, streams into preview (`Esc` cancels) |
| `Ctrl+O`, `R` | AI rewrite selection, diff accept/reject |
| `Ctrl+O`, `/` | find; `Tab` = replace field, `Enter` = search/replace, `n`/`N` next/prev |
| `Ctrl+O`, `!` | run shell command, output stays in-editor |
| `Ctrl+O`, `L` / `F` | lint problems / format buffer |
| `Ctrl+O`, `\|` | format pipe table at cursor |
| `Ctrl+O`, `t` / `l` | cycle theme (remembered) / line numbers |
| `Ctrl+O`, `V` | vim mode (hjkl/i/a/A/o/x/0/$/G, `Esc` = normal) |
| `Ctrl+O`, `m` or `F10` (Alt+M too) | focus menu bar |
| `←`/`→`, `Enter`, `Esc` (menu bar) | move · run · cancel |
| `Ctrl+O`, `g` | git sync panel (push / pull --rebase / commit / auto toggle) |
| `Ctrl+O`, `c` / `?` | settings / help |
| `Ctrl+O`, `s` or `Ctrl+S` | save file |
| `Ctrl+O`, `q` or `Ctrl+Q` | quit (twice if modified) |
| `Shift`+arrows | select text |
| `Tab` (in source) | insert 2 spaces |

Top bar buttons (`[>]` `[Split]` `[Ask]` `[Find]` `[File]` `[Shell]` `[Set]` `[?]` `[X]`,
plus tab bar with `[+]`) are clickable and mirror the keys above. Sidebar and
shell output start closed (`^O b`, `[Shell]` button).

(Note: `Ctrl+M` can't be used — terminals report it as Enter. Use `F10`/`^O m`.)

## Mouse

Click to place cursor / switch tab / press buttons, drag to select (typing
replaces the selection), wheel scrolls the pane under the pointer. Works on
SGR terminals (iTerm2, WezTerm, Ghostty, VSCode, …) and legacy X10 terminals
(macOS Terminal.app: clicks work, wheel does not — Apple limitation).

tmux: needs `set -g mouse on` in `~/.tmux.conf`. Fallback: hold `Shift` while
dragging for terminal-native selection.

## Sync (files + git)

- mdok writes atomically (temp file + rename), so iCloud / Dropbox / Syncthing
  never upload half-written files. Just keep your notes in a synced folder.
- Inside a git repo (opt-out: `mdok config --git off` or `^O c`):
  saving auto-commits after 3s (`mdok: <file>`), `^O g` pushes, pulls
  (`--rebase --autostash`), commits on demand, and shows
  `git:<branch>⇡⇣` plus conflict warnings in the status bar. First push sets
  the upstream automatically. Conflicts are surfaced, resolved in git.

## Roadmap

- [x] TUI — sidebar + source + live preview, tabs, themes, session restore
- [x] `view` — terminal pretty render
- [x] `ask` — streaming single/multi-file Q&A (BYOK, OpenAI-compatible)
- [x] find/replace, lint, format, table format, HTML export, git badges, watcher
- [x] inline AI rewrite with diff, vim mode, shell runner, recent files
- [ ] `mdok ask` alternate providers (Anthropic native API)
- [ ] local Ollama preset (`--url http://localhost:11434/v1`)
