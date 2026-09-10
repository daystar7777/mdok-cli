import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('built CLI version matches package and lockfile release version', async () => {
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.equal(lock.version,pkg.version);
  assert.equal(lock.packages[''].version,pkg.version);
  assert.equal(execFileSync(process.execPath,[fileURLToPath(new URL('../dist/index.js',import.meta.url)),'--version'],{encoding:'utf8'}).trim(),pkg.version);
});
