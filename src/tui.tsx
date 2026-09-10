import React, { useEffect, useMemo, useRef, useState } from "react";
import chalk from "chalk";
import { qrInputAction } from "./qr-input.js";
import { Box, Text, useApp, useInput, useWindowSize, type Key } from "ink";
import { readFile, readdir } from "node:fs/promises";
import { writeFileAtomic } from "./atomic.js";
import { watch, appendFileSync } from "node:fs";
import { relative } from "node:path";
import { lintMarkdown, formatMd, formatTable, diffLines, type LintProblem } from "./lint.js";
import { BUILTIN_THEMES, loadThemes, themeByName, type TuiTheme } from "./theme.js";
import { tr, normalizeLang, type Lang, type MsgKey } from "./i18n.js";
import { charWidth, strWidth, sliceByWidth, colOfIndex, indexOfCol, graphemes } from "./width.js";
import { markdownToHtml } from "./html.js";
import { gitStatus, gitRoot, gitSyncState, gitCommitAll, gitCommitFile, gitPullRebase, gitPush, type GitSyncState } from "./git.js";
import { exec } from "node:child_process";
import { saveSession, saveSessionSync, type Session } from "./session.js";
import { join } from "node:path";
import { renderMarkdown } from "./render.js";
import { createQrTransfer, qrTerminalRows, type QrTransfer } from "./qr.js";
import { buildPrompt, chatCompletionStream } from "./llm.js";
import {
  loadConfig,
  saveConfig,
  resolveApiKey,
  resolveBaseURL,
  resolveModel,
} from "./config.js";

type Focus = "editor" | "preview" | "side";
type ViewMode = "split" | "source" | "preview";
type OverlayKind = "file" | "open" | "ask" | "find" | "run" | "lint" | "diff" | "sync" | "settings" | "help" | "qr";

interface BtnSpan {
  id: string;
  x0: number;
  x1: number; // exclusive
}

interface EdView {
  cursor: Cursor | null;
  sel: Sel | null;
  edTop: number;
  edLeft: number;
  focusEd: boolean;
  showFind: boolean;
  title: { name: string; dirty: boolean } | null;
}

interface MiniEdit {
  value: string;
  cur: number;
}

interface SettingsDraft {
  baseURL: string;
  model: string;
  apiKey: string; // raw; masked on display
}

interface Cursor {
  r: number;
  c: number;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Truncate to a display width with ellipsis (CJK-aware). */
export function truncToWidth(s: string, maxW: number): string {
  if (strWidth(s) <= maxW) return s;
  let out = "";
  let w = 0;
  for (const ch of graphemes(s)) {
    const cw = charWidth(ch);
    if (w + cw > Math.max(0, maxW - 1)) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** Preview scroll offset that tracks the cursor proportionally (pure, tested). */
export function followTop(cursorR: number, totalLines: number, maxTop: number): number {
  const total = Math.max(1, totalLines - 1);
  const frac = Math.min(1, Math.max(0, cursorR / total));
  return clamp(Math.round(frac * maxTop), 0, maxTop);
}

interface Sel {
  anchor: Cursor;
  active: Cursor;
}

interface TabSnap {
  path: string;
  lines: string[];
  baseline: string;
  cursor: Cursor;
  sel: Sel | null;
  edTop: number;
  edLeft: number;
  pvTop: number;
  answer: string | null;
}

export interface InitialTab {
  baseline?: string;
  path: string;
  content: string;
  cursor?: Cursor;
}

function cmpPos(a: Cursor, b: Cursor): number {
  return a.r === b.r ? a.c - b.c : a.r - b.r;
}

export function orderedSel(s: Sel): { start: Cursor; end: Cursor } {
  return cmpPos(s.anchor, s.active) <= 0
    ? { start: s.anchor, end: s.active }
    : { start: s.active, end: s.anchor };
}

export function deleteRange(ls: string[], s: Sel): { ls: string[]; cur: Cursor } {
  const { start, end } = orderedSel(s);
  const merged = (ls[start.r] ?? "").slice(0, start.c) + (ls[end.r] ?? "").slice(end.c);
  const next = [...ls];
  next.splice(start.r, end.r - start.r + 1, merged);
  return { ls: next, cur: { r: start.r, c: start.c } };
}

export interface FindMatch {
  r: number;
  c: number;
  len: number;
}

export { BUILTIN_THEMES as THEMES } from "./theme.js";

// Case-insensitive search over buffer lines (pure — shared by memo + jump)
export function findAll(ls: string[], pattern: string): FindMatch[] {
  if (!pattern) return [];
  const pat = pattern.toLowerCase();
  const out: FindMatch[] = [];
  ls.forEach((ln, r) => {
    const low = ln.toLowerCase();
    let i = 0;
    for (;;) {
      const k = low.indexOf(pat, i);
      if (k < 0) break;
      out.push({ r, c: k, len: pattern.length });
      i = k + Math.max(1, pattern.length);
    }
  });
  return out;
}

// ---- Mouse bus (module scope) ----
// Ink parses stdin with node's readline, which doesn't understand SGR mouse
// sequences and surfaces them as typed characters (`[<65;10;5M` …). To stop
// wheel/click bytes from landing in the buffer we sniff raw stdin BEFORE Ink
// attaches its own parser, stamp a suppression window, and route mouse events
// to the component. As backup, a lone Escape also opens a short suppression
// window since every SGR sequence starts with one (covers split chunks).
type MouseHandler = (cb: number, x: number, y: number, pressed: boolean) => void;
type RawKeyHandler = (seq: string) => void;
let mouseHandler: MouseHandler | null = null;
let rawKeyHandler: RawKeyHandler | null = null;
let junkSuppressUntil = 0;
let mouseOnData: ((chunk: Buffer) => void) | null = null;
// SGR extended format + legacy X10 format (macOS Terminal.app and friends
// only speak X10: ESC [ M Cb Cx Cy with each byte +32).
const mouseSgrRe = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
const mouseX10Re = /\x1b\[M([\x20-\xff])([\x20-\xff])([\x20-\xff])/g;
// Function keys Ink swallows (empty input, no flags) — catch them raw.
const F10_SEQ = "\x1b[21~";

function ensureMouseListener() {
  if (mouseOnData) return;
  let buf = "";
  const mouseLog =
    process.env.MDOK_MOUSELOG === "1"
      ? (line: string) => {
          try {
            appendFileSync("/tmp/mdmouse.log", `${new Date().toISOString()} ${line}\n`);
          } catch {
            // debug only
          }
        }
      : null;
  mouseOnData = (chunk: Buffer) => {
    if (mouseLog) mouseLog(`chunk:${chunk.toString("hex")}`);
    // latin1: one char per byte — X10 coords above 127 are not valid UTF-8
    buf += chunk.toString("latin1");
    if (buf.includes(F10_SEQ)) {
      junkSuppressUntil = Date.now() + 80;
      try {
        rawKeyHandler?.("f10");
      } catch {
        // never let raw keys crash the TUI
      }
      buf = buf.split(F10_SEQ).join("");
    }
    let last = 0;
    const emit = (cb: number, x: number, y: number, pressed: boolean, kind: string) => {
      junkSuppressUntil = Date.now() + 80;
      if (mouseLog) mouseLog(`${kind}:cb=${cb} x=${x} y=${y} pressed=${pressed}`);
      try {
        mouseHandler?.(cb, x, y, pressed);
      } catch (err) {
        if (mouseLog) mouseLog(`handler-throw:${(err as Error).message}`);
      }
    };
    let m: RegExpExecArray | null;
    mouseSgrRe.lastIndex = 0;
    while ((m = mouseSgrRe.exec(buf))) {
      emit(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), m[4] === "M", "sgr");
      last = Math.max(last, m.index + m[0].length);
    }
    mouseX10Re.lastIndex = 0;
    while ((m = mouseX10Re.exec(buf))) {
      const cb = m[1].charCodeAt(0) - 32;
      emit(cb, m[2].charCodeAt(0) - 32, m[3].charCodeAt(0) - 32, (cb & 3) !== 3, "x10");
      last = Math.max(last, m.index + m[0].length);
    }
    buf = buf.slice(last);
    if (buf.length > 1024) buf = "";
  };
  process.stdin.on("data", mouseOnData);
}

// Must run on unmount: a lingering stdin listener keeps the event loop
// alive and the process would never exit after quit.
function detachMouseListener() {
  if (mouseOnData) {
    process.stdin.off("data", mouseOnData);
    mouseOnData = null;
  }
  mouseHandler = null;
  rawKeyHandler = null;
}

const StaticPreview = React.memo(function StaticPreview({
  text,
  w,
  top,
  count,
}: {
  text: string;
  w: number;
  top: number;
  count: number;
}) {
  const rendered = React.useMemo(() => renderMarkdown(text).split("\n"), [text]);
  const vis = rendered.slice(top, top + count);
  return (
    <Box flexDirection="column" width={w} borderStyle="single">
      {vis.map((ln, i) => (
        <Text key={i} wrap="truncate">
          {ln || " "}
        </Text>
      ))}
    </Box>
  );
});

function TuiApp({ initialTabs, startActive }: { initialTabs: InitialTab[]; startActive: number }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();

  const safeTabs = initialTabs.length ? initialTabs : [{ path: "untitled-1.md", content: "" }];
  const startIdx = Math.min(Math.max(0, startActive), safeTabs.length - 1);
  const firstTab = safeTabs[startIdx];
  const [tabs, setTabs] = useState<TabSnap[]>(() =>
    safeTabs.map((t) => {
      const cls = t.content.split("\n");
      const cr = Math.min(Math.max(0, t.cursor?.r ?? 0), Math.max(0, cls.length - 1));
      return {
        path: t.path,
        lines: cls,
        baseline: t.baseline ?? t.content,
        cursor: { r: cr, c: Math.min(Math.max(0, t.cursor?.c ?? 0), (cls[cr] ?? "").length) },
        sel: null,
        edTop: 0,
        edLeft: 0,
        pvTop: 0,
        answer: null,
      };
    }),
  );
  const [active, setActive] = useState(startIdx);
  const [lines, setLines] = useState<string[]>(() => firstTab.content.split("\n"));
  const [baseline, setBaseline] = useState(firstTab.baseline ?? firstTab.content);
  const [cursor, setCursor] = useState<Cursor>(tabs[startIdx].cursor);
  const [sel, setSel] = useState<Sel | null>(null);
  const [edTop, setEdTop] = useState(0);
  const [edLeft, setEdLeft] = useState(0);
  const [pvTop, setPvTop] = useState(0);
  const [focus, setFocus] = useState<Focus>("editor");
  const [msg, setMsg] = useState("");
  const [quitArmed, setQuitArmed] = useState(false);
  const [leader, setLeader] = useState(false);
  const [previewSrc, setPreviewSrc] = useState(firstTab.content);
  const [curFile, setCurFile] = useState(firstTab.path);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [overlay, setOverlay] = useState<OverlayKind | null>(null);
  const [qr, setQr] = useState<QrTransfer | null>(null);
  const [qrPage, setQrPage] = useState(0);
  const [qrPlaying, setQrPlaying] = useState(false);
  useEffect(() => {
    if (overlay !== "qr" || !qrPlaying || !qr) return;
    const timer = setInterval(() => setQrPage(i => (i + 1) % qr.frames.length), 1000);
    return () => clearInterval(timer);
  }, [overlay, qrPlaying, qr]);
  const qrRows = useMemo(() => qr ? qrTerminalRows(qr.frames[qrPage], qr.version) : [], [qr, qrPage]);
  const [menuIdx, setMenuIdx] = useState(0);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [askEdit, setAskEdit] = useState<MiniEdit>({ value: "", cur: 0 });
  const [findEdit, setFindEdit] = useState<MiniEdit>({ value: "", cur: 0 });
  const [repEdit, setRepEdit] = useState<MiniEdit>({ value: "", cur: 0 });
  const [repIdx, setRepIdx] = useState(0);
  const [find, setFind] = useState<{ pattern: string; idx: number } | null>(null);
  const [problems, setProblems] = useState<LintProblem[]>([]);
  const [diff, setDiff] = useState<{ start: Cursor; end: Cursor; original: string[]; revised: string[] } | null>(null);
  const [gitMap, setGitMap] = useState<Map<string, string>>(new Map());
  const [gitRootPath, setGitRootPath] = useState<string | null>(null);
  const [gitSt, setGitSt] = useState<GitSyncState | null>(null);
  const [gitSyncOn, setGitSyncOn] = useState(false);
  const gitCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bottom shell runner (non-interactive commands, output stays in-editor)
  const [runEdit, setRunEdit] = useState<MiniEdit>({ value: "", cur: 0 });
  const [cmdHist, setCmdHist] = useState<string[]>([]);
  const [cmdHistIdx, setCmdHistIdx] = useState(-1);
  const [term, setTerm] = useState<{ cmd: string; out: string; code: number | null; running: boolean } | null>(null);
  const [termTop, setTermTop] = useState(0);
  const termRunId = useRef(0);
  interface UndoSnap {
    lines: string[];
    cursor: Cursor;
  }
  const undoStacks = useRef(new Map<string, { u: UndoSnap[]; r: UndoSnap[] }>());
  const lastPush = useRef<{ at: number; kind: string } | null>(null);
  const stackFor = (path: string) => {
    let st = undoStacks.current.get(path);
    if (!st) {
      st = { u: [], r: [] };
      undoStacks.current.set(path, st);
    }
    return st;
  };
  const pushUndo = (prev: UndoSnap, kind: string) => {
    const now = Date.now();
    const last = lastPush.current;
    // coalesce rapid typing into one undo step
    if (kind === "type" && last && last.kind === "type" && now - last.at < 1200) return;
    lastPush.current = { at: now, kind };
    const st = stackFor(curFile);
    st.u.push({ lines: [...prev.lines], cursor: { ...prev.cursor } });
    if (st.u.length > 100) st.u.shift();
    st.r.length = 0;
  };
  const doUndo = () => {
    const st = stackFor(curFile);
    const e = st.u.pop();
    if (!e) {
      setMsg(t("msg.noUndo"));
      return;
    }
    st.r.push({ lines: [...lines], cursor: { ...cursor } });
    lastPush.current = null;
    setLines([...e.lines]);
    setCursor({ ...e.cursor });
    setSel(null);
  };
  const doRedo = () => {
    const st = stackFor(curFile);
    const e = st.r.pop();
    if (!e) {
      setMsg(t("msg.noRedo"));
      return;
    }
    st.u.push({ lines: [...lines], cursor: { ...cursor } });
    lastPush.current = null;
    setLines([...e.lines]);
    setCursor({ ...e.cursor });
    setSel(null);
  };
  const termChild = useRef<ReturnType<typeof exec> | null>(null);
  const askRunId = useRef(0);
  const askCtl = useRef<AbortController | null>(null);
  // Sidebar explorer (default closed; [Side] button or ^O b toggles)
  const [sideOpen, setSideOpen] = useState<boolean>(false);
  const [sideFiles, setSideFiles] = useState<string[]>([]);
  const [sideSel, setSideSel] = useState(0);
  const [sideTop, setSideTop] = useState(0);
  const [recent, setRecent] = useState<Array<{ path: string; at: number }>>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft>({ baseURL: "", model: "", apiKey: "" });
  const [themeName, setThemeName] = useState<string>(BUILTIN_THEMES[0].name);
  const [allThemes, setAllThemes] = useState<TuiTheme[]>(BUILTIN_THEMES);
  const [lang, setLang] = useState<Lang>("en");
  const t = (k: MsgKey, vars?: Record<string, string | number>) => tr(lang, k, vars);
  const [showNums, setShowNums] = useState(false);
  const [vimOn, setVimOn] = useState(false);
  const [vimInsert, setVimInsert] = useState(true);
  const [setIdx, setSetIdx] = useState(0);
  const [setEditing, setSetEditing] = useState<MiniEdit | null>(null);
  const [menuSel, setMenuSel] = useState<string | null>(null);
  const uiOpenedAt = useRef(0);
  const menuIdsRef = useRef<string[]>(["view"]);
  const [untitledN, setUntitledN] = useState(1);

  const dirty = useMemo(() => lines.join("\n") !== baseline, [lines, baseline]);
  const stats = useMemo(() => {
    const text = lines.join("\n");
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { words, lines: lines.length };
  }, [lines]);

  // Debounced live preview
  useEffect(() => {
    const t = setTimeout(() => setPreviewSrc(lines.join("\n")), 150);
    return () => clearTimeout(t);
  }, [lines]);

  // Auto-clear status message
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 2500);
    return () => clearTimeout(t);
  }, [msg]);

