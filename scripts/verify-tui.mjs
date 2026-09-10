// Manual PTY probe: isolate settings, session writes and Git from user data.
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
const directory = await mkdtemp(join(os.tmpdir(), "mdok-tui-probe-"));
os.homedir = () => directory;
syncBuiltinESMExports();
process.chdir(directory);
try {
  const { runTui } = await import("../dist/tui.js");
  await runTui([{ path: join(directory, "probe.md"), content: Array.from({ length: 30 }, (_, i) => `${i}: 간단한 문서입니다 ${i * 1937}`).join("\n") }], 0);
} finally {
  await rm(directory, { recursive: true, force: true });
}
