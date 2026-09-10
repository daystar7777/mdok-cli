#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { writeFileAtomic } from "./atomic.js";
import { tr, normalizeLang, type MsgKey } from "./i18n.js";
import { join } from "node:path";
import chalk from "chalk";
import { renderMarkdown } from "./render.js";
import { buildPrompt, chatCompletion } from "./llm.js";
import { lintMarkdown } from "./lint.js";
import { markdownToHtml } from "./html.js";
import { loadSession } from "./session.js";
import {
  loadConfig,
  saveConfig,
  configPath,
  resolveApiKey,
  resolveBaseURL,
  resolveModel,
} from "./config.js";

function cliLang() {
  if (process.env.MDOK_LANG === "ko" || process.env.MDOK_LANG === "en") return process.env.MDOK_LANG;
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

program
  .name("mdok")
  .description("Markdown OK — pretty CLI viewer + LLM analysis (BYOK)")
  .version("0.1.3");

program
  .command("view")
  .argument("<file>", "markdown file to render")
  .description("Pretty-print a markdown file in the terminal")
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
  .argument("<file>", "markdown file to analyze")
  .requiredOption("-q, --question <q>", "question about the file")
  .option("-m, --model <model>", "override model")
  .description("Ask an LLM about a markdown file (BYOK)")
  .action(async (file: string, opts: { question: string; model?: string }) => {
    try {
      const cfg = await loadConfig();
      const apiKey = resolveApiKey(cfg);
      if (!apiKey) {
        console.error(
          chalk.red(
            `${ct("cli.noKey")}\nConfig file: ${configPath()}`,
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
  .description("Show or update mdok config (~/.mdok.json)")
  .option("--key <key>", "set API key")
  .option("--url <url>", "set OpenAI-compatible base URL")
  .option("--model <model>", "set default model")
  .option("--theme <theme>", "set TUI theme (forest|ocean|sunset|mono|rose)")
  .option("--lang <ko|en>", "UI language")
  .option("--git <on|off>", "git sync on/off")
  .action(async (opts: { key?: string; url?: string; model?: string; theme?: string; git?: string; lang?: string }) => {
    const patch: Record<string, string> = {};
    if (opts.key) patch.apiKey = opts.key;
    if (opts.url) patch.baseURL = opts.url;
    if (opts.model) patch.model = opts.model;
    if (opts.theme) patch.theme = opts.theme;
    if (opts.lang) patch.lang = opts.lang;
    const boolPatch: { gitSync?: boolean } = {};
    if (opts.git) boolPatch.gitSync = opts.git !== "off" && opts.git !== "false";
    const cfg =
      Object.keys(patch).length > 0 || opts.git
        ? await saveConfig({ ...patch, ...boolPatch })
        : await loadConfig();
    const shown = { ...cfg, apiKey: cfg.apiKey ? "***" + cfg.apiKey.slice(-4) : "" };
    console.log(chalk.green(ct("cli.config", { f: configPath() })));
    console.log(JSON.stringify(shown, null, 2));
  });

program
  .command("lint")
  .argument("<file>", "markdown file to lint")
  .description("Check a markdown file (whitespace, headings, fences)")
  .action(async (file: string) => {
    try {
      const md = await readFile(file, "utf-8");
      const problems = lintMarkdown(md.split("\n"));
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
  .argument("<file>", "markdown file to export")
  .option("-o, --out <out>", "output html path")
  .description("Export a markdown file to standalone HTML")
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

// Default: TUI. `mdok <file>` opens only the requested file;
// bare `mdok` resumes the session. Piped output pretty-prints one file.
program.argument("[file]", "markdown file to open in TUI").action(async (file?: string) => {
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
    path: string;
    content: string;
    baseline?: string;
    cursor?: { r: number; c: number };
  }
  const readOne = async (p: string): Promise<Tab | null> => {
    try {
      return { path: p, content: await readFile(p, "utf-8") };
    } catch (err) {
      if (p === file && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return { path: p, content: "" }; // new file
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
        tabs.push({ path: f.path, content: f.content, baseline: disk?.content ?? "", cursor: f.cursor });
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
