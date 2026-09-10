#!/usr/bin/env node
// Post-install hint: if npm's global bin dir isn't on PATH, `mdok` won't be
// found. Runs on `npm install -g`; silent for local installs and when fine.
import { join, delimiter } from "node:path";

if (process.env.npm_config_global !== "true") process.exit(0);

const prefix =
  process.env.npm_config_prefix || join(process.execPath, "..", "..");
const binDir = join(prefix, "bin");
const onPath = (process.env.PATH || "").split(delimiter).includes(binDir);
if (onPath) process.exit(0);

const Y = "\x1b[33m";
const R = "\x1b[0m";
console.log(`
${Y}mdok installed, but '${binDir}' is not on your PATH.${R}
Add it so the \`mdok\` command works:

  zsh/macOS:  echo 'export PATH="${binDir}:$PATH"' >> ~/.zshrc && exec zsh
  bash/linux: echo 'export PATH="${binDir}:$PATH"' >> ~/.bashrc && exec bash

Then run: mdok --help
`);