  const cols = columns ?? 80;
  const rowsSafe = rows ?? 24;
  const tabsVisible = tabs.length > 1;
  const sideW = Math.min(34, Math.max(22, Math.floor(cols * 0.24)));
  const mainW = cols - (sideOpen ? sideW : 0);
  const ox = sideOpen ? sideW : 0;
  const pairW = Math.max(1, Math.floor(mainW / Math.max(1, tabs.length)));
  const pairSrcW = viewMode === "split" ? Math.max(24, Math.floor(pairW / 2)) : pairW;
  // Bottom output panel reserves rows when a command ran
  const outH = term ? Math.min(12, Math.max(6, rowsSafe - 12)) : 0;
  const outInnerH = Math.max(1, outH - 2);
  const termLines = useMemo(() => (term ? term.out.split("\n") : []), [term]);
  const maxTermTop = Math.max(0, termLines.length - outInnerH);
  const innerH = Math.max(5, rowsSafe - 5 - outH - (tabsVisible ? 1 : 0));
  const gutterW = showNums ? String(lines.length).length + 1 : 0;
  const innerW = Math.max(10, pairSrcW - 2 - gutterW);
  const edInnerH = Math.max(1, innerH - 1);

  const pvLines = useMemo(
    () =>
      renderMarkdown(
        answer ? `${t("ask.streamNote")}\n\n${answer}` : previewSrc,
      ).split("\n"),
    [answer, previewSrc],
  );
  const maxPvTop = Math.max(0, pvLines.length - innerH);

