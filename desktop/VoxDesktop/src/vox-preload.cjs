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
  // Background noise and music removal, and "only listen to my voice".
  voiceFilter: {
    status: () => ipcRenderer.invoke("vox-voice-filter:status"),
    update: (changes) =>
      ipcRenderer.invoke("vox-voice-filter:update", {
        ...(typeof changes?.denoise === "boolean" ? { denoise: changes.denoise } : {}),
        ...(typeof changes?.onlyMyVoice === "boolean" ? { onlyMyVoice: changes.onlyMyVoice } : {}),
        ...(typeof changes?.strictness === "string" ? { strictness: changes.strictness.slice(0, 20) } : {}),
      }),
    finishEnrollment: () => ipcRenderer.invoke("vox-voice-filter:enroll-finish"),
    cancelEnrollment: () => ipcRenderer.invoke("vox-voice-filter:enroll-cancel"),
    forget: () => ipcRenderer.invoke("vox-voice-filter:forget"),
  },
  // Websites the user signed in to in the built-in browser: yes or no per site, and signing out.
  accounts: {
    status: (checks) => ipcRenderer.invoke("vox-accounts:status", Array.isArray(checks) ? checks.slice(0, 80) : []),
    signOut: (domains) => ipcRenderer.invoke("vox-accounts:sign-out", Array.isArray(domains) ? domains.slice(0, 4) : []),
  },
  // Pages the user asked Vox to keep an eye on, read from the built-in browser's profile.
  watch: {
    read: (url) => ipcRenderer.invoke("vox-watch:read", typeof url === "string" ? url.slice(0, 2_000) : ""),
    close: (url) => ipcRenderer.invoke("vox-watch:close", typeof url === "string" ? url.slice(0, 2_000) : ""),
  },
  // The stage's built-in browser: a real web page shown inside Vox.
  browser: {
    open: (url) => ipcRenderer.invoke("vox-browser:open", typeof url === "string" ? url.slice(0, 4_000) : ""),
    layout: (visible, bounds) =>
      ipcRenderer.invoke("vox-browser:layout", {
        visible: visible === true,
        bounds: {
          x: Number(bounds?.x) || 0,
          y: Number(bounds?.y) || 0,
          width: Number(bounds?.width) || 0,
          height: Number(bounds?.height) || 0,
        },
      }),
    command: (action) =>
      ipcRenderer.invoke("vox-browser:command", ["back", "forward", "reload", "stop", "external"].includes(action) ? action : ""),
    read: () => ipcRenderer.invoke("vox-browser:read"),
    // Acting on the page for the user: a numbered look, then one action at a time.
    look: () => ipcRenderer.invoke("vox-browser:look"),
    act: (request) =>
      ipcRenderer.invoke("vox-browser:act", {
        action: typeof request?.action === "string" ? request.action.slice(0, 20) : "",
        ref: Number.isInteger(request?.ref) ? request.ref : -1,
        text: typeof request?.text === "string" ? request.text.slice(0, 500) : "",
      }),
    onState: (listener) => {
      if (typeof listener !== "function") return () => undefined;
      const handler = (_event, state) => listener(state ?? null);
      ipcRenderer.on("vox-browser:state", handler);
      return () => ipcRenderer.removeListener("vox-browser:state", handler);
    },
  },
  // "Welcome home" greeting when the paired iPhone comes near.
  welcomeHome: {
    status: () => ipcRenderer.invoke("vox-welcome-home:status"),
    update: (changes) =>
      ipcRenderer.invoke("vox-welcome-home:update", {
        ...(typeof changes?.enabled === "boolean" ? { enabled: changes.enabled } : {}),
        ...(typeof changes?.sound === "string" ? { sound: changes.sound.slice(0, 40) } : {}),
      }),
    test: (sound) => ipcRenderer.invoke("vox-welcome-home:test", typeof sound === "string" ? sound.slice(0, 40) : undefined),
  },
});

// Audio ports can't cross the context bridge, so the page posts one here and
// it's handed to the main process, which connects it to the voice filter.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== "vox-voice-filter:connect") return;
  const [port] = event.ports;
  if (!port) return;
  const kind = event.data.kind === "enroll" ? "enroll" : "session";
  ipcRenderer.postMessage("vox-voice-filter:connect", kind, [port]);
});
