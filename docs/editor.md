# Editor

## 1. Buffer / tab / pair model

- A **tab** (`TabSnap`) is a file: `path`, `lines`, `baseline` (last saved),
  `cursor`, `sel`, scroll offsets, `answer`.
- **Pairs** are views, not data: every open tab is always visible side by side
  (tab bar switches *focus*, never hides). `openTab(path)` focuses the existing
  tab for that path, else appends (refuses below ~30 cols/pair with a message).
- The active tab's content lives in granular states; `writeBack()` semantics
  are inline in `switchTab`/`openTab`/`closeTabAt` (snapshot current → store).
- Same file in two pairs: allowed explicitly (renders alias the live buffer for
  the active path). Dirty tracking is per path content, so both views agree.
- `closeTabAt(i)`: dirty ⇒ arm/confirm (shared `quitArmed`), min 1 tab.
  `needSaved`-style blocking was removed — opening never destroys data.

## 2. Cursor, selection, CJK

- Cursor/selection are **UTF-16 offsets** (`{r, c}`); rendering and hit-testing
  convert to **visual columns** (`width.ts`: `charWidth`, `strWidth`,
  `sliceByWidth`, `colOfIndex`, `indexOfCol`). East-Asian wide/fullwidth = 2,
  combining/zero-width = 0, astral pairs counted once.
- Rules: never split surrogate pairs on moves (snap forward past trail
  surrogates); never slice a wide char for the window (include if it starts
  inside); gutter is ASCII-only.
- Selection: mouse drag (anchor/active) or Shift+arrows. Typing/backspace/
  delete/Return/Tab/paste collapse it first (`deleteRange`, tested).
  Plain navigation clears it. Vim normal mode has no visual mode (documented gap).

## 3. Undo / redo

- Per-tab-path in-memory stacks (cap 100), snapshots `{lines, cursor}` (copied).
- Typing bursts coalesce into one step (1.2 s window); structural ops are
  always separate steps. New edits clear redo.
- Keys: `Ctrl+Z` / `Ctrl+Y` in editor focus (vim normal included).
- Not persisted across restarts; not shared across tabs. Persistent undo
  (vim-`undofile` style) is an explicit non-goal until requested.

## 4. Find / replace

- Case-insensitive literal search (`findAll`, tested), `n`/`N` next/prev,
  current match highlighted distinctly, `Esc` clears.
- Replace-all via regex-escaped global replace with count message.
- Find overlay has two fields (Find/Replace, `Tab` switches).

## 5. Scrollspy outline

- Sidebar Outline section parses `#{1,6}` headings of the active buffer.
- Active section (last heading ≤ cursor row) renders bold + `●`; keyboard
  selection (`>`) wins ties visually.
- The sidebar minimally scrolls to reveal the active heading on cursor-row or
  content change (VSCode-outline semantics). Click/Enter jumps (cursor to line,
  focus to editor) and also selects the row for arrow continuity.

## 6. Vim mode (opt-in, persisted)

- Toggle `^O V`. Normal: `hjkl 0 $ G x i a A o O`, `Esc` back to normal from
  insert; insert is the regular editor. No `u` (use `Ctrl+Z`), no `:`/`/`/`v`
  (overlay equivalents exist). Deliberately a safe subset.

## 7. View modes & layout

- Global `split | source | preview` cycles (`^O v`); per-pair source panes
  carry a title row (`name ● … [X]`, X closes that pair).
- Sidebar (Recent/Outline/Cwd + git badges), tab bar (`[1 name●] … [+]`),
  bottom shell-output panel, status bar (word count, vim mode, git, hints).

## Open questions (reviewers)

1. UTF-16 offsets + visual conversion at the boundary: keep, or move the whole
   editor to code-point (or grapheme) offsets?
2. Selection model: is anchor/active + collapse-on-type sufficient, or do we
   need proper visual mode for vim credibility?
3. Pair layout: equal division is dumb but predictable — any better cheap rule?
