#!/usr/bin/env node
// Copy renderer assets + xterm vendor files into dist/ (tsc only emits JS).
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

mkdirSync(join(dist, "renderer"), { recursive: true });
cpSync(join(root, "src", "renderer", "index.html"), join(dist, "renderer", "index.html"));
cpSync(join(root, "src", "renderer", "renderer.js"), join(dist, "renderer", "renderer.js"));

const vendor = join(dist, "vendor", "@xterm");
rmSync(vendor, { recursive: true, force: true });
for (const pkg of ["xterm", "addon-fit"]) {
  mkdirSync(join(vendor, pkg), { recursive: true });
  cpSync(join(root, "node_modules", "@xterm", pkg), join(vendor, pkg), { recursive: true });
}
console.log("assets copied");
