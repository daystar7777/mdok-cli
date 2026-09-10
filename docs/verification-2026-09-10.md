# TUI / QR regression verification — 2026-09-10

## Automated verification

`npm run build`, `npm test` and `git diff --check` pass. The test suite now
contains 38 tests, with no failures or skipped tests.

Coverage includes actual isolated Git repositories, file-write failures and
concurrent writes, Unicode/large session persistence, invalid session values,
QR decoding and reassembly, QR capacity boundaries, mocked LLM streams,
Markdown formatting preservation, and narrow Unicode display widths.

New regression cases cover mouse+keyboard coalescing, key release/repeat,
QR frame-count digit boundaries, larger QR versions, synchronous/asynchronous
permission preservation, fenced/indented code, table insertion boundaries,
and zero-width slices. Session closure checks are not a replacement for full
interactive recovery testing.

## Interactive PTY verification

`scripts/verify-tui.mjs` redirects configuration/session storage to a temporary
directory and launches the real TUI without accessing user documents or Git.

- Ctrl+O then r opens QR.
- An SGR mouse report plus Space in one input chunk starts automatic playback.
- Observed pages 1/4 → 2/4 → 3/4 at the configured one-second interval.
- Space pauses; waiting produces no further frame updates.
- With TERM=dumb and NO_COLOR=1, QR uses distinct literal block glyphs rather
  than a uniform upper-half-block rectangle.

## Capacity comparison

For the same 1,060-byte sample document (`probe.md`):

| Terminal | Before | After |
| --- | ---: | ---: |
| 80×24 | 18 | 16 |
| 80×30 | 4 | 4 |
| 120×40 | 2 | 2 |
| 160×60 | 2 | 1 |

The protocol is still MDOK1 (gzip + Base64); compatibility is preserved.
Small terminals still impose a substantial capacity limit.

## Remaining verification limits

- Physical camera scanning and the user's specific terminal/font are not tested.
- QR receiver UI is not implemented; reassembly validation uses test code.
- Network LLM tests use mocks, not paid or external endpoints.
- No npm publication or Git push is part of this verification.
