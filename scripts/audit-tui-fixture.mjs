// Isolated real-TUI fixture for scripts/audit-tui.py. Never reads user settings.
import os from "node:os";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
const dir = await fs.mkdtemp(join(os.tmpdir(), "mdok-ui-audit-"));
const mode = process.argv[2] ?? "plain";
if (mode === "slow-save") {
  const rename = fs.rename;
  fs.rename = async (...args) => { await new Promise(resolve => setTimeout(resolve,400)); return rename(...args); };
}
os.homedir = () => dir;
syncBuiltinESMExports();
process.chdir(dir);
const a = mode === 'math' ? '# Math\n\n$$x^2$$\n\nInline $y$.\n\n`$code$`' : mode === 'math-bad' ? '$$\\badcmd{x}$$\n\n\\[x' : mode === 'compare-long' ? Array.from({length:100},(_,i)=>`old line ${i}`).join('\n') : mode === "zwj" ? "👩‍💻ABC" : mode === "nfd" ? "한".normalize("NFD") + "ABC" : mode === "emoji" ? "😀ABC" : mode === "format" ? "TRAIL \n\n\nEND" : mode === "table" ? "|a|b|\n|---|---|\n|c|d|" : Array.from({length:60},(_,i)=>`ALPHA line ${i+1}`).join("\n");
const b = mode === 'compare-long' ? Array.from({length:100},(_,i)=>`new line ${i}`).join('\n') : "BRAVO document";
const pathA = join(dir,"a.md"), pathB = join(dir,"b.md");
await fs.writeFile(pathA,a); await fs.writeFile(pathB,b);
if(mode==='explorer'){
  await fs.mkdir(join(dir,'folder'));await fs.writeFile(join(dir,'folder','child.md'),'CHILD document');
  await fs.writeFile(join(dir,'.hidden.md'),'hidden');await fs.writeFile(join(dir,'binary.bin'),Buffer.from([0,255]));
  for(let i=0;i<45;i++)await fs.writeFile(join(dir,`doc-${String(i).padStart(2,'0')}.md`),`DOC ${i}`);
}
if (process.env.MDOK_AUDIT_LANG) await fs.writeFile(join(dir,".mdok.json"),JSON.stringify({lang:process.env.MDOK_AUDIT_LANG,gitSync:false}));
try {
  const {runTui} = await import("../dist/tui.js");
  const initialTabs = mode === "two" || mode === "slow-save" ? [{path:pathA,content:a},{path:pathB,content:b}] : [{path:pathA,content:a}];
  if(mode==='many')for(let i=2;i<=10;i++){
    const path=join(dir,`아주 긴 문서 이름 👩‍💻 ${i}.md`),content=`DOCUMENT_${i}_ONLY`;
    await fs.writeFile(path,content);initialTabs.push({path,content});
  }
  await runTui(initialTabs,0);
  const session = JSON.parse(await fs.readFile(join(dir,".mdok-session.json"),"utf8"));
  const saved = Object.fromEntries(await Promise.all((await fs.readdir(dir)).filter(name=>name.endsWith(".md")).map(async name=>[name,await fs.readFile(join(dir,name),"utf8")])));
  const language=await fs.readFile(join(dir,".mdok.json"),"utf8").then(raw=>JSON.parse(raw).lang).catch(()=>null);
  process.stdout.write("\nAUDIT_RESULT="+JSON.stringify({a:await fs.readFile(pathA,"utf8"),b:await fs.readFile(pathB,"utf8"),session,saved,language,html:await fs.readFile(join(dir,"a.html"),"utf8").catch(()=>null)})+"\n");
} finally { await fs.rm(dir,{recursive:true,force:true}); }
