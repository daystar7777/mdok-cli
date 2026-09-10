# Roadmap & decision log

> 현재 개발 순서 및 GUI·다국어·AI·문서별 공유 요구사항은 [제품 개발 기준](product-plan.md)을 우선한다. 첫 개발 목표는 비로그인 데스크톱 → 앱 → 웹 페이지까지이며 계정/E2EE 클라우드/초대/유료화는 후속 단계다.

> 2026-09-10 update: 웹 편집, 동기화, 실시간 협업과 E2EE 유지가 새 요구사항으로 확정되었습니다. 아래 deferred/non-goal 목록은 이전 결정 기록이며, 변경된 계획은 [웹 서비스 설계](web-service-design.md), 현재 코드의 출시 전 수정 사항은 [전체 검토](review-2026-09-10.md)를 참조하세요.

## Done (shipped, pty-verified unless noted)

- TUI: sidebar (Recent/Outline/scrollspy/Cwd + git badges), source + live
  preview (cursor follow), tabs + multi-pair panes, themes (+custom file),
  session restore incl. dirty buffers, ko/en UI + CLI, CJK-correct editing
- Editing: mouse (SGR/X10, click/drag/wheel), Shift+arrows selection, undo/redo,
  vim subset, find/replace, lint + jump, format, pipe-table format, line numbers
- Shell runner (bottom panel, history), HTML export, file watcher, recent files
- LLM: BYOK streaming ask (multi-tab context), inline rewrite with diff review
- Git sync: auto-commit, push/pull, status bar, conflict surfacing
- CLI: `view ask lint export config`, stdin/pipe fallback
- Distro: npm (`@daystar7777/mdok`), 4 OS binaries via Bun + release CI,
  4-language READMEs, MIT

## Deferred (explicit non-goals for now)

- **Cloud/E2EE sync**: decided — offline free forever; invite-only free beta
  (5 MB, `.md`/`.markdown`/`.txt` only) later; monetize after. Requires:
  E2EE module → server → link flow. Donations first (GitHub Sponsors).
- **Desktop shell**: Electron/Tauri + xterm embedding designed (see below),
  parked pending TUI stability. Tauri preferred (light).
- **Mobile**: reading-only first, only if sync exists to justify it.
- **Realtime collaboration** (CRDT), **DB/kanban**, **plugin runtime**
  (config-file extension first), **persistent undo**, **Anthropic-native API**,
  **Ollama preset**, **PDF/DOCX export**, **spellcheck**.

## Decision log (why, for reviewers)

1. **Tabs are always-visible pairs** (not hidden buffers): matches how the
   feature is actually used (compare side by side); session shape unchanged.
2. **Conflicts surfaced, never merged**: single maintainer can't own a merge
   engine; git is the backstop. Revisit if users hit it weekly.
3. **No plugin runtime yet**: marketplace = ops burden; command-style plugins
   (`~/.mdok/plugins/*` executables + manifest, palette-discovered) when asked.
4. **Ink over OpenTUI**: Node 22 floor (OpenTUI needs 26+); revisit if we
   outgrow Ink's input model.
5. **Bun for binaries, npm for library**: SEA died on Ink's top-level await;
   Bun compile handles mixed CJS/ESM. npm stays the dev path.
6. **Ctrl+M unusable**: terminals report it as Enter (`0x0D`) — documented,
   F10/`^O m` instead. Same class: Ctrl+digits unreliable as leader keys.

## Testing debt (flagged honestly)

- Pure modules have ad-hoc `node -e` asserts, not a runner. Next: vitest +
  `*.test.ts` colocated, run in CI.
- Interactive behavior is verified with scripted pty runs (manual recipe,
  not checked in). Next: `scripts/pty/` harness with expect-style asserts,
  run on Linux CI at least.
- No fuzzing on the mouse/key parser boundary; no perf budget for 10k-line
  files (rope is a future option; arrays are fine today).

## Desktop shell (parked design sketch)

- Host `mdok` CLI in xterm.js; Tauri v2 + `portable-pty` + Bun-binary sidecar.
  Zero TUI rewrite; SGR mouse and all key handling carry over.
- Needs: file association (`.md` double-click → file arg exists), menus,
  auto-update, icons. Native dialogs/QuickLook stay out of v1.
