// Electron's sandboxed CommonJS preload exposes only its restricted built-in require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voxLocalCodex", {
  available: true,
  runTask: (request) =>
    ipcRenderer.invoke("vox-codex:voice-run", {
      prompt: typeof request?.prompt === "string" ? request.prompt : "",
    }),
  openWorkspace: () => ipcRenderer.invoke("vox-desktop:open-workspace"),
  runDesktopControl: (request) =>
    ipcRenderer.invoke("vox-desktop:control", {
      prompt: typeof request?.prompt === "string" ? request.prompt : "",
      appId: typeof request?.appId === "string" ? request.appId : "",
      intent: request?.intent === "interact" ? "interact" : "launch",
      mode: request?.mode === "fast" ? "fast" : "standard",
    }),
});
