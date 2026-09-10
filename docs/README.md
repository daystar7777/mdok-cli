# mdok design docs — review guide

> 최신 제품 범위와 개발 순서: [제품 개발 기준](product-plan.md). GUI, 다국어, 번역/요약, 후속 문서별 열람 권한을 포함한다.

> 2026-09-10: 새 [전체 코드 검토](review-2026-09-10.md)와 [웹·E2EE 실시간 협업 설계](web-service-design.md)를 추가했습니다. 새 설계는 사용자가 확정한 웹 편집·동기화·실시간 협업·E2EE 유지 요구사항을 반영합니다. 아래 기존 문서의 클라우드/협업 제외 방침과 달라진 부분은 새 설계를 우선 참조하세요. 구현 완료를 뜻하지 않습니다.

> Audience: peer reviewers. Goal: find wrong trade-offs, missing edge cases,
> and simpler designs — not typos.

## How to review (30 min)

1. Read `architecture.md` (system map, 5 min).
2. Pick ONE area you know best and read its doc deeply:
   - terminal input nerd → `architecture.md` §3 (mouse bus) + `editor.md` §2
   - i18n/CJK → `editor.md` §3
   - crypto/sync → `sync-and-storage.md` §4–5
   - LLM UX → `llm.md`
3. Answer the **Open questions** at the bottom of that doc in your review.

## What we want from review

- Correctness holes in concurrent input handling (mouse bytes vs keypresses).
- Simpler alternatives to the snapshot/restore tab model.
- Security review of: API key storage, shell runner, URL opener, file watcher.
- i18n/CJK width edge cases we missed.

## What we do NOT want (yet)

- Style nits, README wording (4 languages are maintained by hand for now).
- Feature requests outside `roadmap.md` scope — file them as issues instead.

## Docs index

| Doc | Covers |
|---|---|
| `architecture.md` | processes, modules, TUI loop, input pipeline, rendering |
| `editor.md` | buffers/tabs/pairs, cursor & CJK, undo, vim, find, scrollspy |
| `sync-and-storage.md` | atomic writes, watcher, session, git sync, conflicts |
| `llm.md` | BYOK, streaming, ask/rewrite, prompts, abort |
| `roadmap.md` | done, deferred (cloud), decision log |

## Repo conventions (for context)

- TypeScript, Node 22+, Ink 7 (React TUI), `commander` CLI.
- Pure logic lives in dependency-free modules (`lint.ts`, `width.ts`, `i18n.ts`,
  `theme.ts`, `git.ts`, `session.ts`, `atomic.ts`) with ad-hoc `node -e` asserts;
  interactive behavior is verified with scripted pty runs (see `roadmap.md` § testing debt).
- Commit style: `mdok: <area> — <what>` (Korean ok). No force-push to `main`.
