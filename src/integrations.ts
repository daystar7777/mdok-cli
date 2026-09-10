import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, link, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';

export const PROFILES = ['gfm', 'commonmark', 'pandoc'] as const;
export type Profile = typeof PROFILES[number];
export const FORMATS = ['docx', 'epub', 'latex', 'html', 'pdf'] as const;
export type ExportFormat = typeof FORMATS[number];
export type Runner = (program: string, args: string[], input?: string, cwd?: string) => Promise<void>;
export const runTool: Runner = (program, args, input, cwd) => new Promise((done, reject) => {
  const child = execFile(program, args, { cwd, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true }, error => {
    if (error) reject(new Error(`${program}: ${error.message}`)); else done();
  });
  child.stdin?.on('error', () => {}); // early process exit is reported by execFile
  child.stdin?.end(input);
});

export function pandocArgs(profile: Profile, format: ExportFormat, output: string): string[] {
  if (!PROFILES.includes(profile) || !FORMATS.includes(format)) throw new Error('Unsupported profile/format');
  const reader = profile === 'pandoc' ? 'markdown-raw_tex-raw_html-yaml_metadata_block' : profile;
  return ['--from', reader, '--standalone', '--sandbox', '--output', output,
    ...(format === 'pdf' ? ['--pdf-engine=xelatex', '--pdf-engine-opt=-no-shell-escape'] : ['--to', format === 'html' ? 'html5' : format]),
    ...(format === 'html' ? ['--mathml'] : [])];
}

/** Explicit, local conversion. Never overwrite an existing destination. */
export async function exportPandoc(content: string, source: string, destination: string, profile: Profile, format: ExportFormat, runner: Runner = runTool): Promise<void> {
  const out = resolve(destination);
  if (out === resolve(source)) throw new Error('Output must differ from source');
  // Validate before creating files or launching processes.
  pandocArgs(profile, format, out);
  const temp = await mkdtemp(join(dirname(out), '.mdok-export-'));
  try {
    const result = join(temp, `result.${format === 'latex' ? 'tex' : format}`);
    await runner('pandoc', pandocArgs(profile, format, result), content, dirname(resolve(source)));
    // Restrict permissions, then atomically publish without replacing any file/symlink.
    const bytes = await readFile(result);
    const safe = join(temp, 'publish');
    await writeFile(safe, bytes, { mode: 0o600, flag: 'wx' });
    await link(safe, out);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export async function openVsCode(file: string, row = 0, column = 0, runner: Runner = runTool): Promise<void> {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0) throw new Error('Invalid cursor');
  await runner('code', ['--goto', `${resolve(file)}:${row + 1}:${column + 1}`]);
}
