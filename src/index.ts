#!/usr/bin/env node
import { Command } from "commander";
import { exportPandoc, PROFILES, FORMATS, type Profile, type ExportFormat } from './integrations.js';
import {checkMath,diagnosticText} from './math-engine.js';
import {applyConversion,type MathEngine,type DelimiterPolicy} from './math.js';
import {comparisonLines} from './compare.js';
import {gitSnapshots,decodeText,type GitCompareMode} from './git-snapshots.js';
import {linePosition,type MarkdownProfile} from './document-analysis.js';
import {compareAsync,convertAsync} from './analysis-jobs.js';
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { writeFileAtomic } from "./atomic.js";
import {documentPath,inspectDisk,guardedWrite,type DiskToken} from './file-safety.js';
import { tr, normalizeLang, type MsgKey } from "./i18n.js";
import { join,resolve } from "node:path";
import chalk from "chalk";
import { renderMarkdown } from "./render.js";
import { buildPrompt, chatCompletion } from "./llm.js";
import { lintMarkdown } from "./lint.js";
import { markdownToHtml } from "./html.js";
import { loadSession,recoverySessions } from "./session.js";
import {
  loadConfig,
  saveConfig,
  configPath,
  resolveApiKey,
  resolveBaseURL,
  resolveModel,
} from "./config.js";

function cliLang() {
  if (process.env.MDOK_LANG) return normalizeLang(process.env.MDOK_LANG);
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), ".mdok.json"), "utf-8")) as { lang?: unknown };
    return normalizeLang(raw?.lang);
  } catch {
    return "en" as const;
  }
}
const cl = cliLang();
const ct = (k: MsgKey, v?: Record<string, string | number>) => tr(cl, k, v);

const program = new Command();
program.command('recover [id]').description('List isolated unsaved-session backups, or recover one by ID')
  .action(async(id?:string)=>{
    try{
      const entries=await recoverySessions();
      if(!id){for(const entry of entries)console.log(`${entry.id}  ${entry.session.files.filter(f=>f.content!==undefined).length} unsaved document(s)`);if(!entries.length)console.log('No unsaved recovery sessions.');return;}
      if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Recovery requires an interactive terminal');
      const entry=entries.find(e=>e.id===id);if(!entry)throw Error('Recovery ID not found');
      const tabs=[];
      for(const f of entry.session.files){
        const path=await documentPath(f.path).catch(()=>resolve(f.path)),disk=await inspectDisk(path).catch(()=>null);
        if(f.content===undefined&&disk?.content==null)continue;
        tabs.push({path,content:f.content??disk?.content??'',baseline:disk?.content??'',diskToken:f.content!==undefined?f.diskToken??null:disk?.token??null,cursor:f.cursor});
      }
      if(!tabs.length)throw Error('No recoverable documents');
      await(await import('./tui.js')).runTui(tabs,entry.session.active);
    }catch(e){console.error(String(e));process.exitCode=1;}
  });
program.command('qr <file>')
 .description('Send any file as QR frames (up to 1 MiB) / 모든 형식의 파일 QR 전송')
 .option('--frame <number>','Print only this frame (1-based)')
 .option('--version <number>','QR version 3–40; default fits terminal')
 .option('--interval <ms>','Autoplay interval','1200')
 .action(async(file:string,options:{frame?:string;version?:string;interval:string})=>{try{await(await import('./qr-file.js')).runFileQr(file,options);}catch(e){console.error(String(e));process.exitCode=1;}});
program.command('desktop [file]')
  .description('Open a local Markdown file in mdok desktop / 데스크톱으로 열기')
  .option('--app <path>','Path to mdok.app')
  .action(async(file:string|undefined,opts:{app?:string})=>{
    try{const {openDesktop}=await import('./desktop-open.js');const r=await openDesktop(file,opts);console.log(`mdok: open requested${r.path?' — '+r.path:''}`);}
    catch(e){console.error(String(e));process.exitCode=1;}
  });
program.command('mcp')
  .description('Local desktop MCP server (stdio)')
  .requiredOption('--root <directory...>','Explicitly allowed Markdown directories')
  .option('--app <path>','Path to mdok.app')
  .action(async(opts:{root:string[];app?:string})=>{
    try{const {serveDesktop}=await import('./desktop-mcp.js');await serveDesktop(opts.root,opts.app);}
    catch(e){console.error(String(e));process.exitCode=1;}
  });
