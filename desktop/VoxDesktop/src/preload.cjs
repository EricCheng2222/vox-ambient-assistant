// Electron's sandboxed CommonJS preload exposes only its restricted built-in require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

const codexEventChannel = "vox-codex:event";
const codexPanelOpenChannel = "vox-codex:panel-open";

contextBridge.exposeInMainWorld("voxDesktop", {
  version: 1,
  setCodexPanelOpen: (open) => ipcRenderer.invoke("vox-codex:set-panel-open", Boolean(open)),
  getCodexStatus: () => ipcRenderer.invoke("vox-codex:status"),
  chooseCodexWorkspace: () => ipcRenderer.invoke("vox-codex:choose-workspace"),
  runCodex: (request) => ipcRenderer.invoke("vox-codex:run", request),
  cancelCodex: (taskId) => ipcRenderer.invoke("vox-codex:cancel", { taskId }),
  onCodexPanelOpen: (listener) => {
    if (typeof listener !== "function") return () => {};
    const wrapped = (_event, open) => listener(Boolean(open));
    ipcRenderer.on(codexPanelOpenChannel, wrapped);
    return () => ipcRenderer.removeListener(codexPanelOpenChannel, wrapped);
  },
  onCodexEvent: (listener) => {
    if (typeof listener !== "function") return () => {};
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(codexEventChannel, wrapped);
    return () => ipcRenderer.removeListener(codexEventChannel, wrapped);
  },
});
