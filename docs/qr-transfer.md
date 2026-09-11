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
versions 3–40 with error correction L are selected according to screen size.
The header reserves only the digits needed for this transfer's frame count.
Increasing the terminal height before opening QR can substantially reduce the
number of frames. The MDOK1 wire format remains unchanged.

Space toggles automatic playback; mouse reports coalesced with a key do not
discard that key. Key-repeat/release events do not repeatedly toggle playback.
Color-disabled terminals use literal half-block glyphs instead of colored cells.
Real camera readability still depends on terminal font, line spacing and scale.
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
# General file transfer (MDOK2)

Run `mdok qr ./archive.zip` to send any regular file, up to 1 MiB, without text conversion. Use Left/Right to change frames, Space to play/pause, a frame number followed by Enter to jump, and Q/Esc to exit. Example: `mdok qr ./photo.png --frame 3` prints just frame 3 for a missing-part retry. `--version 8` selects lower QR density; `--interval 1500` changes autoplay timing in milliseconds.

The desktop **Receive QR / QR 받기** dialog accepts image files and clipboard screenshots. Parts may arrive out of order; duplicates are ignored and missing numbers are shown. **Save file / 파일 저장** restores the original bytes. Non-Markdown files are never automatically opened or executed.

MDOK2 uses `MDOK2:<sha256-prefix>:<index>:<count>:<chunk>`. Indices start at 1. Concatenated chunks are base64 of gzip JSON `{name,size,sha256,data}`, where `data` is base64 of the original bytes and `sha256` is their full SHA-256. The prefix is the first 16 hex characters of SHA-256 of the concatenated base64 string. Existing MDOK1 Markdown snapshots remain supported. Hashes detect corruption, not sender identity; QR data is not encrypted.