program.helpOption("-h, --help", ct("cli.helpHelp"));
program.addHelpCommand(false);
program.configureHelp({
  formatHelp: (command, helper) => {
    let text = Object.getPrototypeOf(helper).formatHelp.call(helper, command, helper) as string;
    if (cl === "ko") text = text.replace(/^Usage:/m, "사용법:").replace(/^Arguments:/m, "인자:").replace(/^Options:/m, "옵션:").replace(/^Commands:/m, "명령:");
    return text;
  },
});

program
  .name("mdok")
  .description(ct("cli.description"))
  .version("0.1.11", "-V, --version", ct("cli.versionHelp"));

program
  .command("view")
  .argument("<file>", ct("cli.fileArg"))
  .description(ct("cli.viewHelp"))
  .action(async (file: string) => {
    try {
      const md = await readFile(file, "utf-8");
      process.stdout.write(renderMarkdown(md) + "\n");
    } catch (err) {
      console.error(chalk.red(ct("cli.viewFailed", { e: (err as Error).message })));
      process.exitCode = 1;
    }
  });

program
  .command("ask")
  .argument("<file>", ct("cli.fileArg"))
  .requiredOption("-q, --question <q>", ct("cli.questionHelp"))
  .option("-m, --model <model>", ct("cli.modelHelp"))
  .description(ct("cli.askHelp"))
  .action(async (file: string, opts: { question: string; model?: string }) => {
    try {
      const cfg = await loadConfig();
      const apiKey = resolveApiKey(cfg);
      if (!apiKey) {
        console.error(
          chalk.red(
            `${ct("cli.noKey")}\n${ct("cli.config", { f: configPath() })}`,
          ),
        );
        process.exitCode = 1;
        return;
      }
      const md = await readFile(file, "utf-8");
      const answer = await chatCompletion(buildPrompt(md, opts.question), {
        baseURL: resolveBaseURL(cfg),
        apiKey,
        model: resolveModel(cfg, opts.model),
        system: "You analyze markdown files.",
      });
      process.stdout.write(renderMarkdown(answer) + "\n");
    } catch (err) {
      console.error(chalk.red(ct("cli.askFailed", { e: (err as Error).message })));
      process.exitCode = 1;
    }
  });

program
  .command("config")
  .description(ct("cli.configHelp"))
  .option("--key <key>", ct("cli.keyHelp"))
  .option("--url <url>", ct("cli.urlHelp"))
  .option("--model <model>", ct("cli.modelHelp"))
  .option("--theme <theme>", ct("cli.themeHelp"))
  .option("--lang <ko|en>", ct("cli.langHelp"))
  .option("--git <on|off>", ct("cli.gitHelp"))
  .option('--external-changes <ask|auto|keep>','External changes: ask, clean-only auto reload, or keep')
  .option('--auto-save <on|off>','Auto-save the original file after 2 seconds idle (default off)')
  .action(async (opts: { key?: string; url?: string; model?: string; theme?: string; git?: string; lang?: string; externalChanges?:string;autoSave?:string }) => {
    const patch: Record<string, string> = {};
    if (opts.key) patch.apiKey = opts.key;
    if (opts.url) patch.baseURL = opts.url;
    if (opts.model) patch.model = opts.model;
    if (opts.theme) patch.theme = opts.theme;
    if (opts.lang) {
      if (!/^(ko|en)(?:[-_.]|$)/i.test(opts.lang.trim())) {
        console.error(ct("cli.badLang", { lang: opts.lang })); process.exitCode = 1; return;
      }
      patch.lang = normalizeLang(opts.lang);
    }
    const boolPatch: { gitSync?: boolean;autoSave?:boolean;externalChanges?:'ask'|'auto'|'keep' } = {};
    if(opts.externalChanges){if(!['ask','auto','keep'].includes(opts.externalChanges)){console.error('Use --external-changes ask|auto|keep');process.exitCode=1;return;}boolPatch.externalChanges=opts.externalChanges as 'ask'|'auto'|'keep';}
    if(opts.autoSave){if(!['on','off'].includes(opts.autoSave)){console.error('Use --auto-save on|off');process.exitCode=1;return;}boolPatch.autoSave=opts.autoSave==='on';}
    if (opts.git) boolPatch.gitSync = opts.git !== "off" && opts.git !== "false";
    const cfg =
      Object.keys(patch).length > 0 || Object.keys(boolPatch).length>0
        ? await saveConfig({ ...patch, ...boolPatch })
        : await loadConfig();
    const shown = { ...cfg, apiKey: cfg.apiKey ? "***" + cfg.apiKey.slice(-4) : "" };
    console.log(chalk.green(ct("cli.config", { f: configPath() })));
    console.log(JSON.stringify(shown, null, 2));
  });

