import { test } from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createQrTransfer, qrTerminalRows } from "./qr.js";

test("terminal block QR frames decode and reconstruct exact Unicode file bytes", () => {
  const content = "# 한글 문서 😀\n\n| a | b |\n" + Array.from({ length: 30 }, (_, i) => `${i}: résumé 日本語 ${i * 937}\r\n`).join("");
  const transfer = createQrTransfer("/notes/example.md", content, 80, 24);
  assert.ok(transfer.frames.length > 1);
  const chunks: string[] = [];
  for (const payload of transfer.frames) {
    const rows = qrTerminalRows(payload, transfer.version);
    assert.ok(rows.length + 4 <= 24);
    assert.ok(rows[0].length <= 80);
    const scale = 5, width = rows[0].length * scale, height = rows.length * 2 * scale;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const moduleY = Math.floor(y / scale);
      const ch = rows[Math.floor(moduleY / 2)][Math.floor(x / scale)];
      const black = ch === "█" || (moduleY % 2 === 0 ? ch === "▀" : ch === "▄");
      const offset = (y * width + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = black ? 0 : 255;
      pixels[offset + 3] = 255;
    }
    const decoded = jsQR(pixels, width, height);
    assert.equal(decoded?.data, payload);
    const [prefix, id, index, count, chunk] = decoded!.data.split(":");
    assert.equal(prefix, "MDOK1");
    assert.equal(Number(count), transfer.frames.length);
    assert.equal(id.length, 16);
    chunks[Number(index) - 1] = chunk;
  }
  const encoded = chunks.join("");
  assert.equal(createHash("sha256").update(encoded).digest("hex").slice(0, 16), transfer.frames[0].split(":")[1]);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8")), { name: "example.md", content });
});

test("single frame, screen and input limits", () => {
  assert.equal(createQrTransfer("empty.md", "", 120, 50).frames.length, 1);
  assert.throws(() => createQrTransfer("a.md", "hello", 36, 23), /size/);
  assert.throws(() => createQrTransfer("a.md", "hello", 80, 22), /size/);
  assert.throws(() => createQrTransfer("a.md", "x".repeat(1024 * 1024 + 1), 80, 24), /limit/);
});
