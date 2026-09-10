import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "./atomic.js";
import { existsSync } from "node:fs";

export interface RecentEntry {
  path: string;
  at: number;
}

export interface MdokConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  theme: string;
  lang: string;
  recent: RecentEntry[];
  lineNums: boolean;
  vimMode: boolean;
  gitSync: boolean;
}

const CONFIG_PATH = join(homedir(), ".mdok.json");

const DEFAULTS: MdokConfig = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  theme: "forest",
  lang: "en",
  recent: [],
  lineNums: false,
  vimMode: false,
  gitSync: true,
};

export async function loadConfig(): Promise<MdokConfig> {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const merged = { ...DEFAULTS, ...JSON.parse(raw) };
    if (!Array.isArray(merged.recent)) merged.recent = [];
    if (typeof merged.theme !== "string" || !merged.theme) merged.theme = DEFAULTS.theme;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveConfig(patch: Partial<MdokConfig>): Promise<MdokConfig> {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  await writeFileAtomic(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function configPath(): string {
  return CONFIG_PATH;
}

export function resolveApiKey(cfg: MdokConfig): string {
  return process.env.MDOK_API_KEY || process.env.OPENAI_API_KEY || cfg.apiKey || "";
}

export function resolveBaseURL(cfg: MdokConfig): string {
  return process.env.MDOK_BASE_URL || cfg.baseURL;
}

export function resolveModel(cfg: MdokConfig, override?: string): string {
  return override || process.env.MDOK_MODEL || cfg.model;
}