program
  .command("lint")
  .argument("<file>", ct("cli.fileArg"))
  .description(ct("cli.lintHelp"))
  .action(async (file: string) => {
    try {
      const md = await readFile(file, "utf-8");
      const problems = lintMarkdown(md.split("\n"), cl);
      for (const p of problems) {
        console.log(`${file}:${p.line + 1}:${p.col + 1}: ${p.rule} ${p.msg}`);
      }
      if (!problems.length) console.log(chalk.green(ct("cli.clean", { f: file })));
      else process.exitCode = 1;
    } catch (err) {
      console.error(chalk.red(ct("cli.lintFailed", { e: (err as Error).message })));
      process.exitCode = 1;
    }
  });

program
  .command("export")
  .argument("<file>", ct("cli.fileArg"))
  .option("-o, --out <out>", ct("cli.outHelp"))
  .description(ct("cli.exportHelp"))
  .action(async (file: string, opts: { out?: string }) => {
    try {
      const md = await readFile(file, "utf-8");
      const out = opts.out ?? file.replace(/\.(md|markdown)$/i, "") + ".html";
      await writeFileAtomic(out, markdownToHtml(md, file));
      console.log(chalk.green(ct("cli.wrote", { f: out })));
    } catch (err) {
      console.error(chalk.red(ct("cli.exportFailed", { e: (err as Error).message })));
      process.exitCode = 1;
    }
  });

program.command('math-check').argument('<file>',ct('cli.fileArg'))
  .option('--engine <engine>','basic | katex | mathjax','basic')
  .option('--profile <profile>','gfm | commonmark','gfm')
  .option('--delimiters <policy>','both | dollar | bracket | off','both')
  .option('--macros <file>','JSON string macro configuration')
  .option('--json','JSON diagnostics')
  .action(async(file:string,opts:{engine:MathEngine;profile:MarkdownProfile;delimiters:DelimiterPolicy;macros?:string;json?:boolean})=>{
    try {
      const text=decodeText(await readFile(file));
      const macros=opts.macros?JSON.parse(await readFile(opts.macros,'utf8')):undefined;
      const report=await checkMath(text,opts.engine,{profile:opts.profile,policy:opts.delimiters,macros});
      console.log(opts.json?JSON.stringify({schemaVersion:1,...report}):[report.engine,...report.diagnostics.map(d=>{const p=linePosition(text,d.start);return `${p.line+1}:${p.col+1} ${d.severity} ${diagnosticText(d,cl)}`;})].join('\n'));
      if(report.partial||report.diagnostics.some(d=>d.severity==='error'||d.severity==='warning'))process.exitCode=1;
    }catch(e){console.error((e as Error).message);process.exitCode=2;}
  });
program.command('math-convert').argument('<file>',ct('cli.fileArg'))
  .requiredOption('--to <delimiter>','dollar | bracket')
  .option('--write','Apply after revision check (default: dry-run)')
  .option('--profile <profile>','gfm | commonmark','gfm')
  .action(async(file:string,opts:{to:'dollar'|'bracket';write?:boolean;profile:MarkdownProfile})=>{
    try {
      const path=await documentPath(file),disk=await inspectDisk(path);
      if(disk.content===null)throw Error('File not found');
      const text=disk.content,plan=await convertAsync(text,opts.to,undefined,opts.profile);
      const preview=comparisonLines(await compareAsync(text,plan.result,opts.profile),true).join('\n');
      if(opts.write)await guardedWrite(path,applyConversion(text,plan),disk.token);
      console.log(preview);
      if(plan.skipped)console.error(`Skipped ambiguous/incomplete math: ${plan.skipped}`);
    }catch(e){console.error((e as Error).message);process.exitCode=2;}
  });
