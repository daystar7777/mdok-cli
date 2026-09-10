# Architecture

## 1. System map

```
┌─────────────┐   mdok <file> / bare / view / ask / lint / export / config
│  CLI (index) ├──────────────────────────────────────────────┐
└─────────────┘                                              │
┌─────────────┐   Ink TUI (alternate screen, raw stdin)      │
│  tui.tsx    │◄── mouse bus (raw stdin tap, SGR + X10)       │
└──────┬──────┘                                              │
       │ uses                                                │
       ▼                                                     ▼
┌──────────────────────────────────────────────────────────────────┐
│ pure modules: lint · width · i18n · theme · git · session ·      │
│ atomic · html · llm(client) · config                             │
└──────────────────────────────────────────────────────────────────┘
       │ files                                    │ network
       ▼                                          ▼
~/.mdok.json  ~/.mdok-session.json            OpenAI-compatible
~/.mdok-themes.json                            /chat/completions (BYOK)
edited .md files                               $SHELL (run), git, open(1)
```

- One process, one file tree. No daemon, no server (cloud deferred — see `roadmap.md`).
- `src/index.ts` owns CLI-only commands; the TUI is dynamically imported
  (`import("./tui.js")`) so `view`/`ask`/`lint` stay light.
- Desktop shell (Electron/Tauri + xterm, in `desktop/`) is a separate host:
  it spawns this CLI in a pty. The TUI must never assume anything beyond
  a VT-compatible terminal.

## 2. TUI loop (Ink + React state)

- All UI state lives in `TuiApp` (`useState`); the terminal is re-rendered by Ink.
- The **active buffer** is held in granular states (`lines`, `cursor`, …);
  inactive tabs live in `tabs[]` snapshots (`TabSnap`). `snapshotTab()` /
  `restoreTab()` move between them. Invariant: granular states always describe
  `tabs[active]`, except mid-keystroke (single-threaded, so safe).
- Long work (LLM streams, `exec`, `readdir`, git) is `async` + state updates.
  Nothing blocks the input loop. Stale async results are fenced with run-ids
  (`askRunId`, `termRunId`) and unmount cleanup.
- Debounces: preview re-render 150 ms, session save 1.5 s, git auto-commit 3 s.

## 3. Input pipeline (read this before touching keys/mouse)

Order inside `useInput`, first match wins:

1. **Suppression window** (`junkSuppressUntil`): drops keypresses for ~80 ms
   after any parsed mouse sequence.
2. **Lone Esc**: opens a 40 ms window, *unless* Esc is meaningful here
   (overlay close / leader cancel / menu exit). Rationale below.
3. **Mouse-shape guard**: drops inputs matching SGR (`[<…M`) / X10 (`[M…`)
   shapes and anything containing `ESC [` — these are mouse bytes that
   readline surfaced as keys.
4. **Coalesced control bytes**: readline can merge rapid control keys into one
   event with raw bytes and no flags (observed: `\x11\x11`, `^O`+`Tab`).
   Raw `\x0f` folds atomically into leader state (`lead`), `\x13`/`\x11`
   dispatch save/quit directly. Tab is detected via `key.tab` OR raw `\t`.
5. Overlay → menu-bar mode → output panel → leader (`Ctrl+O`) → direct
   shortcuts (`Ctrl+S/Q/Z/Y`) → focus-specific editing.

### Why the mouse bus exists

Ink parses stdin with node readline, which does not understand SGR/X10 mouse
sequences and surfaces them as typed characters (`[<64;20;10M` …). We tap raw
stdin in a module-level listener attached in `runTui()` **before** Ink sets up
its parser, so our listener runs first on every chunk. It:

- parses SGR (`ESC [ < Cb ; x ; y M/m`) and legacy X10 (`ESC [ M Cb Cx Cy`,
  latin1-decoded because coords ≥127 are not valid UTF-8);
- stamps the suppression window and routes complete events to the component;
- catches function keys Ink swallows whole (F10 arrives as empty input),
  and drops the listener on unmount (a lingering stdin listener keeps the
  event loop alive — this once caused a quit hang, see decision log).

Mouse buttons that readline never delivers (e.g. `Ctrl+M` == `0x0D` == Enter)
are documented as unsupported, not worked around.

### Coordinate mapping

- Alternate screen ⇒ layout rows map 1:1 to SGR coords (minus 1 for 0-based).
- Every pane has a 1-cell border; subtract it on both axes. The editor also
  has a gutter (line numbers) and a title row — both are subtracted before
  mapping x→column / y→row. Out-of-window clicks are ignored, never clamped
  into surprising positions (clamping caused a shipped off-by-one).
- Overlay menu clicks use geometry stored in a ref during render
  (`overlayGeomRef`); render and hit-test must use identical arithmetic.

## 4. Rendering model

- Panes are fixed boxes; content is sliced to viewports in render
  (`edVisible`, `pvVisible`). The editor walks **visual columns** (`width.ts`),
  never UTF-16 offsets, so CJK/emoji keep cursor, selection, and clicks aligned.
- Preview is `marked` + `marked-terminal` (ANSI). It re-renders debounced;
  while an ask streams, tokens append to `answer` state and the same pipeline
  shows progress. Editing clears `answer` (back to live preview).
- Preview follows the cursor proportionally (`followTop`, pure + tested)
  until the user scrolls it manually (wheel/keys/click), which latches
  `pvFollow=false` until the next cursor move.

## 5. Persistence files

| File | Content | Write pattern |
|---|---|---|
| `~/.mdok.json` | endpoint/key/model/theme/lang/flags/recent | atomic, on change |
| `~/.mdok-session.json` | open tabs + cursors + dirty contents (≤100 KB) | debounced 1.5 s + sync on quit |
| `~/.mdok-themes.json` | user color schemes (validated, builtins win ties) | manual edit only |
| edited `.md` | user data | atomic temp+rename, on save only |

Secrets: API keys live in config file or `MDOK_API_KEY`/`OPENAI_API_KEY` env.
No telemetry, no network except explicit LLM/shell/git actions.

## Open questions (reviewers)

1. The snapshot/restore tab model works but is subtle (stale-closure discipline
   everywhere). Is there a simpler formulation with the same UX?
2. Mouse+readline coexistence relies on timing windows (80/150/300 ms).
   Acceptable, or should we take over stdin parsing entirely?
3. `followTop` proportionality vs true source→rendered line mapping — worth it?
