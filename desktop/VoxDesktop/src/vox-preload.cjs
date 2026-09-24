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
  savePhoneRelayPassphrase: (passphrase) =>
    ipcRenderer.invoke(
      "vox-phone:save-relay-passphrase",
      typeof passphrase === "string" ? passphrase.slice(0, 500) : "",
    ),
  removePhoneRelayPassphrase: () =>
    ipcRenderer.invoke("vox-phone:remove-relay-passphrase"),
  getRemotePairingStatus: () => ipcRenderer.invoke("vox-remote:status"),
  createRemotePairing: () => ipcRenderer.invoke("vox-remote:create-pairing"),
  armRemoteControl: () => ipcRenderer.invoke("vox-remote:arm"),
  disarmRemoteControl: () => ipcRenderer.invoke("vox-remote:disarm"),
  revokeRemotePairing: () => ipcRenderer.invoke("vox-remote:revoke"),
  getSmartHomeStatus: () => ipcRenderer.invoke("vox-smart-home:status"),
  discoverSmartHomeDevices: (adapter) =>
    ipcRenderer.invoke("vox-smart-home:discover", typeof adapter === "string" ? adapter.slice(0, 80) : ""),
  saveSmartHomeDevice: (device) =>
    ipcRenderer.invoke("vox-smart-home:save-device", {
      adapter: typeof device?.adapter === "string" ? device.adapter.slice(0, 80) : "",
      method: device?.method === "sticker" ? "sticker" : "manual",
      name: typeof device?.name === "string" ? device.name.slice(0, 80) : "",
      host: typeof device?.host === "string" ? device.host.slice(0, 253) : "",
      wifiSsid: typeof device?.wifiSsid === "string" ? device.wifiSsid.slice(0, 100) : "",
      wifiPassword: typeof device?.wifiPassword === "string" ? device.wifiPassword.slice(0, 100) : "",
      serial: typeof device?.serial === "string" ? device.serial.slice(0, 40) : "",
      productType: typeof device?.productType === "string" ? device.productType.slice(0, 8) : "",
      credential: typeof device?.credential === "string" ? device.credential.slice(0, 512) : "",
    }),
  removeSmartHomeDevice: (deviceId) =>
    ipcRenderer.invoke("vox-smart-home:remove-device", typeof deviceId === "string" ? deviceId.slice(0, 100) : ""),
  runSmartHomeCommand: (request) =>
    ipcRenderer.invoke("vox-smart-home:command", {
      deviceId: typeof request?.deviceId === "string" ? request.deviceId.slice(0, 100) : "",
      prompt: typeof request?.prompt === "string" ? request.prompt.slice(0, 4_000) : "",
    }),
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
