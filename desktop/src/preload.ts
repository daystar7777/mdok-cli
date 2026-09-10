import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("mdok", {
  onData: (cb: (data: string) => void) => ipcRenderer.on("pty-data", (_e, d: string) => cb(d)),
  ready: () => ipcRenderer.send("pty-ready"),
  input: (data: string) => ipcRenderer.send("pty-input", data),
  resize: (cols: number, rows: number) => ipcRenderer.send("pty-resize", { cols, rows }),
  onMenuOpen: (cb: () => void) => ipcRenderer.on("menu-open", () => cb()),
  openPicked: (file: string) => ipcRenderer.send("menu-open-picked", file),
});
