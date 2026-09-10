# TUI QR export (MDOK1)

Click the header **[QR]** button, open **File → Show file as QR** (item 7), or press **Ctrl+O, r**.
The current buffer, including unsaved changes, is frozen for this transfer.
No file is saved, committed, uploaded, or encrypted by QR export.

- Left/right or p/n: previous/next frame, wrapping at the ends.
- Space: toggle automatic rotation at one second per frame; starts paused.
- Escape/q: close. Editing and cursor remain intact.
- Resize smaller: QR is hidden instead of cropped. Enlarge the terminal or
  close/reopen the transfer to choose a new frame size.
- Minimum size: 37 columns × 23 rows. Larger windows need fewer frames.

QR uses black Unicode half-block modules on white with a four-module quiet
zone. Use a monospaced terminal font with approximately 1:2 cell aspect ratio.
Screen capture quality and real cameras still require platform testing.

## Wire format v1

Each QR contains ASCII:

```
MDOK1:<id>:<index>:<count>:<chunk>
```

`index` is one-based. Join chunks in index order to recover standard Base64.
`id` is the first 16 hex characters of SHA-256 over that complete ASCII
Base64 string. Decode Base64, gunzip, then parse UTF-8 JSON `{name,content}`.
`name` is a basename, `content` is the exact current text buffer. This format
preserves the current buffer, not arbitrary original binary file encoding.
All documents, even single-frame ones, use the same envelope.

Source content is limited to 1 MiB UTF-8 and transfers to 4096 frames. QR
versions 3–10 with error correction L are selected according to screen size.
The hash detects accidental corruption, not malicious sender impersonation.
Anyone who captures the QR frames can read the document.

This is an application-specific multipart format, not QR structured append
or UR. A generic scanner can read each payload but will not reconstruct the
file. A receiver UI/camera/capture importer is a later implementation step.
A future receiver must bound decompression, validate metadata and frame
consistency, deduplicate frames, reject differing duplicates, and confirm
destination paths before writing. Never execute received content.

Verification: `node --import tsx --test src/qr.test.ts` rasterizes the actual
terminal blocks, decodes every frame using jsQR, and reconstructs Unicode
content including emoji and CRLF. This does not replace a real camera test.
