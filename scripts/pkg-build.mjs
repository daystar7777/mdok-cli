#!/usr/bin/env node
// Build standalone mdok binaries with Bun (`bun build --compile`).
// Usage:
//   node scripts/pkg-build.mjs --target <bun-target> --out <path>
//   node scripts/pkg-build.mjs --all   # all four OS/arch combos into dist-pkg/
// Targets: bun-darwin-arm64, bun-darwin-x64, bun-linux-x64, bun-windows-x64
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALL = [
  ["bun-darwin-arm64", "mdok-macos-arm64"],
  ["bun-darwin-x64", "mdok-macos-x64"],
  ["bun-linux-x64", "mdok-linux-x64"],
  ["bun-windows-x64", "mdok-windows-x64.exe"],
];

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const jobs = process.argv.includes("--all")
  ? ALL.map(([target, name]) => ({ target, out: join(root, "dist-pkg", name) }))
  : [{ target: arg("--target") ?? "bun-darwin-arm64", out: arg("--out") ?? join(root, "dist-pkg", "mdok") }];

mkdirSync(join(root, "dist-pkg"), { recursive: true });
for (const { target, out } of jobs) {
  console.log(`building ${out} (${target})…`);
  execFileSync("bun", ["build", "--compile", "--target", target, "src/index.ts", "--outfile", out],
    { cwd: root, stdio: "inherit" });
}
console.log("done");
