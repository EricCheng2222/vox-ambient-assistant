// Electron's sandboxed CommonJS preload exposes only its restricted built-in require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voxLocalCodex", {
  available: true,
  getConnectionStatus: () => ipcRenderer.invoke("vox-connection:status"),
  setConnectionMode: (mode) => ipcRenderer.invoke("vox-connection:set-mode", mode),
  savePersonalKeys: (keys) => ipcRenderer.invoke("vox-connection:save-personal-keys", {
    openAIKey: typeof keys?.openAIKey === "string" ? keys.openAIKey : "",
    typeSafeKey: typeof keys?.typeSafeKey === "string" ? keys.typeSafeKey : "",
  }),
  removePersonalKeys: () => ipcRenderer.invoke("vox-connection:remove-personal-keys"),
  createPersonalRealtimeToken: (request) =>
    ipcRenderer.invoke("vox-connection:realtime-token", {
      voice: typeof request?.voice === "string" ? request.voice : "marin",
      instructions: typeof request?.instructions === "string" ? request.instructions : "",
      mandarinTranscription: request?.mandarinTranscription === true,
    }),
  routePersonalTurn: (request) => ipcRenderer.invoke("vox-connection:personal-route", request),
  decidePersonalPresence: (request) =>
    ipcRenderer.invoke("vox-connection:personal-presence", request),
  resolveApp: (text) => ipcRenderer.invoke("vox-desktop:resolve-app", typeof text === "string" ? text.slice(0, 12000) : ""),
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
