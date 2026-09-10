# Sync & storage

Design stance: **plain files stay canonical**. Everything syncable must work
with dumb folder sync (iCloud/Dropbox/Syncthing) with zero mdok involvement.

## 1. Atomic writes (`atomic.ts`)

- All writes (buffers, config, session, export) go temp-file-in-same-dir +
  rename. Sync watchers never see half a file. Temp names are unique per
  pid+uuid; stale tmps only accumulate on crash, which is acceptable.
- Rationale: the #1 data-loss mode of editor×sync combos is torn writes,
  not merge conflicts.

## 2. External-change watcher

- `fs.watch` on the active file. On fire (500 ms dedup):
  - disk == buffer → own save, ignore;
  - buffer clean → auto-reload + message;
  - buffer dirty → warn only (`changed on disk — buffer has unsaved changes`),
    never auto-overwrite. No merge UI (see §4 for the conflict story).

## 3. Session (`session.ts`, `~/.mdok-session.json`)

- Open tabs + cursors + **dirty contents** (≤100 KB each, else dropped).
  Crash → resume with unsaved work intact.
- Saved debounced (1.5 s) and synchronously on quit. Shape-validated on load;
  missing files skipped, dirty content re-applied over disk baseline (→ dirty).

## 4. Git sync (opt-out, `gitSync`)

- Scope: single-user repo hygiene, not collaboration.
- Save → debounced (3 s) `git add -A` + `commit -qm "mdok: <file>"`.
  Commit identity is repo-local (`-c user.name/email`), never touches global config.
- `^O g` panel: push (falls back to `push -u origin HEAD` when no upstream),
  `pull --rebase --autostash`, manual commit, auto toggle. Status bar shows
  `branch ⇡⇣` + conflict flag; sidebar shows porcelain badges (`M`/`??`/`U`…).
- **Conflicts are surfaced, never auto-resolved**: unmerged paths (`git ls-files -u`)
  flag the status; file badges show `U`; pull failures print the git message
  verbatim with "resolve in git". No merge UI by design (for now).
- Non-repos: everything degrades to no-ops with a message. Timeouts: 5 s status,
  15 s commit, 60 s push/pull.

## 5. Cloud posture (deferred — decision record)

- Decided: offline-first free forever; cloud later as invite-only free beta
  (5 MB, text files `.md`/`.markdown`/`.txt` only), monetization after.
- When built: **E2EE mandatory** (scrypt→HKDF→AES-256-GCM recipe, keys never
  leave device), GitHub OAuth identity, per-user git remote reuse, invite codes,
  server-side quota/type enforcement. No E2EE half-measures, no custom crypto.
- Explicitly NOT promised: recovery of lost encryption passwords, collaboration,
  real-time sync (see `roadmap.md`).

## Open questions (reviewers)

1. `git add -A` on every save commits sibling files the user didn't touch —
   acceptable for a personal-notes tool, or should we scope to open files?
2. Dirty+external-change currently only warns. Is a Reload/Keep prompt (or
   3-way view) worth it, or is "warn + git has your back" enough?
3. Session stores dirty contents — any privacy concern with `/tmp`-style paths
   or giant pastes? (100 KB cap exists; enough?)