  // Sidebar entries: recent files first, then cwd markdown files
  const baseOf = (p: string) => p.split("/").pop() || p;
  const parentOf = (p: string) => {
    const parts = p.split("/");
    return parts.length > 1 ? `${parts[parts.length - 2]}/` : "";
  };
  const recentShown = recent.slice(0, 8);
  interface SideItem {
    kind: "heading" | "file";
    label: string;
    path?: string;
    line?: number;
    git?: string;
  }
  const sideItems = useMemo<SideItem[]>(() => {
    const counts = new Map<string, number>();
    for (const r of recentShown) counts.set(baseOf(r.path), (counts.get(baseOf(r.path)) ?? 0) + 1);
    for (const n of sideFiles) counts.set(n, (counts.get(n) ?? 0) + 1);
    const headings: SideItem[] = [];
    lines.forEach((ln, r) => {
      const h = ln.match(/^(#{1,6})\s+(\S.*)?$/);
      if (h) {
        const text = (h[2] ?? "").slice(0, 40) || "(empty)";
        headings.push({ kind: "heading", label: `${"  ".repeat(h[1].length - 1)}${text}`, line: r });
      }
    });
    return [
      ...headings,
      ...recentShown.map((r) => ({
        kind: "file" as const,
        label: (counts.get(baseOf(r.path)) ?? 0) > 1 ? parentOf(r.path) + baseOf(r.path) : baseOf(r.path),
        path: r.path,
        git: gitMap.get(relative(process.cwd(), r.path)),
      })),
      ...sideFiles.map((n) => ({
        kind: "file" as const,
        label: n,
        path: `${process.cwd()}/${n}`,
        git: gitMap.get(n),
      })),
    ];
  }, [lines, recent, sideFiles, gitMap]);
  const sideHeadN = sideItems.filter((it) => it.kind === "heading").length;
  const sideRecentN = recentShown.length;
  interface SideRow {
    kind: "title" | "sec" | "item";
    label?: string;
    itemIdx?: number;
  }
  const sideRows: SideRow[] = useMemo(() => {
    const rows: SideRow[] = [{ kind: "title", label: "Files" }];
    const pushSec = (label: string, items: SideItem[], base: number) => {
      if (!items.length) return;
      rows.push({ kind: "sec", label });
      items.forEach((_, k) => rows.push({ kind: "item", itemIdx: base + k }));
    };
    pushSec(t("side.outline"), sideItems.slice(0, sideHeadN), 0);
    pushSec(t("side.recent"), sideItems.slice(sideHeadN, sideHeadN + sideRecentN), sideHeadN);
    pushSec(t("side.cwd"), sideItems.slice(sideHeadN + sideRecentN), sideHeadN + sideRecentN);
    return rows;
  }, [sideItems, sideHeadN, sideRecentN]);
  const sideItemsRef = useRef<SideItem[]>([]);
  sideItemsRef.current = sideItems;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const sideRowsRef = useRef<SideRow[]>([]);
  sideRowsRef.current = sideRows;
  const rowOfItem = (idx: number): number => sideRows.findIndex((r) => r.kind === "item" && r.itemIdx === idx);
  const activeHeadIdx = useMemo(() => {
    let ai = -1;
    for (let i = 0; i < sideHeadN; i++) {
      const ln = sideItems[i]?.line;
      if (ln === undefined || ln > cursor.r) break;
      ai = i;
    }
    return ai;
  }, [sideItems, sideHeadN, cursor.r]);
  const activateSideItem = (idx: number) => {
    const it = sideItems[idx];
    if (!it) return;
    if (it.kind === "heading" && it.line !== undefined) {
      setCursor({ r: Math.min(it.line, Math.max(0, lines.length - 1)), c: 0 });
      setSel(null);
      setSideSel(idx);
      setFocus("editor");
    } else if (it.kind === "file" && it.path) {
      void switchToFile(it.path);
    }
  };

  // ---- File / overlay actions (keyboard and mouse share these) ----
  const saveNow = () => {
    const content = lines.join("\n");
    const target = curFile;
    writeFileAtomic(target, content)
      .then(() => {
        setBaseline(content);
        setMsg(t("msg.saved", { f: target }));
        setQuitArmed(false);
        void refreshSideFiles();
        scheduleGitCommit(target, gitRootPath, gitSyncOn);
        void refreshGit();
      })
      .catch((err: Error) => setMsg(t("msg.saveFailed", { e: err.message })));
  };
  const anyDirty = (): boolean =>
    lines.join("\n") !== baseline ||
    tabs.some((t, i) => i !== active && t.lines.join("\n") !== t.baseline);
  const buildSession = () => ({
    files: tabs.map((t, i) =>
      i === active
        ? {
            path: curFile,
            cursor,
            ...(lines.join("\n") !== baseline
              ? { content: lines.join("\n") }
              : {}),
          }
        : {
            path: t.path,
            cursor: t.cursor,
            ...(t.lines.join("\n") !== t.baseline
              ? { content: t.lines.join("\n") }
              : {}),
          },
    ),
    active,
  });
  const quitNow = () => {
    if (anyDirty() && !quitArmed) {
      setQuitArmed(true);
      setMsg(t("msg.quitConfirm"));
      return;
    }
    saveSessionSync(buildSession());
    exit();
  };
  const snapshotTab = (): TabSnap => ({
    path: curFile,
    lines,
    baseline,
    cursor,
    sel,
    edTop,
    edLeft,
    pvTop,
    answer,
  });
  const restoreTab = (t: TabSnap) => {
    setCurFile(t.path);
    setLines(t.lines);
    setBaseline(t.baseline);
    setCursor(t.cursor);
    setSel(t.sel);
    setEdTop(t.edTop);
    setEdLeft(t.edLeft);
    setPvTop(t.pvTop);
    setAnswer(t.answer);
    setFind((f) => (f ? { ...f, idx: 0 } : f));
  };
  const pushRecent = (path: string) => {
    const nextRecent = [{ path, at: Date.now() }, ...recent.filter((r) => r.path !== path)].slice(0, 20);
    setRecent(nextRecent);
    void saveConfig({ recent: nextRecent }).catch(() => {});
  };
  const pruneRecent = (path: string) => {
    const pruned = recent.filter((r) => r.path !== path);
    if (pruned.length !== recent.length) {
      setRecent(pruned);
      void saveConfig({ recent: pruned }).catch(() => {});
    }
  };
  const openTab = (path: string, content: string, note?: string) => {
    const at = tabs.findIndex((t) => t.path === path);
    if (at >= 0) {
      switchTab(at);
      return;
    }
    if (Math.floor(mainW / (tabs.length + 1)) < 30) {
      setMsg(t("msg.tooNarrow"));
      return;
    }
    const snap = snapshotTab();
    const fresh: TabSnap = {
      path,
      lines: content.split("\n"),
      baseline: content,
      cursor: { r: 0, c: 0 },
      sel: null,
      edTop: 0,
      edLeft: 0,
      pvTop: 0,
      answer: null,
    };
    setTabs((ts) => [...ts.map((t, i) => (i === active ? snap : t)), fresh]);
    setActive(tabs.length);
    restoreTab(fresh);
    setOverlay(null);
    setMsg(note ?? t("msg.opened", { f: path }));
    pushRecent(path);
  };
  const switchTab = (i: number) => {
    if (i === active || i < 0 || i >= tabs.length) return;
    const snap = snapshotTab();
    setTabs((ts) => ts.map((t, xi) => (xi === active ? snap : t)));
    setActive(i);
    restoreTab(tabs[i]);
    setOverlay(null);
  };
  const closeTabAt = (i: number) => {
    if (tabs.length <= 1) {
      setMsg(t("msg.lastTab"));
      return;
    }
    const target = tabs[i];
    if (!target) return;
    const isDirty =
      i === active ? lines.join("\n") !== baseline : target.lines.join("\n") !== target.baseline;
    if (isDirty && !quitArmed) {
      setQuitArmed(true);
      setMsg(t("msg.closeConfirm"));
      return;
    }
    setQuitArmed(false);
    const snap = snapshotTab();
    const next = tabs.map((x, xi) => (xi === active ? snap : x)).filter((_, xi) => xi !== i);
    const ni = i < active ? active - 1 : Math.min(active, next.length - 1);
    setTabs(next);
    setActive(ni);
    restoreTab(next[ni]);
    setOverlay(null);
  };
  const closeTab = () => closeTabAt(active);
  const switchToFile = async (path: string) => {
    try {
      openTab(path, await readFile(path, "utf-8"));
    } catch (err) {
      setMsg(t("msg.openFailed", { e: (err as Error).message }));
      pruneRecent(path);
    }
  };
  const newFile = () => {
    const p = join(process.cwd(), `untitled-${untitledN}.md`);
    setUntitledN((n) => n + 1);
    openTab(p, "", t("msg.newFile", { f: p }));
  };
  const openOverlayKind = async (kind: OverlayKind) => {
    if (kind === "qr") {
      try {
        setQr(createQrTransfer(curFile, lines.join("\n"), columns, rows));
        setQrPage(0);
        setQrPlaying(false);
      } catch (err) {
        setMsg(t((err as Error).message === "size" ? "qr.size" : "qr.limit"));
        return;
      }
    }
    setMenuIdx(0);
    if (kind === "open") {
      try {
        const entries = await readdir(process.cwd(), { withFileTypes: true });
        setOpenFiles(
          entries
            .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name))
            .map((e) => e.name)
            .sort()
            .slice(0, 30),
        );
      } catch {
        setOpenFiles([]);
      }
    }
    if (kind === "settings") {
      const cfg = await loadConfig();
      setDraft({ baseURL: cfg.baseURL, model: cfg.model, apiKey: cfg.apiKey });
      setSetIdx(0);
      setSetEditing(null);
    }
    uiOpenedAt.current = Date.now();
    if (kind === "ask") setAskEdit({ value: "", cur: 0 });
    if (kind === "lint") {
      setProblems(lintMarkdown(lines));
      setMenuIdx(0);
      setOverlay("lint");
      if (!lintMarkdown(lines).length) setMsg(t("msg.lintClean"));
    }
    if (kind === "run") {
      const last = cmdHist[cmdHist.length - 1] ?? "";
      setRunEdit({ value: last, cur: last.length });
      setCmdHistIdx(-1);
    }
    if (kind === "find") {
      const v = find?.pattern ?? "";
      setFindEdit({ value: v, cur: v.length });
    }
    setOverlay(kind);
  };
  const submitAsk = async () => {
    const q = askEdit.value.trim();
    setOverlay(null);
    if (!q) return;
    const cfg = await loadConfig();
    const apiKey = resolveApiKey(cfg);
    if (!apiKey) {
      setMsg(t("msg.noKey"));
      return;
    }
    const others = tabs
      .filter((_, i) => i !== active)
      .slice(0, 4)
      .map((t) => `--- ${t.path} ---\n${t.lines.join("\n").slice(0, 2000)}`)
      .join("\n");
    const prompt =
      buildPrompt(lines.join("\n"), q) +
      (others ? `\n\nOther open files for context:\n${others}` : "");
    const id = ++askRunId.current;
    const ctl = new AbortController();
    askCtl.current = ctl;
    setAsking(true);
    setAnswer("");
    setMsg(t("msg.asking"));
    try {
      const full = await chatCompletionStream(
        prompt,
        {
          baseURL: resolveBaseURL(cfg),
          apiKey,
          model: resolveModel(cfg),
          system: "You analyze markdown files.",
          signal: ctl.signal,
        },
        (d) => {
          if (askRunId.current !== id) return;
          setAnswer((prev) => (prev ?? "") + d);
        },
      );
      if (askRunId.current !== id) return;
      setAnswer(full);
      setMsg("");
      setAsking(false);
      askCtl.current = null;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        if (askRunId.current === id) {
          setMsg(t("msg.askCancelled"));
          setAsking(false);
          askCtl.current = null;
        }
        return;
      }
      if (askRunId.current !== id) return;
      setMsg(t("msg.askFailed", { e: (err as Error).message }));
      setAsking(false);
      askCtl.current = null;
    }
  };
  const cancelAsk = () => {
    askRunId.current += 1;
    try {
      askCtl.current?.abort();
    } catch {
      // already settled
    }
    askCtl.current = null;
    setAsking(false);
  };
  const startRewrite = async () => {
    if (!sel || cmpPos(sel.anchor, sel.active) === 0) {
      setMsg(t("msg.selectFirst"));
      return;
    }
    const cfg = await loadConfig();
    const apiKey = resolveApiKey(cfg);
    if (!apiKey) {
      setMsg(t("msg.noKey"));
      return;
    }
    const { start, end } = orderedSel(sel);
    const excerpt = lines.slice(start.r, end.r + 1);
    const id = ++askRunId.current;
    const ctl = new AbortController();
    askCtl.current = ctl;
    setAsking(true);
    setMsg(t("msg.rewriting"));
    try {
      const full = await chatCompletionStream(
        `Rewrite the markdown excerpt below. Return ONLY the rewritten markdown, no fences, no commentary.\n\n${excerpt.join("\n")}`,
        {
          baseURL: resolveBaseURL(cfg),
          apiKey,
          model: resolveModel(cfg),
          system: "You rewrite markdown excerpts.",
          signal: ctl.signal,
        },
        () => {},
      );
      if (askRunId.current !== id) return;
      setAsking(false);
      askCtl.current = null;
      setDiff({ start, end, original: excerpt, revised: full.split("\n") });
      uiOpenedAt.current = Date.now();
      setOverlay("diff");
      setMsg("");
    } catch (err) {
      if (askRunId.current !== id) return;
      setAsking(false);
      askCtl.current = null;
      setMsg(
        (err as Error).name === "AbortError" ? t("msg.cancelled") : t("msg.rewriteFailed", { e: (err as Error).message }),
      );
    }
  };
  const acceptDiff = () => {
    if (!diff) {
      setOverlay(null);
      return;
    }
    const next = [...lines];
    next.splice(diff.start.r, diff.end.r - diff.start.r + 1, ...diff.revised);
    setLines(next);
    setCursor({ ...diff.start });
    setSel(null);
    setDiff(null);
    setOverlay(null);
    setMsg(t("msg.rewriteApplied"));
  };
  const rejectDiff = () => {
    setDiff(null);
    setOverlay(null);
    setMsg(t("msg.rewriteRejected"));
  };

  const theme = themeByName(allThemes, themeName);

  // Restore last theme + recent files (persisted in ~/.mdok.json)
  useEffect(() => {
    void loadConfig().then((cfg) => {
      setLang(normalizeLang(cfg.lang));
      void loadThemes().then((list) => {
        setAllThemes(list);
        if (list.some((x) => x.name === cfg.theme)) setThemeName(cfg.theme);
      });
      setShowNums(!!cfg.lineNums);
      setVimOn(!!cfg.vimMode);
      setVimInsert(true);
      const gsync = cfg.gitSync !== false;
      setGitSyncOn(gsync);
      void refreshGit(gsync);
      if (Array.isArray(cfg.recent)) {
        setRecent(
          cfg.recent
            .filter((r) => r && typeof (r as { path?: unknown }).path === "string")
            .slice(0, 20) as Array<{ path: string; at: number }>,
        );
      }
    });
    void refreshSideFiles();
  }, []);

  const toggleSide = () => {
    if (!sideOpen) void refreshSideFiles();
    setSideOpen((o) => !o);
    setFocus((f) => (f === "side" && sideOpen ? "editor" : f));
    setQuitArmed(false);
  };
  const toggleShell = () => {
    if (term) closeTerm();
    else void openOverlayKind("run");
  };
  const refreshGit = async (on: boolean = gitSyncOn) => {
    if (!on) {
      setGitRootPath(null);
      setGitSt(null);
      return;
    }
    const root = await gitRoot(process.cwd());
    setGitRootPath(root);
    setGitSt(root ? await gitSyncState(root) : null);
  };
  const scheduleGitCommit = (path: string, root: string | null, on: boolean) => {
    if (!on || !root) return;
    if (gitCommitTimer.current) clearTimeout(gitCommitTimer.current);
    gitCommitTimer.current = setTimeout(() => {
      const base = path.split("/").pop() || path;
      void gitCommitFile(root, path, `mdok: ${base}`)
        .then(() => {
          setMsg(t("msg.autoCommitted", { f: base }));
          void refreshGit();
        })
        .catch((err: Error) => setMsg(t("msg.autoCommitFailed", { e: err.message })));
    }, 3000);
  };
  const syncPush = async () => {
    if (!gitRootPath) {
      setMsg(t("msg.notRepo"));
      return;
    }
    setMsg(t("msg.pushing"));
    try {
      await gitPush(gitRootPath);
      setMsg(t("msg.pushed"));
    } catch (err) {
      setMsg(t("msg.pushFailed", { e: (err as Error).message }));
    }
    void refreshGit();
  };
  const syncPull = async () => {
    if (!gitRootPath) {
      setMsg(t("msg.notRepo"));
      return;
    }
    setMsg(t("msg.pulled"));
    try {
      await gitPullRebase(gitRootPath);
      setMsg(t("msg.pulled"));
    } catch (err) {
      setMsg(t("msg.pullFailed", { e: (err as Error).message }));
    }
    void refreshGit();
  };
  const syncCommitNow = async () => {
    if (!gitRootPath) {
      setMsg(t("msg.notRepo"));
      return;
    }
    try {
      await gitCommitAll(gitRootPath, `mdok: manual ${new Date().toISOString().slice(11, 16)}`);
      setMsg(t("msg.committed"));
    } catch (err) {
      setMsg(t("msg.commitFailed", { e: (err as Error).message }));
    }
    void refreshGit();
  };
  const refreshSideFiles = async () => {
    void gitStatus(process.cwd()).then(setGitMap).catch(() => {});
    try {
      const entries = await readdir(process.cwd(), { withFileTypes: true });
      setSideFiles(
        entries
          .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name))
          .map((e) => e.name)
          .sort(),
      );
    } catch {
      setSideFiles([]);
    }
  };

  const toggleLineNums = () => {
    const next = !showNums;
    setShowNums(next);
    setMsg(t("msg.lines", { s: t(next ? "msg.on" : "msg.off") }));
    void saveConfig({ lineNums: next }).catch(() => {});
  };
  const toggleVim = () => {
    const next = !vimOn;
    setVimOn(next);
    setVimInsert(false);
    setMsg(next ? t("msg.vimOn") : t("msg.vimOff"));
    void saveConfig({ vimMode: next }).catch(() => {});
  };
  const cycleLang = () => {
    const next: Lang = lang === "ko" ? "en" : "ko";
    setLang(next);
    void saveConfig({ lang: next }).catch(() => {});
  };
  const cycleTheme = () => {
    const idx = allThemes.findIndex((t) => t.name === themeName);
    const next = allThemes[(idx + 1) % allThemes.length].name;
    setThemeName(next);
    setMsg(t("msg.theme", { t: next }));
    void saveConfig({ theme: next }).catch((err: Error) =>
      setMsg(t("msg.themeKept", { e: err.message })),
    );
  };
  const cycleView = () => {
    const order: ViewMode[] = ["split", "source", "preview"];
    const next = order[(order.indexOf(viewMode) + 1) % order.length];
    setViewMode(next);
    if (next === "source") setFocus("editor");
    else if (next === "preview") setFocus("preview");
  };
  const cycleFocus = () => {
    const order: Focus[] = sideOpen ? ["editor", "preview", "side"] : ["editor", "preview"];
    setFocus((f) => order[(order.indexOf(f) + 1) % order.length]);
  };
  const jumpToMatch = (matches: FindMatch[], idx: number) => {
    const m = matches[idx];
    if (m) setCursor({ r: m.r, c: m.c });
  };
  const stepFind = (dir: 1 | -1) => {
    if (!find) return;
    const matches = findAll(lines, find.pattern);
    if (!matches.length) {
      setMsg(t("msg.noMatch", { p: find.pattern }));
      return;
    }
    const idx = (find.idx + dir + matches.length) % matches.length;
    setFind({ pattern: find.pattern, idx });
    jumpToMatch(matches, idx);
  };
  const runLint = () => {
    const found = lintMarkdown(lines);
    setProblems(found);
    setMenuIdx(0);
    setOverlay("lint");
    if (!found.length) setMsg(t("msg.lintClean"));
  };
  const jumpToProblem = (i: number) => {
    const pr = problems[i];
    if (!pr) return;
    setOverlay(null);
    const r = Math.min(pr.line, Math.max(0, lines.length - 1));
    setCursor({ r, c: Math.min(pr.col, (lines[r] ?? "").length) });
    setSel(null);
    setFocus("editor");
  };
  const applyFormat = () => {
    const { lines: next, fixes } = formatMd(lines);
    if (!fixes) {
      setMsg(t("msg.formatClean"));
      return;
    }
    setLines(next);
    setCursor((c) => ({
      r: Math.min(c.r, Math.max(0, next.length - 1)),
      c: Math.min(c.c, (next[Math.min(c.r, Math.max(0, next.length - 1))] ?? "").length),
    }));
    setMsg(t("msg.formatted", { n: fixes, es: lang === "ko" ? "" : fixes === 1 ? "" : "es" }));
  };
  const applyTableFormat = () => {
    const { lines: next, changed } = formatTable(lines, cursor.r);
    if (!changed) {
      setMsg(t("msg.noTable"));
      return;
    }
    setLines(next);
    setMsg(t("msg.tableOk"));
  };
  const exportHtml = async () => {
    const out = curFile.replace(/\.(md|markdown)$/i, "") + ".html";
    try {
      await writeFileAtomic(out, markdownToHtml(lines.join("\n"), curFile));
      setOverlay(null);
      setMsg(t("msg.wrote", { f: out }));
      void refreshSideFiles();
    } catch (err) {
      setMsg(t("msg.exportFailed", { e: (err as Error).message }));
    }
  };
  const replaceAll = () => {
    const pattern = findEdit.value;
    setOverlay(null);
    if (!pattern) return;
    const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let count = 0;
    const re = new RegExp(esc, "gi");
    const next = lines.map((ln) =>
      ln.replace(re, () => {
        count += 1;
        return repEdit.value;
      }),
    );
    if (!count) {
      setMsg(t("msg.noMatch", { p: pattern }));
      return;
    }
    setLines(next);
    setMsg(t("msg.replaced", { n: count }));
  };
  const submitFind = () => {
    const pattern = findEdit.value;
    setOverlay(null);
    if (!pattern) {
      setFind(null);
      return;
    }
    const matches = findAll(lines, pattern);
    if (!matches.length) {
      setFind(null);
      setMsg(t("msg.noMatch", { p: pattern }));
      return;
    }
    setFind({ pattern, idx: 0 });
    setFocus("editor");
    jumpToMatch(matches, 0);
  };
  const findMatches = useMemo(
    () => (find ? findAll(lines, find.pattern) : []),
    [lines, find],
  );
  // Top-button actions (keyboard menu mode and mouse clicks share these)
  const fireButton = (id: string) => {
    setMenuSel(null);
    const a = actionsRef.current;
    if (id === "menu") {
      toggleSide();
      return;
    }
    else if (id === "view") a.cycleView();
    else if (id === "ask") void a.openOverlayKind("ask");
    else if (id === "find") void a.openOverlayKind("find");
    else if (id === "file") void a.openOverlayKind("file");
    else if (id === "qr") void a.openOverlayKind("qr");
    else if (id === "shell") toggleShell();
    else if (id === "set") void a.openOverlayKind("settings");
    else if (id === "help") {
      uiOpenedAt.current = Date.now();
      setOverlay((o) => (o === "help" ? null : "help"));
    }
    else if (id === "quit") a.quitNow();
  };
  // Menu bar mode: focus the top buttons, arrows move, Enter runs
  const enterMenu = () => {
    if (overlay) return;
    setLeader(false);
    setQuitArmed(false);
    uiOpenedAt.current = Date.now();
    setMenuSel(menuIdsRef.current[0] ?? "view");
  };
  const runCmd = (cmd: string): Promise<{ out: string; code: number }> =>
    new Promise((resolve) => {
      const child = exec(
        cmd,
        { cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const ecode = (error as { code?: unknown } | null)?.code;
          const code = error ? (typeof ecode === "number" ? ecode : 1) : 0;
          const body = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`.slice(-20000);
          resolve({ out: body.trimEnd() || "(no output)", code });
        },
      );
      termChild.current = child;
    });
  const closeTerm = () => {
    termRunId.current += 1;
    try {
      termChild.current?.kill();
    } catch {
      // already exited
    }
    termChild.current = null;
    setTerm(null);
  };
  const submitRun = async () => {
    const cmd = runEdit.value.trim();
    setOverlay(null);
    if (!cmd) return;
    setCmdHist((h) => [...h.filter((c) => c !== cmd), cmd].slice(-50));
    setCmdHistIdx(-1);
    const id = ++termRunId.current;
    setTerm({ cmd, out: "", code: null, running: true });
    setTermTop(0);
    try {
      const res = await runCmd(cmd);
      if (termRunId.current !== id) return;
      termChild.current = null;
      setTerm({ cmd, out: res.out, code: res.code, running: false });
    } catch (err) {
      if (termRunId.current !== id) return;
      termChild.current = null;
      setTerm({ cmd, out: `error: ${(err as Error).message}`, code: 1, running: false });
    }
  };
  const activateMenuIndex = (idx: number) => {
    if (overlay === "file") {
      if (idx === 0) saveNow();
      else if (idx === 1) newFile();
      else if (idx === 2) void openOverlayKind("open");
      else if (idx === 3) void openOverlayKind("run");
      else if (idx === 4) void exportHtml();
      else if (idx === 5) closeTab();
      else if (idx === 6) void openOverlayKind("qr");
    } else if (overlay === "open") {
      const name = openFiles[idx];
      if (name) void switchToFile(join(process.cwd(), name));
    }
  };

  // Single-line field editor shared by ask + settings overlays
  const editMini = (
    setter: (v: MiniEdit) => void,
    cur: MiniEdit,
    ch: string,
    k: Key,
    onEnter: () => void,
  ) => {
    if (k.leftArrow) setter({ ...cur, cur: clamp(cur.cur - 1, 0, cur.value.length) });
    else if (k.rightArrow) setter({ ...cur, cur: clamp(cur.cur + 1, 0, cur.value.length) });
    else if (k.home || (k.ctrl && ch === "a")) setter({ ...cur, cur: 0 });
    else if (k.end || (k.ctrl && ch === "e")) setter({ ...cur, cur: cur.value.length });
    else if (k.backspace && cur.cur > 0) {
      setter({
        value: cur.value.slice(0, cur.cur - 1) + cur.value.slice(cur.cur),
        cur: cur.cur - 1,
      });
    } else if (k.delete && cur.cur < cur.value.length) {
      setter({
        value: cur.value.slice(0, cur.cur) + cur.value.slice(cur.cur + 1),
        cur: cur.cur,
      });
    } else if (k.return) onEnter();
    else if (ch && !k.ctrl && !k.meta && !k.escape && !k.tab) {
      const clean = ch.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
      if (clean) {
        setter({
          value: cur.value.slice(0, cur.cur) + clean + cur.value.slice(cur.cur),
          cur: cur.cur + clean.length,
        });
      }
    }
  };

  const setFieldKeys = ["baseURL", "model", "apiKey"] as const;
  const SET_ROWS = 8; // 3 text + theme + git + lang + lines + vim rows
  const handleSettingsKey = (ch: string, k: Key) => {
    if (setEditing) {
      editMini((v) => setSetEditing(v), setEditing, ch, k, () => {
        const field = setFieldKeys[setIdx];
        const value = setEditing.value;
        setSetEditing(null);
        void saveConfig({ [field]: value } as Partial<SettingsDraft>).then((cfg) => {
          setDraft({ baseURL: cfg.baseURL, model: cfg.model, apiKey: cfg.apiKey });
          setMsg(t("msg.settingsSaved"));
        });
      });
      return;
    }
    if (k.upArrow) setSetIdx((i) => (i + SET_ROWS - 1) % SET_ROWS);
    else if (k.downArrow || k.tab) setSetIdx((i) => (i + 1) % SET_ROWS);
    else if (k.return) {
      if (setIdx === 3) {
        cycleTheme(); // theme row: Enter cycles, stays open
        return;
      }
      if (setIdx === 5) {
        cycleLang();
        return;
      }
      if (setIdx === 6) {
        toggleLineNums();
        return;
      }
      if (setIdx === 7) {
        toggleVim();
        return;
      }
      if (setIdx === 4) {
        const next = !gitSyncOn;
        setGitSyncOn(next);
        void saveConfig({ gitSync: next }).catch(() => {});
        setMsg(t(next ? "msg.gitOn" : "msg.gitOff"));
        if (next) void refreshGit(next);
        else {
          setGitRootPath(null);
          setGitSt(null);
        }
        return;
      }
      const v = draft[setFieldKeys[setIdx]];
      setSetEditing({ value: v, cur: v.length });
    }
  };

  // Editing resumes live preview (drops a previous answer)
  useEffect(() => {
    setAnswer(null);
  }, [lines]);

  // External change watcher: auto-reload when clean, warn when dirty
  const lastExtChange = useRef(0);
  useEffect(() => {
    let w: { close: () => void } | null = null;
    let dead = false;
    try {
      w = watch(curFile, async () => {
        const now = Date.now();
        if (now - lastExtChange.current < 500) return;
        lastExtChange.current = now;
        try {
          const disk = await readFile(curFile, "utf-8");
          if (disk === linesRef.current.join("\n")) return; // our own save
          if (linesRef.current.join("\n") === baselineRef.current) {
            setLines(disk.split("\n"));
            setBaseline(disk);
            setMsg(t("msg.reloaded"));
          } else {
            setMsg(t("msg.diskChanged"));
          }
        } catch {
          // deleted mid-watch etc.
        }
      });
    } catch {
      // untitled / missing file
    }
    return () => {
      dead = true;
      try {
        w?.close();
      } catch {
        // already closed
      }
    };
  }, [curFile]);

  // Persist workspace (debounced; quit saves synchronously)
  useEffect(() => {
    const t = setTimeout(() => {
      void saveSession(buildSession());
    }, 1500);
    return () => clearTimeout(t);
  }, [tabs, active, curFile, cursor, lines, baseline]);

  const pvFollow = useRef(true);
  // Keep cursor visible in editor viewport (visual columns for CJK)
  useEffect(() => {
    setEdTop((top) => {
      if (cursor.r < top) return cursor.r;
      if (cursor.r >= top + edInnerH) return cursor.r - edInnerH + 1;
      return top;
    });
    const visC = colOfIndex(lines[cursor.r] ?? "", cursor.c);
    setEdLeft((left) => {
      if (visC < left) return visC;
      if (visC >= left + innerW) return visC - innerW + 1;
      return left;
    });
    pvFollow.current = true;
  }, [cursor, lines, innerH, innerW]);

  // Preview follows the cursor proportionally until the user scrolls it manually
  useEffect(() => {
    if (!pvFollow.current) return;
    setPvTop(followTop(cursor.r, lines.length, maxPvTop));
  }, [cursor, lines, maxPvTop]);

  // Clamp preview scroll when the viewport shrinks
  useEffect(() => {
    setPvTop((t) => clamp(t, 0, maxPvTop));
  }, [maxPvTop]);

  // Clamp sidebar selection/scroll when entries change
  useEffect(() => {
    setSideSel((s) => clamp(s, 0, Math.max(0, sideItems.length - 1)));
    setSideTop((t) => clamp(t, 0, Math.max(0, sideRows.length - innerH)));
  }, [sideItems.length, sideRows.length, innerH]);

  // Scrollspy: keep the active heading visible as the cursor moves
  useEffect(() => {
    if (!sideOpen || activeHeadIdx < 0) return;
    const row = rowOfItem(activeHeadIdx);
    if (row < 0) return;
    setSideTop((t) => (row < t ? row : row >= t + innerH ? row - innerH + 1 : t));
  }, [sideOpen, activeHeadIdx, sideRows, innerH]);

  // Latest layout/buffer snapshot for the mouse handler
  const geoRef = useRef({ edTop, edLeft, lines, maxPvTop, innerH, innerW, cols, rowsSafe, sel, viewMode, focus, overlay, ox: 0, pairW: 0, pairSrcW: 0, edInnerH: 0, active: 0, tabsCount: 0, sideOpen: false, sideW: 0, sideRowsN: 0, sideTop: 0, termOutH: 0, termMaxTop: 0, tabsBar: false, gutterW: 0 });
  geoRef.current = { edTop, edLeft, lines, maxPvTop, innerH, innerW, cols, rowsSafe, sel, viewMode, focus, overlay, ox, pairW, pairSrcW, edInnerH, active, tabsCount: tabs.length, sideOpen, sideW, sideRowsN: sideRows.length, sideTop, termOutH: outH, termMaxTop: maxTermTop, tabsBar: tabsVisible, gutterW };
  // Fresh action closures for the mouse handler (its effect runs once)
  const actionsRef = useRef({ switchToFile, quitNow, saveNow, newFile, openTab, switchTab, closeTab, closeTabAt, openOverlayKind, submitAsk, cancelAsk, submitFind, submitRun, closeTerm, stepFind, cycleView, cycleTheme, activateMenuIndex, activateSideItem, jumpToProblem, exportHtml, fireButton });
  actionsRef.current = { switchToFile, quitNow, saveNow, newFile, openTab, switchTab, closeTab, closeTabAt, openOverlayKind, submitAsk, cancelAsk, submitFind, submitRun, closeTerm, stepFind, cycleView, cycleTheme, activateMenuIndex, activateSideItem, jumpToProblem, exportHtml, fireButton };
  // Button spans (header row) + overlay menu geometry, written during render
  const btnSpansRef = useRef<BtnSpan[]>([]);
  const pairTitleSpansRef = useRef<Array<{ pair: number; x0: number; x1: number }>>([]);
  const overlayGeomRef = useRef<{ top: number; left: number; width: number; count: number } | null>(null);

  // SGR mouse tracking: click to focus/place cursor, drag to select, wheel to scroll.
  // Parsing lives in the module-level bus (attached before Ink); here we only
  // enable terminal tracking and register the component handler.
  useEffect(() => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY || !stdout.isTTY) return;
    stdout.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h");

    // Header button bar (mouse) — keyboard menu mode uses fireButton too
    const onHeaderButton = (id: string) => {
      actionsRef.current.fireButton(id);
    };

    const handleMouse: MouseHandler = (cb, x1, y1, pressed) => {
      const g = geoRef.current;
      const btn = cb & 3;
      const x = x1 - 1; // 0-based screen coords (alternate screen => layout rows)
      const y = y1 - 1;
      if (g.overlay === "qr") return; // fullscreen QR must not activate hidden controls

      // Header button bar
      if (y === 0) {
        if (pressed && btn === 0 && !(cb & 32)) {
          const hit = btnSpansRef.current.find((b) => x >= b.x0 && x < b.x1);
          if (hit) onHeaderButton(hit.id);
        }
        return;
      }

      // Overlay menus: click a row to activate (help: any click closes)
      if (g.overlay === "help") {
        if (pressed && btn === 0 && !(cb & 32)) setOverlay(null);
        return;
      }
      if ((g.overlay === "file" || g.overlay === "open" || g.overlay === "lint") && pressed && btn === 0 && !(cb & 32)) {
        const geom = overlayGeomRef.current;
        if (geom && y >= geom.top + 2 && y < geom.top + 2 + geom.count && x >= geom.left && x < geom.left + geom.width) {
          actionsRef.current.activateMenuIndex(y - (geom.top + 2));
        }
        return;
      }
      if (g.overlay) return; // ask/settings: keyboard-driven

      const topRow = g.tabsBar ? 2 : 1;
      const bottomRow = topRow + (g.rowsSafe - 2 - (g.tabsBar ? 1 : 0) - g.termOutH) - 2;
      const contentRow = y - topRow - 1;
      if (g.tabsBar && y === 1) {
        if (pressed && btn === 0 && !(cb & 32)) {
          const hit = tabSpansRef.current.find((b) => x >= b.x0 && x < b.x1);
          if (hit) {
            if (hit.idx >= 0) actionsRef.current.switchTab(hit.idx);
            else actionsRef.current.newFile();
          }
        }
        return;
      }

      // Bottom output panel: wheel scrolls, clicks ignored
      if (g.termOutH > 0 && y >= g.rowsSafe - 1 - g.termOutH && y <= g.rowsSafe - 2) {
        if (cb & 64) {
          const d = btn === 0 ? -3 : 3;
          setTermTop((t) => clamp(t + d, 0, g.termMaxTop));
        }
        return;
      }
      if (y < topRow || y > bottomRow) return;

      // Sidebar explorer (when open): wheel scrolls, click opens
      const inSide = g.sideOpen && x >= 1 && x <= g.sideW - 2;
      if (inSide) {
        if (cb & 64) {
          const d = btn === 0 ? -3 : 3;
          setSideTop((t) => clamp(t + d, 0, Math.max(0, g.sideRowsN - g.innerH)));
          return;
        }
        if (contentRow < 0) return;
        if (pressed && btn === 0 && !(cb & 32)) {
          const row = sideRowsRef.current[g.sideTop + contentRow];
          if (row?.kind === "item" && row.itemIdx !== undefined) {
            actionsRef.current.activateSideItem(row.itemIdx);
          }
        }
        return;
      }

      // ---- pairs: locate pair, handle title X + focus ----
      const nPairs = Math.max(1, g.tabsCount);
      const pw = Math.max(1, g.pairW);
      if (x < g.ox) return; // safety (sidebar handled above)
      const pp = clamp(Math.floor((x - g.ox) / pw), 0, nPairs - 1);
      const boxX = g.ox + pp * pw;
      const srcW = g.viewMode === "split" ? g.pairSrcW : g.pairW;
      const titleY = topRow + 1;
      if (process.env.MDOK_MOUSELOG === "1") {
        try {
          appendFileSync(
            "/tmp/mdmouse.log",
            `${new Date().toISOString()} pre-title y=${y} x=${x} titleY=${titleY} nPairs=${nPairs} pp=${pp} spans=${JSON.stringify(pairTitleSpansRef.current)} tabsBar=${g.tabsBar} vm=${g.viewMode} active=${g.active}\n`,
          );
        } catch {
          // debug
        }
      }
      if (g.viewMode !== "preview" && y === titleY) {
        if (pressed && btn === 0 && !(cb & 32)) {
          const hit = pairTitleSpansRef.current.find(
            (b) => b.pair === pp && x >= b.x0 && x < b.x1,
          );
          if (hit) {
            actionsRef.current.closeTabAt(hit.pair);
            return;
          }
          if (x >= boxX + 1 && x <= boxX + srcW - 2) {
            if (pp !== g.active) actionsRef.current.switchTab(pp);
            else setFocus("editor");
          }
        }
        return;
      }
      // Non-active pair: switch focus only (placement/scroll next time)
      if (pp !== g.active) {
        if ((pressed && btn === 0 && !(cb & 32)) || cb & 64) {
          actionsRef.current.switchTab(pp);
        }
        return;
      }

      // ---- active pair content ----
      const edRow = contentRow - 1; // editor panes carry a title row
      const inLeft =
        g.viewMode !== "preview" && x >= boxX + 1 && x <= boxX + srcW - 2;
      const inRight =
        g.viewMode !== "source" &&
        x >= boxX + (g.viewMode === "split" ? srcW : 0) + 1 &&
        x <= boxX + pw - 2;

      if (cb & 64) {
        // Wheel: 64 up, 65 down — scroll the pane under the pointer
        const d = btn === 0 ? -3 : 3;
        if (inLeft) {
          setEdTop((t) => clamp(t + d, 0, Math.max(0, g.lines.length - g.edInnerH)));
        } else if (inRight) {
          pvFollow.current = false;
          setPvTop((t) => clamp(t + d, 0, g.maxPvTop));
        }
        return;
      }
      if (!pressed || btn !== 0) return; // left button only (press, drag, release)
      if (inLeft && (edRow < 0 || edRow >= g.edInnerH)) return;
      if (cb & 32) {
        // Drag motion: extend selection from the press anchor
        if (inLeft && g.sel) {
          const r = clamp(g.edTop + edRow, 0, g.lines.length - 1);
          const c = clamp(indexOfCol(g.lines[r] ?? "", Math.max(0, g.edLeft + (x - boxX - 1 - g.gutterW))), 0, (g.lines[r] ?? "").length);
          const pos = { r, c };
          setCursor(pos);
          setSel({ anchor: g.sel.anchor, active: pos });
        }
        return;
      }
      if (!pressed) return; // release: keep selection
      if (inLeft) {
        setFocus("editor");
        const r = clamp(g.edTop + edRow, 0, g.lines.length - 1);
        const c = clamp(indexOfCol(g.lines[r] ?? "", Math.max(0, g.edLeft + (x - boxX - 1 - g.gutterW))), 0, (g.lines[r] ?? "").length);
        const pos = { r, c };
        setCursor(pos);
        setSel({ anchor: pos, active: pos });
      } else if (inRight) {
        setFocus("preview");
        pvFollow.current = false;
        setSel(null);
      }
    };

    mouseHandler = handleMouse;
    rawKeyHandler = (seq) => {
      if (seq !== "f10") return;
      if (geoRef.current.overlay) return;
      setLeader(false);
      setQuitArmed(false);
      setMenuSel(menuIdsRef.current[0] ?? "view");
    };
    return () => {
      detachMouseListener();
      stdout.write("\x1b[?1000l\x1b[?1002l\x1b[?1006l");
    };
  }, []);

  useInput((input, key) => {
    // QR consumes only explicit commands, before the mouse suppression window.
    if (overlay === "qr" && !key.ctrl) {
      const action = qrInputAction(input, key);
      if (action === "close") { setOverlay(null); setQrPlaying(false); }
      else if (action === "toggle") setQrPlaying(v => !v);
      else if (qr && (action === "next" || action === "previous")) {
        setQrPlaying(false);
        setQrPage(i => (i + (action === "previous" ? -1 : 1) + qr.frames.length) % qr.frames.length);
      }
      return;
    }
    if (process.env.MDOK_MOUSELOG === "1") {
      try {
        appendFileSync(
          "/tmp/mdmouse.log",
          `${new Date().toISOString()} key:${JSON.stringify(input)} esc=${key.escape} tab=${key.tab} ret=${key.return} ctrl=${key.ctrl} meta=${key.meta} menuSel=${menuSel} overlay=${overlay}\n`,
        );
      } catch {
        // debug only
      }
    }
    // Drop key events polluted by mouse bytes (see module bus above).
    // Backup: a lone Escape opens a short window too — every SGR sequence
    // starts with one, which covers sequences split across stdin chunks.
    if (Date.now() < junkSuppressUntil) return;
    // Lone Esc opens a short suppression window (split-chunk mouse cover),
    // but never when Esc is a real key: menu/overlay close, leader cancel.
    if (key.escape && !leader && !overlay && !menuSel) {
      if (vimOn && vimInsert && focus === "editor") {
        setVimInsert(false);
        return;
      }
      if (asking) {
        cancelAsk();
        return;
      }
      if (focus === "side") {
        setFocus("editor");
        return;
      }
      if (find) {
        setFind(null);
        setMsg(t("msg.findCleared"));
        return;
      }
      junkSuppressUntil = Date.now() + 40;
      return; // Esc does nothing outside command mode
    }
    // Mouse bytes surfaced by readline: SGR ("[<64;20;10M", ESC stripped or
    // not) and legacy X10 ("[M !!"). Never let these reach the buffer.
    // (F10 never reaches here — Ink swallows it; the raw bus handles it.)
    if (
      /^\x1b?\[<\d*[;0-9]*[Mm]?$/.test(input) ||
      /^\x1b?\[M.{0,3}$/.test(input) ||
      input.includes("\x1b[")
    ) {
      return;
    }

    // readline may coalesce rapid control keys into one event with raw bytes
    // and no flags (e.g. merged Ctrl+Q bytes, or ^O+Tab in a single write).
    // Match on escaped codes so the source stays readable.
    let lead = leader;
    if (!key.ctrl && input.includes("\x0f")) {
      input = input.replace(/\x0f/g, "");
      if (input) {
        lead = true; // remainder is this event's command key
      } else {
        setLeader((v) => !v);
        setQuitArmed(false);
        return;
      }
    }
    if (!key.ctrl && /[\x11\x13]/.test(input)) {
      if (input.includes("\x13")) saveNow();
      if (input.includes("\x11")) quitNow();
      input = input.replace(/[\x11\x13]/g, "");
      if (!input) return;
    }
    // Tab may arrive merged without flags (no key.tab) — detect raw byte too.
    const tabPressed = key.tab || input.includes("\t");

    // Overlay open: route all keys to it (clears any pending leader)
    if (overlay) {
      setLeader(false);
      if (overlay === "qr") {
        if (key.escape || input === "q") { setOverlay(null); setQrPlaying(false); }
        else if (input === " ") setQrPlaying(v => !v);
        else if (qr && (key.leftArrow || key.rightArrow || input === "n" || input === "p")) {
          setQrPlaying(false);
          const delta = key.leftArrow || input === "p" ? -1 : 1;
          setQrPage(i => (i + delta + qr.frames.length) % qr.frames.length);
        }
        return;
      }
      if (key.escape) {
        if (Date.now() - uiOpenedAt.current < 300) return;
        if (overlay === "settings" && setEditing) setSetEditing(null);
        else setOverlay(null);
        return;
      }
      if (overlay === "help") {
        setOverlay(null);
        return;
      }
      if (overlay === "file") {
        if (key.upArrow) setMenuIdx((i) => (i + 6) % 7);
        else if (key.downArrow) setMenuIdx((i) => (i + 1) % 7);
        else if (key.return) activateMenuIndex(menuIdx);
        else if (input >= "1" && input <= "7") activateMenuIndex(parseInt(input, 10) - 1);
        return;
      }
      if (overlay === "open") {
        const n = openFiles.length;
        if (!n) return;
        if (key.upArrow) setMenuIdx((i) => (i + n - 1) % n);
        else if (key.downArrow) setMenuIdx((i) => (i + 1) % n);
        else if (key.return) activateMenuIndex(menuIdx);
        else if (input >= "1" && input <= "9" && parseInt(input, 10) <= n) {
          activateMenuIndex(parseInt(input, 10) - 1);
        }
        return;
      }
      if (overlay === "ask") {
        editMini((v) => setAskEdit(v), askEdit, input, key, () => void submitAsk());
        return;
      }
      if (overlay === "find") {
        if (key.tab) {
          setRepIdx((i) => (i + 1) % 2);
          return;
        }
        if (repIdx === 0) editMini((v) => setFindEdit(v), findEdit, input, key, () => submitFind());
        else editMini((v) => setRepEdit(v), repEdit, input, key, () => replaceAll());
        return;
      }
      if (overlay === "lint") {
        if (!problems.length) return;
        if (key.upArrow) setMenuIdx((i) => (i + problems.length - 1) % problems.length);
        else if (key.downArrow) setMenuIdx((i) => (i + 1) % problems.length);
        else if (key.return) jumpToProblem(menuIdx);
        else if (input >= "1" && input <= "9" && parseInt(input, 10) <= problems.length) {
          jumpToProblem(parseInt(input, 10) - 1);
        }
        return;
      }
      if (overlay === "diff") {
        if (key.escape || input === "n") rejectDiff();
        else if (key.return || input === "y") acceptDiff();
        return;
      }
      if (overlay === "sync") {
        if (input === "p") void syncPush();
        else if (input === "l") void syncPull();
        else if (input === "c") void syncCommitNow();
        else if (input === "a") {
          const next = !gitSyncOn;
          setGitSyncOn(next);
          void saveConfig({ gitSync: next }).catch(() => {});
          setMsg(t(next ? "msg.gitOn" : "msg.gitOff"));
          if (next) void refreshGit(next);
          else {
            setGitRootPath(null);
            setGitSt(null);
          }
        }
        return;
      }
      if (overlay === "run") {
        if ((key.upArrow || key.downArrow) && cmdHist.length) {
          const n = cmdHist.length;
          const ni = clamp(cmdHistIdx + (key.upArrow ? 1 : -1), -1, n - 1);
          setCmdHistIdx(ni);
          const v = ni < 0 ? "" : cmdHist[n - 1 - ni];
          setRunEdit({ value: v, cur: v.length });
          return;
        }
        editMini((v) => setRunEdit(v), runEdit, input, key, () => void submitRun());
        return;
      }
      if (overlay === "settings") {
        handleSettingsKey(input, key);
        return;
      }
      return;
    }

    // Menu bar mode: arrows move across top buttons, Enter runs, Esc exits
    // Entry: F10 (raw bus), Alt+M (needs Option-as-Meta), or ^O m
    if ((key.meta && input === "m") || (key.ctrl && input === "m")) {
      enterMenu();
      return;
    }
    if (menuSel && !overlay) {
      setLeader(false);
      const ids = menuIdsRef.current.length ? menuIdsRef.current : ["view"];
      const idx = Math.max(0, ids.indexOf(menuSel));
      if (key.escape) {
        if (Date.now() - uiOpenedAt.current < 300) return;
        setMenuSel(null);
        return;
      }
      if (key.leftArrow) {
        setMenuSel(ids[(idx + ids.length - 1) % ids.length]);
        return;
      }
      if (key.rightArrow) {
        setMenuSel(ids[(idx + 1) % ids.length]);
        return;
      }
      if (key.return) {
        fireButton(ids[idx]);
        return;
      }
      return; // modal: swallow other keys
    }

    // Leader key: Ctrl+O enters command mode, next key runs a command
    if (key.ctrl && input === "o") {
      setLeader((v) => !v);
      setQuitArmed(false);
      return;
    }
    if (lead) {
      setLeader(false);
      if (key.escape) {
        setQuitArmed(false);
        return;
      }
      if (tabPressed) {
        cycleFocus();
        setQuitArmed(false);
      } else if (input === "e") {
        setFocus("editor");
        setQuitArmed(false);
      } else if (input === "p") {
        setFocus("preview");
        setQuitArmed(false);
      } else if (input === "v") {
        cycleView();
        setQuitArmed(false);
      } else if (input === "f") {
        void openOverlayKind("file");
      } else if (input === "r") {
        void openOverlayKind("qr");
      } else if (input === "a") {
        void openOverlayKind("ask");
      } else if (input === "/") {
        void openOverlayKind("find");
      } else if (input === "!") {
        void openOverlayKind("run");
      } else if (input === "n") {
        stepFind(1);
      } else if (input === "N") {
        stepFind(-1);
      } else if (input === "b") {
        toggleSide();
      } else if (input === "t") {
        cycleTheme();
        setQuitArmed(false);
      } else if (input === "l") {
        toggleLineNums();
        setQuitArmed(false);
      } else if (input === "L") {
        runLint();
      } else if (input === "F") {
        applyFormat();
      } else if (input === "g") {
        setOverlay("sync");
        void refreshGit();
        setQuitArmed(false);
      } else if (input === "|") {
        applyTableFormat();
      } else if (input === "V") {
        toggleVim();
      } else if (input === "R") {
        void startRewrite();
      } else if (input === "m") {
        enterMenu();
      } else if (input >= "1" && input <= "9") {
        switchTab(parseInt(input, 10) - 1);
      } else if (input === "w") {
        closeTab();
      } else if (input === "c") {
        void openOverlayKind("settings");
      } else if (input === "?") {
        setOverlay("help");
        setQuitArmed(false);
      } else if (input === "s") {
        saveNow();
      } else if (input === "q") {
        quitNow();
      } else {
        setQuitArmed(false);
        setMsg(t("hint.leaderUnknown"));
      }
      return;
    }
    // Bottom output panel open: modal-ish (scroll, close, quit pass through)
    if (term && !overlay && !menuSel) {
      if (key.ctrl && input === "q") {
        quitNow();
        return;
      }
      if (key.escape || key.return) {
        closeTerm();
        return;
      }
      if (key.upArrow) setTermTop((t) => clamp(t - 1, 0, maxTermTop));
      else if (key.downArrow) setTermTop((t) => clamp(t + 1, 0, maxTermTop));
      else if (key.pageUp) setTermTop((t) => clamp(t - outInnerH, 0, maxTermTop));
      else if (key.pageDown) setTermTop((t) => clamp(t + outInnerH, 0, maxTermTop));
      return;
    }
    // Direct shortcuts (muscle memory)
    if (key.ctrl && input === "s") {
      saveNow();
      return;
    }
    if (key.ctrl && input === "q") {
      quitNow();
      return;
    }
    setQuitArmed(false);

    if (focus === "side") {
      const total = sideItems.length;
      const moveSide = (d: number) => {
        if (!total) return;
        const ni = clamp(sideSel + d, 0, total - 1);
        setSideSel(ni);
        const row = rowOfItem(ni);
        if (row >= 0) setSideTop((t) => (row < t ? row : row >= t + innerH ? row - innerH + 1 : t));
      };
      if (key.upArrow) moveSide(-1);
      else if (key.downArrow) moveSide(1);
      else if (key.return) activateSideItem(sideSel);
      else if (key.escape) setFocus("editor");
      else if (tabPressed) cycleFocus();
      return;
    }

    if (focus === "preview") {
      if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) pvFollow.current = false;
      if (key.upArrow) setPvTop((t) => clamp(t - 1, 0, maxPvTop));
      else if (key.downArrow) setPvTop((t) => clamp(t + 1, 0, maxPvTop));
      else if (key.pageUp) setPvTop((t) => clamp(t - innerH, 0, maxPvTop));
      else if (key.pageDown) setPvTop((t) => clamp(t + innerH, 0, maxPvTop));
      else if (tabPressed) cycleFocus();
      return;
    }

    if (key.ctrl && input === "z" && focus === "editor") {
      doUndo();
      return;
    }
    if (key.ctrl && input === "y" && focus === "editor") {
      doRedo();
      return;
    }
    // Editor focused — collapse an active selection before editing,
    // clear it on navigation.
    let L = lines;
    let C = cursor;
    const keepSel = sel;
    const printableNow = Boolean(input && !key.ctrl && !key.meta && !key.escape);
    const editKind =
      key.return || key.backspace || key.delete || key.tab
        ? "break"
        : printableNow
          ? input.includes("\n")
            ? "break"
            : "type"
          : "";
    if (editKind) pushUndo({ lines, cursor }, editKind);
    const printable = Boolean(input && !key.ctrl && !key.meta && !key.escape);
    if (vimOn && !vimInsert) {
      if (key.ctrl || key.meta) return;
      const go = (r: number, c: number) => {
        const nr = clamp(r, 0, L.length - 1);
        setCursor({ r: nr, c: clamp(c, 0, (L[nr] ?? "").length) });
        setSel(null);
        setQuitArmed(false);
      };
      const ln0 = L[C.r] ?? "";
      if (key.leftArrow || input === "h") go(C.r, C.c - 1);
      else if (key.downArrow || input === "j") go(C.r + 1, C.c);
      else if (key.upArrow || input === "k") go(C.r - 1, C.c);
      else if (key.rightArrow || input === "l") go(C.r, C.c + 1);
      else if (input === "0") go(C.r, 0);
      else if (input === "$") go(C.r, ln0.length);
      else if (input === "G") go(L.length - 1, 0);
      else if (input === "i") {
        setVimInsert(true);
        setSel(null);
      } else if (input === "a") {
        setCursor({ r: C.r, c: Math.min(C.c + 1, ln0.length) });
        setVimInsert(true);
        setSel(null);
      } else if (input === "A") {
        setCursor({ r: C.r, c: ln0.length });
        setVimInsert(true);
        setSel(null);
      } else if (input === "o" || input === "O") {
        const at = input === "o" ? C.r + 1 : C.r;
        const next = [...L];
        next.splice(at, 0, "");
        setLines(next);
        setCursor({ r: at, c: 0 });
        setVimInsert(true);
        setSel(null);
      } else if (input === "x") {
        let lcl = L;
        let ccl = C;
        if (keepSel && cmpPos(keepSel.anchor, keepSel.active) !== 0) {
          const d = deleteRange(L, keepSel);
          lcl = d.ls;
          ccl = d.cur;
        }
        const l2 = lcl[ccl.r] ?? "";
        if (ccl.c < l2.length) {
          const nx = [...lcl];
          nx[ccl.r] = l2.slice(0, ccl.c) + l2.slice(ccl.c + 1);
          setLines(nx);
        }
        setCursor(ccl);
        setSel(null);
      }
      return;
    }
    if (sel && (key.return || key.backspace || key.delete || tabPressed || printable)) {
      const collapsed = deleteRange(L, sel);
      L = collapsed.ls;
      C = collapsed.cur;
      setSel(null);
    } else {
      setSel(null);
    }
    const line = L[C.r] ?? "";
    const snapTrail = (ln: string, c: number): number => {
      const cu = ln.charCodeAt(c);
      return cu >= 0xdc00 && cu <= 0xdfff && c < ln.length ? c + 1 : c;
    };
    const navTo = (np: Cursor) => {
      const fixed = { r: np.r, c: snapTrail(L[np.r] ?? "", np.c) };
      if (key.shift) setSel({ anchor: keepSel?.anchor ?? C, active: fixed });
      setCursor(fixed);
    };
    if (key.upArrow) {
      const r = clamp(C.r - 1, 0, L.length - 1);
      navTo({ r, c: clamp(C.c, 0, (L[r] ?? "").length) });
    } else if (key.downArrow) {
      const r = clamp(C.r + 1, 0, L.length - 1);
      navTo({ r, c: clamp(C.c, 0, (L[r] ?? "").length) });
    } else if (key.leftArrow) {
      if (C.c > 0) navTo({ ...C, c: C.c - 1 });
      else if (C.r > 0) {
        navTo({ r: C.r - 1, c: (L[C.r - 1] ?? "").length });
      }
    } else if (key.rightArrow) {
      if (C.c < line.length) navTo({ ...C, c: C.c + 1 });
      else if (C.r < L.length - 1) navTo({ r: C.r + 1, c: 0 });
    } else if (key.return) {
      const next = [...L];
      next[C.r] = line.slice(0, C.c);
      next.splice(C.r + 1, 0, line.slice(C.c));
      setLines(next);
      setCursor({ r: C.r + 1, c: 0 });
    } else if (key.backspace) {
      if (C.c > 0) {
        const next = [...L];
        next[C.r] = line.slice(0, C.c - 1) + line.slice(C.c);
        setLines(next);
        setCursor({ ...C, c: C.c - 1 });
      } else if (C.r > 0) {
        const prev = L[C.r - 1] ?? "";
        const next = [...L];
        next.splice(C.r, 1);
        next[C.r - 1] = prev + line;
        setLines(next);
        setCursor({ r: C.r - 1, c: prev.length });
      }
    } else if (key.delete) {
      if (C.c < line.length) {
        const next = [...L];
        next[C.r] = line.slice(0, C.c) + line.slice(C.c + 1);
        setLines(next);
      } else if (C.r < L.length - 1) {
        const next = [...L];
        next[C.r] = line + (next[C.r + 1] ?? "");
        next.splice(C.r + 1, 1);
        setLines(next);
      }
    } else if (key.home || (key.ctrl && input === "a")) {
      navTo({ ...C, c: 0 });
    } else if (key.end || (key.ctrl && input === "e")) {
      navTo({ ...C, c: line.length });
    } else if (tabPressed) {
      // Tab is free now that pane switching moved to ^O — insert 2 spaces
      const next = [...L];
      next[C.r] = line.slice(0, C.c) + "  " + line.slice(C.c);
      setLines(next);
      setCursor({ ...C, c: C.c + 2 });
    } else if (printable) {
      // Strip stray C0 controls (except tab/newline handling below)
      const text = input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
      if (!text) {
        // nothing printable
      } else {
      // Printable input (may be multi-char on paste)
      const parts = text.replace(/\r/g, "").split("\n");
      if (parts.length === 1) {
        const next = [...L];
        next[C.r] = line.slice(0, C.c) + parts[0] + line.slice(C.c);
        setLines(next);
        setCursor({ ...C, c: C.c + parts[0].length });
      } else {
        const next = [...L];
        const first = line.slice(0, C.c) + parts[0];
        const last = parts[parts.length - 1] + line.slice(C.c);
        next.splice(C.r, 1, first, ...parts.slice(1, -1), last);
        setLines(next);
        setCursor({ r: C.r + parts.length - 1, c: parts[parts.length - 1].length });
        }
      }
    }
  });

  const midStart = tabsVisible ? 2 : 1;
  const midH = rowsSafe - 2 - (tabsVisible ? 1 : 0) - outH;
  const tabBaseOf = (p: string) => p.split("/").pop() || p;
  const tabSpansRef = useRef<Array<{ idx: number; x0: number; x1: number }>>([]);
  {
    const spans: Array<{ idx: number; x0: number; x1: number }> = [];
    let tx = 1;
    tabs.forEach((t, i) => {
      const isDirty = i === active ? lines.join("\n") !== baseline : t.lines.join("\n") !== t.baseline;
      const label = ` [${i + 1} ${tabBaseOf(t.path)}${isDirty ? "\u25cf" : ""}]`;
      spans.push({ idx: i, x0: tx, x1: tx + label.length });
      tx += label.length;
    });
    spans.push({ idx: -1, x0: tx, x1: tx + 4 }); // " [+]"
    tabSpansRef.current = spans;
  }
  {
    const tSpans: Array<{ pair: number; x0: number; x1: number }> = [];
    if (viewMode !== "preview") {
      const sw = viewMode === "split" ? pairSrcW : pairW;
      tabs.forEach((tb, pi) => {
        const sx = ox + pi * pairW;
        tSpans.push({ pair: pi, x0: sx + sw - 4, x1: sx + sw - 1 });
      });
    }
    pairTitleSpansRef.current = tSpans;
  }
  const pvVisible = pvLines.slice(pvTop, pvTop + innerH);

  // ---- Header button bar (spans must match rendered widths exactly) ----
  const viewBtnLabel = `[${viewMode === "split" ? t("btn.split") : viewMode === "source" ? t("btn.src") : t("btn.view")}]`;
  const menuBtn = "[>]"; // toggles the sidebar
  const fullRight: Array<[string, string]> = [["ask", t("btn.ask")], ["find", t("btn.find")], ["file", t("btn.file")], ["qr", "QR"], ["shell", t("btn.shell")], ["set", t("btn.set")], ["help", t("btn.help")], ["quit", t("btn.quit")]];
  const leftFixed = menuBtn.length + 1 + 5 + viewBtnLabel.length + 1; // "[Menu] " + "mdok " + view + space
  const fullRightWidth = fullRight.reduce((a, [, l]) => a + l.length + 3, 0);
  const compact = cols < leftFixed + fullRightWidth + 14;
  const rightDefs: Array<[string, string]> = compact ? [["qr", "QR"], ["quit", "X"]] : fullRight;
  const rightWidth = rightDefs.reduce((a, [, l]) => a + l.length + 3, 0);
  const fileMax = Math.max(6, cols - leftFixed - rightWidth - 2);
  const shownFile = curFile.length > fileMax ? "…" + curFile.slice(-fileMax + 1) : curFile;
  const padMid = Math.max(1, cols - (leftFixed + shownFile.length + (dirty ? 2 : 0)) - rightWidth);
  {
    const spans: BtnSpan[] = [
      { id: "menu", x0: 0, x1: menuBtn.length },
      { id: "view", x0: menuBtn.length + 1 + 5, x1: menuBtn.length + 1 + 5 + viewBtnLabel.length },
    ];
    let rx = cols - rightWidth;
    for (const [id, label] of rightDefs) {
      spans.push({ id, x0: rx, x1: rx + label.length + 2 });
      rx += label.length + 3;
    }
    btnSpansRef.current = spans;
    menuIdsRef.current = spans.map((s) => s.id).filter((id) => id !== "menu");
  }
  const menuBtnStyle = (id: string) =>
    menuSel === id ? { backgroundColor: theme.accent, color: "black" } as const : null;

  const renderMiniCursor = (edit: MiniEdit) => {
    const before = edit.value.slice(0, edit.cur);
    const ch = edit.value[edit.cur] ?? " ";
    const after = edit.value.slice(edit.cur + 1);
    return (
      <Text wrap="truncate">
        {before}
        <Text inverse>{ch}</Text>
        {after}
      </Text>
    );
  };

  // ---- Centered overlay box; menuCount>0 rows are clickable (see handler) ----
  const centerBox = (title: string, body: React.ReactNode[], hint: string, menuCount?: number, width?: number) => {
    const boxW = Math.min(width ?? 56, cols - 6);
    const boxH = body.length + 4;
    const top = midStart + Math.max(0, Math.floor((midH - boxH) / 2));
    const left = Math.max(0, Math.floor((cols - boxW) / 2));
    overlayGeomRef.current = menuCount ? { top, left, width: boxW, count: menuCount } : null;
    return (
      <Box flexDirection="column" flexGrow={1}>
        {top - 1 > 0 ? <Box height={top - 1} /> : null}
        <Box marginLeft={left}>
          <Box flexDirection="column" width={boxW} borderStyle="round" borderColor={theme.accent}>
            <Text bold> {title}</Text>
            {body}
            <Text dimColor> {hint}</Text>
          </Box>
        </Box>
      </Box>
    );
  };

  const renderOverlay = () => {
    if (overlay === "file") {
      const items = [t("menu.save"), t("menu.new"), t("menu.open"), t("menu.run"), t("menu.export"), t("menu.closeTab"), t("menu.qr")];
      return centerBox(
        "File",
        items.map((t, i) => (
          <Text key={t} inverse={i === menuIdx}>{i === menuIdx ? ">" : " "} {i + 1} {t}</Text>
        )),
        t("menu.keys"),
        items.length,
      );
    }
    if (overlay === "open") {
      const rows =
        openFiles.length > 0
          ? openFiles.map((n, i) => (
              <Text key={n} inverse={i === menuIdx} wrap="truncate">
                {i === menuIdx ? ">" : " "} {i < 9 ? `${i + 1} ` : "  "}{n}
              </Text>
            ))
          : [<Text key="empty" dimColor>  {t("open.empty")}</Text>];
      return centerBox(t("open.title"), rows, t("menu.keys"), rows.length, 64);
    }
    if (overlay === "lint") {
      const rows =
        problems.length > 0
          ? problems.map((pr, i) => (
              <Text key={`${pr.line}:${pr.col}:${pr.rule}`} inverse={i === menuIdx} wrap="truncate">
                {i === menuIdx ? ">" : " "} {i < 9 ? `${i + 1} ` : "  "}L{pr.line + 1}:{pr.col + 1} {pr.rule} {pr.msg}
              </Text>
            ))
          : [<Text key="empty" dimColor>  {t("lint.empty")}</Text>];
      return centerBox(t("lint.title"), rows, t("lint.hint"), rows.length, 72);
    }
    if (overlay === "diff" && diff) {
      const drows = diffLines(diff.original, diff.revised)
        .slice(0, 60)
        .map((d, i) =>
          d.t === " " ? (
            <Text key={i} dimColor wrap="truncate">  {d.text || " "}</Text>
          ) : d.t === "-" ? (
            <Text key={i} color="red" wrap="truncate">- {d.text}</Text>
          ) : (
            <Text key={i} color="green" wrap="truncate">+ {d.text}</Text>
          ),
        );
      return centerBox(
        t("diff.title"),
        drows.length ? drows : [<Text key="e" dimColor>  {t("diff.empty")}</Text>],
        t("diff.hint"),
        undefined,
        72,
      );
    }
    if (overlay === "ask") {
      return centerBox(
        t("ask.title"),
        [<Text key="q"> {renderMiniCursor(askEdit)}</Text>],
        t("ask.hint"),
        undefined,
        64,
      );
    }
    if (overlay === "find") {
      return centerBox(
        t("find.title"),
        [
          <Text key="q"> {repIdx === 0 ? ">" : " "} {t("find.findRow")} {repIdx === 0 ? renderMiniCursor(findEdit) : findEdit.value || t("find.empty")}</Text>,
          <Text key="r"> {repIdx === 1 ? ">" : " "} {t("find.repRow")} {repIdx === 1 ? renderMiniCursor(repEdit) : repEdit.value || t("find.empty")}</Text>,
        ],
        t("find.hint"),
        undefined,
        64,
      );
    }
    if (overlay === "run") {
      return centerBox(
        t("run.title"),
        [<Text key="q"> $ {renderMiniCursor(runEdit)}</Text>],
        t("run.hint"),
        undefined,
        64,
      );
    }
    if (overlay === "sync") {
      const rows = gitRootPath
        ? [
            <Text key="b"> {t("sync.branch")} {gitSt?.branch ?? "…"}</Text>,
            <Text key="ab">
              {" "} {gitSt ? (!gitSt.upstream ? t("sync.noUpstream") : `${gitSt.ahead > 0 ? `⇡${gitSt.ahead} ` : ""}${gitSt.behind > 0 ? `⇣${gitSt.behind} ` : ""}${gitSt.ahead === 0 && gitSt.behind === 0 ? t("sync.insync") : ""}`) : "…"}
              {gitSt?.conflict ? t("sync.conflict") : ""}
            </Text>,
            <Text key="au" dimColor> {t("sync.auto")} {gitSyncOn ? t("sync.autoOn") : t("sync.autoOff")}</Text>,
          ]
        : [<Text key="n" dimColor>  {t("sync.notRepo")}</Text>];
      return centerBox(t("sync.title"), rows, t("sync.hint"), undefined, 64);
    }
    if (overlay === "settings") {
      const rows = (["baseURL", "model", "apiKey"] as const).map((k, i) => {
        const raw = draft[k];
        const disp = k === "apiKey" ? (raw ? `***${raw.slice(-4)}` : t("set.notset")) : raw || t("set.empty");
        const editing = setEditing !== null && i === setIdx;
        return (
          <Text key={k} wrap="truncate">
            {i === setIdx ? ">" : " "} {k}: {editing && setEditing ? renderMiniCursor(setEditing) : disp}
          </Text>
        );
      });
      rows.push(
        <Text key="theme" wrap="truncate">
          {setIdx === 3 ? ">" : " "} {t("set.themeRow")} {themeName} ({t("set.themeCycle")} {allThemes.map((x) => x.name).join(" · ")})
        </Text>,
        <Text key="git" wrap="truncate">
          {setIdx === 4 ? ">" : " "} {t("set.gitRow")} {gitSyncOn ? t("set.on") : t("set.off")} {t("set.gitToggle")}
        </Text>,
        <Text key="lang" wrap="truncate">
          {setIdx === 5 ? ">" : " "} {t("set.langRow")} {lang} {t("set.langToggle")}
        </Text>,
        <Text key="lines" wrap="truncate">
          {setIdx === 6 ? ">" : " "} {t("set.linesRow")} {showNums ? t("set.on") : t("set.off")} {t("set.linesToggle")}
        </Text>,
        <Text key="vim" wrap="truncate">
          {setIdx === 7 ? ">" : " "} {t("set.vimRow")} {vimOn ? t("set.on") : t("set.off")} {t("set.vimToggle")}
        </Text>,
      );
      return centerBox(t("set.title"), rows, t("set.hint"), undefined, 76);
    }
    // help
    return centerBox(
      t("help.title"),
      [
        <Text key="a">{t("help.h1")}</Text>,
        <Text key="b">{t("help.h2")}</Text>,
        <Text key="b2">{t("help.h3")}</Text>,
        <Text key="c">{t("help.h4")}</Text>,
        <Text key="e">{t("help.h5")}</Text>,
        <Text key="f">{t("help.h6")}</Text>,
        <Text key="d">{t("help.h7")}</Text>,
        <Text key="h8">{t("help.h8")}</Text>,
      ],
      t("help.close"),
    );
  };

  const curFindIdx =
    find && findMatches.length
      ? ((find.idx % findMatches.length) + findMatches.length) % findMatches.length
      : -1;

  const sideRow = (it: SideItem, idx: number) => {
    const isActiveHead = it.kind === "heading" && idx === activeHeadIdx;
    return (
      <Text
        key={`${it.kind}::${it.path ?? it.label}::${idx}`}
        inverse={idx === sideSel}
        bold={isActiveHead}
        wrap="truncate"
      >
        {idx === sideSel ? ">" : isActiveHead ? "●" : " "} {it.label}
        {it.kind === "file" && it.path === curFile ? " ●" : ""}
        {it.git ? ` ${it.git}` : ""}
      </Text>
    );
  };

  const renderSidebar = () => {
    const rows: React.ReactNode[] = sideRows.map((row, ri) => {
      if (row.kind === "title") return <Text key={`r${ri}`} bold> {t("side.title")}</Text>;
      if (row.kind === "sec") return <Text key={`r${ri}`} dimColor> ─ {row.label}</Text>;
      const idx = row.itemIdx ?? -1;
      const it = sideItems[idx];
      return it ? sideRow(it, idx) : null;
    });
    const visible = rows.slice(sideTop, sideTop + innerH);
    return (
      <Box flexDirection="column" width={sideW} borderStyle="single" borderColor={focus === "side" ? theme.focus : undefined}>
        {visible.length ? visible : <Text dimColor> {t("side.empty")}</Text>}
      </Box>
    );
  };

  const renderEditorPane = (
    w: number,
    L: string[],
    vw: EdView,
  ) => {
    const gw = showNums ? String(L.length).length + 1 : 0;
    const tw = Math.max(10, w - 2 - gw);
    const vis = L.slice(vw.edTop, vw.edTop + edInnerH);
    const titleInner = w - 2;
    const rawName = vw.title ? `${vw.title.name}${vw.title.dirty ? "●" : ""}` : "";
    const nameShown = truncToWidth(rawName, Math.max(1, titleInner - 5));
    const titlePad = vw.title ? Math.max(1, titleInner - 1 - strWidth(nameShown) - 3) : 0;
    return (
    <Box flexDirection="column" width={w} borderStyle="single" borderColor={vw.focusEd ? theme.focus : undefined}>
      {vw.title ? (
        <Text key="t" wrap="truncate"> {nameShown}{" ".repeat(titlePad)}<Text inverse>[X]</Text></Text>
      ) : null}
      {vis.map((ln, i) => {
        const r = vw.edTop + i;
        // UTF-16 offsets for this row (rendering walks visual columns)
        let selA = -1;
        let selB = -1;
        if (vw.sel) {
          const { start, end } = orderedSel(vw.sel);
          if (r >= start.r && r <= end.r) {
            selA = r === start.r ? start.c : 0;
            selB = r === end.r ? end.c : ln.length;
          }
        }
            const showCursor = !!vw.cursor && r === vw.cursor.r && vw.focusEd;
            const ccur = vw.cursor ? vw.cursor.c : -1;
            const runs: Array<{ text: string; style: "plain" | "sel" | "cur" | "find" | "findcur" }> = [];
            let runW = 0;
            const push = (ch: string, cw: number, style: "plain" | "sel" | "cur" | "find" | "findcur") => {
              const last = runs[runs.length - 1];
              if (last && last.style === style) last.text += ch;
              else runs.push({ text: ch, style });
              runW += cw;
            };
            const winEnd = vw.edLeft + tw;
            let col = 0;
            let ti = 0;
            for (const ch of graphemes(ln)) {
              const cw = charWidth(ch);
              const c0 = col;
              col += cw;
              const curTi = ti;
              ti += ch.length;
              if (col <= vw.edLeft || c0 >= winEnd) continue;
              let style: "plain" | "sel" | "cur" | "find" | "findcur" = "plain";
              if (selA >= 0 && curTi >= selA && curTi < selB) style = "sel";
              else if (showCursor && curTi === ccur) style = "cur";
              else if (vw.showFind && curFindIdx >= 0) {
                const m = findMatches.find(
                  (mm) => mm.r === r && curTi >= mm.c && curTi < mm.c + mm.len,
                );
                if (m) style = findMatches[curFindIdx] === m ? "findcur" : "find";
              }
              push(ch, cw, style);
            }
            if (showCursor && vw.cursor && vw.cursor.c >= ln.length) push(" ", 1, "cur");
            if (runW < tw) push(" ".repeat(tw - runW), tw - runW, "plain");
            const num = showNums ? `${String(r + 1).padStart(Math.max(0, gw - 1))} ` : "";
            return (
              <Text key={i}>
                {num ? <Text key="g" dimColor>{num}</Text> : null}
                {runs.map((run, k) =>
                  run.style === "sel" ? (
                    <Text key={k} backgroundColor={theme.selBg} color={theme.selFg}>{run.text}</Text>
                  ) : run.style === "cur" ? (
                    <Text key={k} inverse>{run.text}</Text>
                  ) : run.style === "findcur" ? (
                    <Text key={k} backgroundColor={theme.findCurBg} color={theme.findCurFg}>{run.text}</Text>
                  ) : run.style === "find" ? (
                    <Text key={k} backgroundColor={theme.findBg} color={theme.findFg}>{run.text}</Text>
                  ) : (
                    <Text key={k}>{run.text}</Text>
                  ),
                )}
              </Text>
            );
      })}
    </Box>
  );
  };

  const renderPreviewPane = (w: number) => (
    <Box flexDirection="column" width={w} borderStyle="single" borderColor={focus === "preview" ? theme.focus : undefined}>
      {pvVisible.map((ln, i) => (
        <Text key={i} wrap="truncate">
          {ln || " "}
        </Text>
      ))}
    </Box>
  );

  if (overlay === "qr" && qr) {
    const fits = qrRows.length + 4 <= rows && (qrRows[0]?.length ?? 0) <= columns;
    const pageLabel = `${qrPage + 1}/${qr.frames.length}`;
    const showSideLabel = (qrRows[0]?.length ?? 0) + 2 + pageLabel.length <= columns;
    return <Box flexDirection="column" height={rows} width={columns}>
      <Text wrap="truncate">{t("qr.title")} {truncToWidth(qr.name, Math.max(1, columns - 25))} · {qrPage + 1}/{qr.frames.length}</Text>
      <Text wrap="truncate">{t("qr.note")}</Text>
      {fits ? <Box flexDirection="column" alignItems="center" flexGrow={1} justifyContent="center">
        <Box flexDirection="row" alignItems="center">
          <Box flexDirection="column" flexShrink={0}>
            {qrRows.map((line, i) => <Text key={i} wrap="truncate">
              {chalk.level === 0 ? line : Array.from(line, (cell, j) => <Text key={j}
                color={cell === "█" || cell === "▀" ? "#000000" : "#ffffff"}
                backgroundColor={cell === "█" || cell === "▄" ? "#000000" : "#ffffff"}>▀</Text>)}
            </Text>)}
          </Box>
          {showSideLabel && <Box marginLeft={2} flexShrink={0}><Text bold>{pageLabel}</Text></Box>}
        </Box>
      </Box> : <Text>{t("qr.resize")}</Text>}
      <Text wrap="truncate">{!showSideLabel ? `${pageLabel} · ` : ""}{t("qr.keys")} · {qrPlaying ? t("qr.play") : t("qr.pause")}</Text>
      <Text wrap="truncate">{t("qr.receiver")}</Text>
    </Box>;
  }
  return (
    <Box flexDirection="column" height={rowsSafe}>
      <Box>
        <Text inverse>{menuBtn}</Text>
        <Text bold> mdok </Text>
        {menuBtnStyle("view") ? (
          <Text backgroundColor={theme.accent} color="black">{viewBtnLabel}</Text>
        ) : (
          <Text inverse>{viewBtnLabel}</Text>
        )}
        <Text> {shownFile}{dirty ? " ●" : ""}{" ".repeat(padMid)}</Text>
        {rightDefs.map(([id, label]) => (
          <Text key={id}>
            {menuBtnStyle(id) ? (
              <Text backgroundColor={theme.accent} color="black">{`[${label}]`}</Text>
            ) : (
              <Text inverse>{`[${label}]`}</Text>
            )}{" "}
          </Text>
        ))}
      </Box>
      {tabsVisible ? (
        <Box>
          {tabs.map((t, i) => {
            const isDirty = i === active ? lines.join("\n") !== baseline : t.lines.join("\n") !== t.baseline;
            const label = ` [${i + 1} ${tabBaseOf(t.path)}${isDirty ? "\u25cf" : ""}]`;
            return i === active ? (
              <Text key={t.path + i} inverse>{label}</Text>
            ) : (
              <Text key={t.path + i}>{label}</Text>
            );
          })}
          <Text> [+]</Text>
        </Box>
      ) : null}
      {overlay ? (
        renderOverlay()
      ) : (
        <Box flexDirection="row" flexGrow={1}>
          {sideOpen ? renderSidebar() : null}
          {tabs.map((tb, pi) => {
            const isA = pi === active;
            const srcW = viewMode === "split" ? pairSrcW : pairW;
            const base = tb.path.split("/").pop() || tb.path;
            const isDirty = isA ? lines.join("\n") !== baseline : tb.lines.join("\n") !== tb.baseline;
            const lastW = pi === tabs.length - 1;
            return (
              <Box
                key={`${tb.path}::${pi}`}
                flexDirection="row"
                width={lastW ? undefined : pairW}
                flexGrow={lastW ? 1 : 0}
              >
                {viewMode === "preview" ? null : renderEditorPane(
                  srcW,
                  isA ? lines : tb.lines,
                  isA
                    ? { cursor, sel, edTop, edLeft, focusEd: focus === "editor", showFind: true, title: { name: base, dirty: isDirty } }
                    : { cursor: null, sel: null, edTop: tb.edTop, edLeft: tb.edLeft, focusEd: false, showFind: false, title: { name: base, dirty: isDirty } },
                )}
                {viewMode === "source" ? null : isA ? (
                  renderPreviewPane(pairW - srcW)
                ) : (
                  <StaticPreview
                    text={tb.lines.join("\n")}
                    w={pairW - srcW}
                    top={tb.pvTop}
                    count={innerH}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      )}
      <Box>
        {menuSel ? (
          <Text bold wrap="truncate">{t("hint.menu")}</Text>
        ) : leader ? (
          <Text bold wrap="truncate">{t("hint.leader")}</Text>
        ) : overlay ? (
          <Text dimColor>{t("hint.overlayClose")}{overlay === "file" || overlay === "open" || overlay === "lint" ? t("hint.menuKeys") : ""}</Text>
        ) : term ? (
          <Text dimColor wrap="truncate">{t("hint.output")}</Text>
        ) : find && findMatches.length ? (
          <Text dimColor wrap="truncate">find “{find.pattern}” {curFindIdx + 1}/{findMatches.length} (^O n/N · Esc clear){asking ? " · asking…" : ""}</Text>
        ) : (
          <Text dimColor wrap="truncate">{t("hint.default")} · {stats.words}w{vimOn ? (vimInsert ? ` · ${t("status.insert")}` : ` · ${t("status.normal")}`) : ""}{gitSt ? ` · git:${gitSt.branch}${gitSt.ahead ? `⇡${gitSt.ahead}` : ""}${gitSt.behind ? `⇣${gitSt.behind}` : ""}${gitSt.conflict ? " !conflict" : ""}` : ""}{asking ? t("hint.asking") : ""}</Text>
        )}
        {msg ? <Text> — {msg}</Text> : null}
      </Box>
    </Box>
  );
}

export async function runTui(initialTabs: InitialTab[], startActive: number): Promise<void> {
  // Attach the mouse bus BEFORE Ink sets up its stdin parser so mouse bytes
  // are stamped/handled first and never surface as typed characters.
  if (process.stdin.isTTY) ensureMouseListener();
  const { render } = await import("ink");
  // Alternate screen: layout fills the screen so mouse coords map 1:1
  const { waitUntilExit } = render(<TuiApp initialTabs={initialTabs} startActive={startActive} />, {
    alternateScreen: true,
  });
  await waitUntilExit();
}
