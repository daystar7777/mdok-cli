import { app, BrowserWindow, Menu, shell } from "electron";
import * as path from "node:path";
import * as pty from "node-pty";

let win: BrowserWindow | null = null;
let ptyProc: pty.IPty | null = null;

// File to open: CLI arg, macOS open-file event, or empty (session resume).
let pendingFile: string | null = null;
for (const arg of process.argv.slice(app.isPackaged ? 1 : 2)) {
  if (!arg.startsWith("-") && arg.endsWith(".md")) {
    pendingFile = arg;
    break;
  }
}
app.on("open-file", (e, filePath) => {
  e.preventDefault();
  if (filePath.endsWith(".md")) {
    if (win && ptyProc) openInCli(filePath);
    else pendingFile = filePath;
  }
});

function mdokEntry(): { cmd: string; args: string[]; cwd: string; env?: Record<string, string> } {
  if (!app.isPackaged) {
    // Dev: run the repo CLI on Electron's Node (ELECTRON_RUN_AS_NODE).
    const entry = path.join(__dirname, "..", "..", "dist", "index.js");
    return { cmd: process.execPath, args: [entry], cwd: process.cwd(), env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  // Prod: standalone Bun-built binary shipped in extraResources (no Node needed).
  const bin = path.join(process.resourcesPath, "bin", process.platform === "win32" ? "mdok-bin.exe" : "mdok-bin");
  return { cmd: bin, args: [], cwd: process.cwd() };
}

function openInCli(file: string) {
  // Simplest robust behavior for v1: restart the CLI on the new file.
  // (Tabs/session make in-place open unnecessary for now.)
  if (!win || !ptyProc) {
    pendingFile = file;
    return;
  }
  spawnCli([file]);
}

function spawnCli(extraArgs: string[] = []) {
  if (ptyProc) {
    try {
      ptyProc.kill();
    } catch {
      // already dead
    }
    ptyProc = null;
  }
  const { cmd, args, cwd, env } = mdokEntry();
  const file = pendingFile;
  pendingFile = null;
  ptyProc = pty.spawn(cmd, [...args, ...(file ? [file] : []), ...extraArgs], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: "xterm-256color", MDOK_DESKTOP: "1", ...(env ?? {}) } as Record<string, string>,
  });
  ptyProc.onData((data) => win?.webContents.send("pty-data", data));
  ptyProc.onExit(() => {
    // CLI quit (Ctrl+Q twice) closes the window, like closing the app.
    if (win && !win.isDestroyed()) win.close();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 640,
    minHeight: 420,
    title: "mdok",
    backgroundColor: "#1a1b26",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("closed", () => {
    win = null;
    try {
      ptyProc?.kill();
    } catch {
      // already dead
    }
    ptyProc = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "mdok",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "quit", accelerator: "CmdOrCtrl+Q" },
        ],
      },
      {
        label: "File",
        submenu: [
          {
            label: "Open Markdown…",
            accelerator: "CmdOrCtrl+O",
            click: () => win?.webContents.send("menu-open"),
          },
          { type: "separator" },
          { role: "close" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Renderer → main plumbing.
import { ipcMain } from "electron";
ipcMain.on("pty-ready", () => spawnCli());
ipcMain.on("pty-input", (_e, data: string) => ptyProc?.write(data));
ipcMain.on("pty-resize", (_e, size: { cols: number; rows: number }) => {
  try {
    ptyProc?.resize(Math.max(20, size.cols), Math.max(5, size.rows));
  } catch {
    // not yet spawned
  }
});
ipcMain.on("menu-open-picked", (_e, file: string) => openInCli(file));