program.command('compare').argument('<file>').argument('[other]')
  .option('--git <mode>','staged | unstaged | head')
  .option('--ref <ref>','Base Git commit','HEAD').option('--to-ref <ref>','Other Git commit')
  .option('--profile <profile>','gfm | commonmark','gfm').option('--raw','Raw line diff').option('--json','Lossless comparison JSON')
  .action(async(file:string,other:string|undefined,opts:{git?:GitCompareMode;ref:string;toRef?:string;profile:MarkdownProfile;raw?:boolean;json?:boolean})=>{
    try {
      if(opts.git&&other)throw Error('Choose two files OR Git comparison');
      if(!opts.git&&!other)throw Error('Provide another file or --git');
      const pair=opts.git?await gitSnapshots(file,opts.git,opts.ref,opts.toRef):{old:decodeText(await readFile(file)),new:decodeText(await readFile(other!))};
      const report=await compareAsync(pair.old,pair.new,opts.profile);
      console.log(opts.json?JSON.stringify({schemaVersion:1,...report}):comparisonLines(report,opts.raw).join('\n'));
    }catch(e){console.error((e as Error).message);process.exitCode=2;}
  });

program.command('convert')
  .argument('<file>', ct('cli.fileArg'))
  .requiredOption('-o, --out <out>', ct('cli.outHelp'))
  .option('--profile <profile>', 'gfm | commonmark | pandoc', 'gfm')
  .option('--format <format>', 'docx | epub | latex | html | pdf', 'docx')
  .option('--trusted', ct('integration.trustHelp'))
  .description(ct('integration.pandoc'))
  .action(async (file: string, opts: {out: string; profile: string; format: string; trusted?: boolean}) => {
    try {
      if (!opts.trusted) throw new Error(ct('integration.needTrust'));
      if (!PROFILES.includes(opts.profile as Profile) || !FORMATS.includes(opts.format as ExportFormat)) throw new Error(ct('integration.badFormat'));
      const md = await readFile(file, 'utf8');
      await exportPandoc(md, file, opts.out, opts.profile as Profile, opts.format as ExportFormat);
      console.log(ct('cli.wrote', { f: opts.out }));
    } catch (e) { console.error(ct('cli.exportFailed', { e: (e as Error).message })); process.exitCode = 1; }
  });

// Default: TUI. `mdok <file>` opens only the requested file;
// bare `mdok` resumes the session. Piped output pretty-prints one file.
program.argument("[file]", ct("cli.fileArg")).action(async (file?: string) => {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (!file && !interactive) {
    program.help();
    return;
  }
  if (!interactive && file) {
    try {
      const md = await readFile(file, "utf-8");
      process.stdout.write(renderMarkdown(md) + "\n");
    } catch (err) {
      console.error(chalk.red(ct("cli.viewFailed", { e: (err as Error).message })));
      process.exitCode = 1;
    }
    return;
  }
  interface Tab {
    diskToken?: DiskToken;
    path: string;
    content: string;
    baseline?: string;
    cursor?: { r: number; c: number };
  }
  const readOne = async (p: string): Promise<Tab | null> => {
    try {
      const path=await documentPath(p),disk=await inspectDisk(path);
      if(disk.content===null&&p!==file)return null;
      return {path,content:disk.content??'',diskToken:disk.token};
    } catch (err) {
      if (p === file && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return { path: p, content: "",diskToken:'missing' }; // new file
      }
      return null;
    }
  };
  const sess = file ? null : await loadSession();
  const tabs: Tab[] = [];
  if (file) {
    const one = await readOne(file);
    if (one) tabs.push(one);
    else {
      process.exitCode = 1;
      return;
    }
  }
  if (sess) {
    for (const f of sess.files) {
      if (tabs.some((t) => t.path === f.path) || tabs.length >= 10) continue;
      if (f.content !== undefined) {
        const disk = await readOne(f.path);
        tabs.push({path:disk?.path??f.path,content:f.content,baseline:disk?.content??'',diskToken:f.diskToken??null,cursor:f.cursor});
        continue;
      }
      const one = await readOne(f.path);
      if (one) tabs.push({ ...one, cursor: f.cursor });
    }
  }
  if (!tabs.length) tabs.push({ path: join(process.cwd(), "untitled-1.md"), content: "" });
  const startActive = file ? 0 : Math.min(sess?.active ?? 0, tabs.length - 1);
  const { runTui } = await import("./tui.js");
  await runTui(tabs, startActive);
});

program.parseAsync(process.argv);
