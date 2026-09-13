import { homedir } from "node:os";
import { join,dirname } from "node:path";
import {randomUUID} from 'node:crypto';
import { readFile } from "node:fs/promises";
import { existsSync,mkdirSync,unlinkSync,readdirSync,lstatSync } from "node:fs";
import { writeFileAtomicSync } from "./atomic.js";

export interface SessionTab {
  path: string;
  cursor: { r: number; c: number };
  /** Unsaved buffer content (when dirty). Absent = matches disk. */
  content?: string;
  /** Exact disk token last explicitly loaded/saved; absent legacy drafts require review. */
  diskToken?: string|null;
}

export interface Session {
  files: SessionTab[];
  active: number;
}

const SESSION_PATH = join(homedir(), ".mdok-session.json");
const RECOVERY_DIR=join(dirname(SESSION_PATH),'.mdok-recovery');
const recoveryId=`${process.pid}-${randomUUID()}`;
const RECOVERY_PATH=join(RECOVERY_DIR,recoveryId+'.json');
const safeIndex = (value: unknown): number => typeof value === "number" && Number.isFinite(value)
  ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0;

export async function loadSession(): Promise<Session | null> {
  return readSession(SESSION_PATH);
}
async function readSession(path:string):Promise<Session|null>{
  if (!existsSync(path)) return null;
  try {
    const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>24*1024*1024)return null;
    const raw = JSON.parse(await readFile(path, "utf-8")) as Partial<Session>;
    if (!raw || !Array.isArray(raw.files) || !raw.files.length) return null;
    const entries = raw.files
      .map((file, originalIndex) => ({ file, originalIndex }))
      .filter(({ file }) => file && typeof file.path === "string" && file.path.length > 0)
      .slice(0, 10);
    const files = entries
      .map(({ file: f }) => ({
        path: f.path,
        cursor: {
          r: safeIndex(f.cursor?.r),
          c: safeIndex(f.cursor?.c),
        },
        ...(typeof f.content === "string" ? { content: f.content } : {}),
        ...(typeof f.content === 'string'?{diskToken:typeof f.diskToken==='string'&&/^(?:missing|[a-f0-9]{64})$/.test(f.diskToken)?f.diskToken:null}:{}),
      }));
    if (!files.length) return null;
    const active = entries.findIndex(entry => entry.originalIndex === safeIndex(raw.active));
    return { files, active: active >= 0 ? active : Math.min(safeIndex(raw.active), files.length - 1) };
  } catch {
    return null;
  }
}

export async function saveSession(s: Session): Promise<void> {
  // Same-process ordering matters: an older async rename must not beat quit's final snapshot.
  saveSessionSync(s);
}

export function saveSessionSync(s: Session): void {
  try {
    // Other TUI processes may update the latest-workspace pointer, but cannot overwrite this draft.
    if(s.files.some(file=>file.content!==undefined)){
      mkdirSync(RECOVERY_DIR,{recursive:true,mode:0o700});
      writeFileAtomicSync(RECOVERY_PATH,JSON.stringify(s)+'\n');
    }else{try{unlinkSync(RECOVERY_PATH);}catch{}}
    writeFileAtomicSync(SESSION_PATH, JSON.stringify(s) + "\n");
  } catch {
    // best effort
  }
}

export async function recoverySessions():Promise<Array<{id:string;session:Session}>>{
  let files:string[];try{files=readdirSync(RECOVERY_DIR);}catch{return [];}
  const found:Array<{id:string;session:Session}>=[];
  for(const file of files.filter(name=>/^\d+-[a-f0-9-]{36}\.json$/.test(name))){
    const session=await readSession(join(RECOVERY_DIR,file));if(session)found.push({id:file.slice(0,-5),session});
  }
  return found;
}
