import QRCode from "qrcode";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { qrFrames } from './qr-frames.js';

export interface QrTransfer { frames: string[]; version: number; name: string; bytes: number }

/** MDOK1:<sha256-prefix>:<index>:<count>:<gzip-json-base64 chunk>.
 * Snapshot only: never writes the source file or contacts a server.
 */
export function createQrTransfer(path: string, content: string, columns: number, rows: number): QrTransfer {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > 1024 * 1024) throw new Error("limit");
  const name = basename(path);
  const encoded = gzipSync(Buffer.from(JSON.stringify({ name, content }), "utf8"), { level: 9 }).toString("base64");
  const id = createHash("sha256").update(encoded).digest("hex").slice(0, 16);
  // Four-module quiet zone; two module rows per terminal row. Reserve UI rows.
  const version = Math.min(40, Math.floor((Math.min(columns, (rows - 4) * 2) - 25) / 4));
  if (version < 3) throw new Error("size");
  // Reserve only the actual index digit count, not 4096 on every small transfer.
  // Explicit byte mode yields a safe content-independent capacity bound.
  return { name, bytes, version, frames: qrFrames(encoded,id,version) };
}

/** Black modules on a white background, including a four-module quiet zone. */
export function qrTerminalRows(payload: string, version: number): string[] {
  const { modules } = QRCode.create(payload, { version, errorCorrectionLevel: "L" });
  const size = modules.size + 8;
  const dark = (x: number, y: number) => x >= 4 && y >= 4 && x < size - 4 && y < size - 4 && modules.get(y - 4, x - 4);
  return Array.from({ length: Math.ceil(size / 2) }, (_, row) =>
    Array.from({ length: size }, (_, x) => {
      const top = dark(x, row * 2), bottom = dark(x, row * 2 + 1);
      return top ? (bottom ? "█" : "▀") : (bottom ? "▄" : " ");
    }).join(""));
}
