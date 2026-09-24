import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
  WebContentsView,
} from "electron";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Codex } from "@openai/codex-sdk";
import { runComputerUseSession } from "./computer-use-session.mjs";
import { installedApps, matchInstalledApp } from "./installed-apps.mjs";
import {
  inferPhoneDesktopApp,
  isPhoneDesktopAction,
  isPhoneSmartHomeRequest,
  isPhoneWorkspaceRequest,
  phoneDesktopIntent,
} from "./phone-mac-route.mjs";
import {
  createPersonalRealtimeSecret,
  validOpenAIKey,
} from "./personal-api.mjs";
import {
  createPersonalPresence,
  createPersonalRoute,
  validTypeSafeKey,
} from "./personal-route.mjs";
import { startLocalVoxServer } from "./local-web-server.mjs";
import {
  availableSmartHomeAdapters,
  configureSmartHomeDevice,
  discoverSmartHomeDevices,
  publicSmartHomeDevice,
  runSmartHomeCommand,
} from "./smart-home-hub.mjs";
import {
  approvedDesktopApp,
  currentDesktopActionText,
  hasRunningDesktopApp,
  isBlockedDesktopControlPrompt,
  isClosingDesktopApp,
  isDraftOnlyDesktopControlPrompt,
} from "./desktop-control-policy.mjs";
import {
  decryptRemoteCommand,
  encryptRemoteResult,
  verifyPairingClaim,
} from "./remote-control.mjs";

const productionUrl = "https://vox-assistant.ericcheng306.workers.dev/";
const developmentUrl = process.env.VOX_DESKTOP_DEV_URL;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const shellFile = path.join(currentDirectory, "shell.html");
const shellUrl = pathToFileURL(shellFile).href;
const settingsFileName = "desktop-settings.json";
const desktopSessionHeader = {
  name: "x-vox-desktop-session",
  value: randomBytes(32).toString("base64url"),
};
const toolbarHeight = 44;
const drawerWidth = 420;
const maximumPromptLength = 12_000;
const execFileAsync = promisify(execFile);
const computerUseUnavailablePattern =
  /(?:Sky Computer Use native pipe startup failed|computer[- ]control access wasn'?t approved|computer use.+(?:unavailable|not connected)|cua_repl.+failed)/iu;

let mainWindow = null;
let voxView = null;
let localVoxServer = null;
let activeVoxOrigin = "";
let activeConnectionMode = null;
let panelOpen = false;
let activeTask = null;
let taskLaunchPending = false;
let lastWorkspaceOpenAt = 0;
let lastDesktopControlAt = 0;
let lastSmartHomeCommandAt = 0;
let remoteRelayTimer = null;
let remoteRelayInFlight = false;
let lastRemoteHeartbeatAt = 0;
let lastRemoteDesktopAppId = "";
let lastRemoteDesktopAppAt = 0;
// Deliberately memory-only: relaunching Vox always returns remote control to a
// safe, disarmed state even when the phone remains paired.
let remoteControlArmed = false;

function remoteControlArmStatus() {
  return { armed: remoteControlArmed };
}

function isTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  return event.senderFrame === event.senderFrame.top && event.senderFrame.url === shellUrl;
}

function requireTrustedSender(event) {
  if (!isTrustedSender(event)) {
    throw new Error("This request did not come from the bundled Vox Desktop interface.");
  }
}

function isTrustedVoxSender(event) {
  if (!voxView || event.sender !== voxView.webContents) return false;
  const frame = event.senderFrame;
  const trustedOrigins = [
    localVoxServer?.origin,
    !app.isPackaged && developmentUrl ? new URL(developmentUrl).origin : null,
  ].filter(Boolean);
  return Boolean(
    frame &&
      frame === frame.top &&
      trustedOrigins.includes(normalizeOrigin(frame.url)),
  );
}

function requireTrustedVoxSender(event) {
  if (!isTrustedVoxSender(event)) {
    throw new Error("This request did not come from the trusted Vox conversation.");
  }
}

function settingsPath() {
  return path.join(app.getPath("userData"), settingsFileName);
}

async function readSettings() {
  try {
    const contents = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(contents);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function saveSettings(settings) {
  await mkdir(path.dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function connectionMode(value) {
  return value === "cloud" || value === "personal" ? value : null;
}

function secureStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

function localWebRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "vox-web")
    : path.resolve(currentDirectory, "..", "..", "..", "dist");
}

async function loadConnectionSurface(mode) {
  if (!voxView || voxView.webContents.isDestroyed()) return;
  activeConnectionMode = connectionMode(mode);
  const target = !app.isPackaged && developmentUrl ? developmentUrl : localVoxServer.url;
  activeVoxOrigin = new URL(target).origin;
  await voxView.webContents.loadURL(target);
}

function encryptedSettingConfigured(settings, name) {
  return typeof settings[name] === "string" && settings[name].length > 0;
}

function personalKeysStatus(settings) {
  const openAIKeyConfigured = encryptedSettingConfigured(settings, "personalOpenAIKey") ||
    encryptedSettingConfigured(settings, "personalApiKey");
  const typeSafeKeyConfigured = encryptedSettingConfigured(settings, "personalTypeSafeKey");
  return {
    openAIKeyConfigured,
    typeSafeKeyConfigured,
    personalKeyConfigured: openAIKeyConfigured && typeSafeKeyConfigured,
  };
}

function readEncryptedSetting(settings, name, label, legacyName) {
  const encrypted = settings[name] ?? (legacyName ? settings[legacyName] : undefined);
  if (typeof encrypted !== "string" || !encrypted) throw new Error(`Add your ${label} first.`);
  if (!secureStorageAvailable()) {
    throw new Error("Secure system storage is unavailable on this computer.");
  }
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    throw new Error(`The saved ${label} could not be unlocked. Replace it and try again.`);
  }
}

function normalizedPhoneRelayPassphrase(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function derivedPhoneRelaySecret(passphrase) {
  const normalized = normalizedPhoneRelayPassphrase(passphrase);
  if (normalized.length < 12 || normalized.length > 160) {
    throw new Error("Use the same private sentence configured for phone access.");
  }
  return createHash("sha256").update(normalized, "utf8").digest("base64url");
}

function unlockedPhoneRelaySecret(settings) {
  try {
    return readEncryptedSetting(settings, "phoneRelaySecret", "phone-to-Mac key");
  } catch {
    return null;
  }
}

function unlockedRemotePairing(settings) {
  const pairing = settings.remoteMacPairing;
  if (!pairing || typeof pairing !== "object") return null;
  if (
    typeof pairing.deviceId !== "string" ||
    typeof pairing.encryptedSecret !== "string" ||
    !pairing.deviceId ||
    !pairing.encryptedSecret
  ) return null;
  if (!secureStorageAvailable()) return null;
  try {
    return {
      deviceId: pairing.deviceId,
      name: typeof pairing.name === "string" ? pairing.name : "This Mac",
      status: typeof pairing.status === "string" ? pairing.status : "pending",
      secret: safeStorage.decryptString(Buffer.from(pairing.encryptedSecret, "base64")),
    };
  } catch {
    return null;
  }
}

function remotePairingUrl(pairing) {
  const pairingUrl = new URL(productionUrl);
  pairingUrl.searchParams.set("pair", pairing.deviceId);
  pairingUrl.hash = `vox-pair=${pairing.secret}`;
  return pairingUrl.href;
}

async function cloudJson(pathname, init = {}) {
  if (!localVoxServer) throw new Error("The local Vox service is not ready.");
  const response = await session.defaultSession.fetch(new URL(pathname, localVoxServer.url).href, {
    ...init,
    credentials: "include",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      [desktopSessionHeader.name]: desktopSessionHeader.value,
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Vox Cloud is unavailable.");
  }
  return payload;
}

function savedSmartHomeDevices(settings) {
  return Array.isArray(settings.smartHomeDevices)
    ? settings.smartHomeDevices.filter((device) => device && typeof device === "object")
    : [];
}

function publicSavedSmartHomeDevices(settings) {
  return savedSmartHomeDevices(settings)
    .map((device) => {
      try {
        const publicDevice = publicSmartHomeDevice(unlockSmartHomeDevice(settings, device.id));
        return publicDevice ? { id: device.id, ...publicDevice } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function unlockSmartHomeDevice(settings, id) {
  const device = savedSmartHomeDevices(settings).find((candidate) => candidate.id === id);
  if (!device) throw new Error("Choose a configured smart-home device first.");
  if (!secureStorageAvailable()) {
    throw new Error("Secure system storage is unavailable on this computer.");
  }
  try {
    if (typeof device.encryptedConfiguration === "string" && device.encryptedConfiguration) {
      const decrypted = safeStorage.decryptString(Buffer.from(device.encryptedConfiguration, "base64"));
      const configuration = JSON.parse(decrypted);
      const unlocked = { ...device, ...configuration };
      if (!publicSmartHomeDevice(unlocked) || typeof unlocked.credential !== "string") {
        throw new Error("Invalid encrypted device configuration.");
      }
      return unlocked;
    }
    if (typeof device.encryptedCredential === "string" && device.encryptedCredential) {
      const credential = safeStorage.decryptString(Buffer.from(device.encryptedCredential, "base64"));
      return { ...device, credential };
    }
    throw new Error("Missing encrypted device configuration.");
  } catch {
    throw new Error("The saved device connection could not be unlocked. Configure this device again.");
  }
}

async function validateWorkspace(workspace) {
  if (typeof workspace !== "string" || !path.isAbsolute(workspace)) {
    throw new Error("Choose a local project folder first.");
  }
  const details = await stat(workspace);
  if (!details.isDirectory()) throw new Error("The selected workspace is not a folder.");
  return path.resolve(workspace);
}

function truncate(value, length = 2_000) {
  const text = typeof value === "string" ? value : "";
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}

function redactSensitiveOutput(value) {
  return value
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/giu, "[private key redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/gu, "[API key redacted]")
    .replace(/\bapikey_[A-Za-z0-9_-]{20,}\b/gu, "[API key redacted]")
    .replace(/\b(api[ _-]?key|access[ _-]?token|password|secret)\s*[:=]\s*\S+/giu, "$1: [redacted]");
}

function usesTaiwanMandarin(value) {
  return /[\u3400-\u9fff]/u.test(typeof value === "string" ? value : "");
}

function computerUseSetupMessage(prompt) {
  return usesTaiwanMandarin(prompt)
    ? "Vox 無法連接本機的 Computer Use 服務，所以沒有完成操作。這是連線錯誤，不代表你尚未授予 macOS 權限。"
    : "Vox could not connect to the local Computer Use service, so the action was not completed. This is a connection error, not evidence of missing macOS permissions.";
}

async function computerUseCodexPath() {
  // Native Computer Use must use the runtime paired with the installed desktop app.
  // A separately bundled CLI may not be compatible with its native transport.
  for (const appDirectory of ["/Applications/ChatGPT.app", "/Applications/Codex.app"]) {
    const candidate = path.join(appDirectory, "Contents", "Resources", "codex");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the other supported desktop app installation.
    }
  }
  throw new Error("Install the ChatGPT/Codex desktop app to use its local Computer Use runtime.");
}

async function launchApprovedDesktopApp(appPolicy) {
  if (process.platform !== "darwin") {
    throw new Error("Approved app launching is currently available on macOS only.");
  }
  try {
    await execFileAsync("/usr/bin/open", appPolicy.path ? ["-a", appPolicy.path] : ["-b", appPolicy.bundleId]);
  } catch {
    throw new Error(`${appPolicy.name} is not installed or could not be opened.`);
  }
}

async function isDesktopAppRunning(bundleId) {
  if (process.platform !== "darwin") return false;
  try {
    const { stdout } = await execFileAsync("/usr/bin/lsappinfo", ["find", `bundleID=${bundleId}`]);
    return hasRunningDesktopApp(stdout);
  } catch {
    return false;
  }
}

async function frontmostInstalledDesktopApp(apps) {
  try {
    const { stdout } = await execFileAsync("/usr/bin/lsappinfo", [], {
      timeout: 3_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const bundleId = stdout.match(
      /^\s*\d+\).*?\(in front\)\s*\n\s*bundleID="([^"]+)"/mu,
    )?.[1];
    if (!bundleId || bundleId === "com.ericcheng.vox.desktop") return null;
    return apps.find((candidate) => candidate.bundleId === bundleId) ?? null;
  } catch {
    return null;
  }
}

async function computerControlWorkingDirectory() {
  const directory = path.join(app.getPath("userData"), "computer-control-session");
  await mkdir(directory, { recursive: true });
  return directory;
}

function sendCodexEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("vox-codex:event", payload);
}

function packagedCodexPath() {
  if (!app.isPackaged) return undefined;
  const platformKey = `${process.platform}-${process.arch}`;
  const platforms = {
    "darwin-arm64": ["codex-darwin-arm64", "aarch64-apple-darwin", "codex"],
    "darwin-x64": ["codex-darwin-x64", "x86_64-apple-darwin", "codex"],
    "linux-arm64": ["codex-linux-arm64", "aarch64-unknown-linux-musl", "codex"],
    "linux-x64": ["codex-linux-x64", "x86_64-unknown-linux-musl", "codex"],
    "win32-arm64": ["codex-win32-arm64", "aarch64-pc-windows-msvc", "codex.exe"],
    "win32-x64": ["codex-win32-x64", "x86_64-pc-windows-msvc", "codex.exe"],
  };
  const target = platforms[platformKey];
  if (!target) throw new Error(`Vox Desktop does not support ${platformKey} yet.`);
  return path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    target[0],
    "vendor",
    target[1],
    "bin",
    target[2],
  );
}

function summarizeThreadItem(item) {
  switch (item.type) {
    case "agent_message":
      return { kind: "message", text: truncate(item.text, 8_000) };
    case "reasoning":
      return { kind: "status", text: truncate(item.text, 1_000) };
    case "command_execution":
      return {
        kind: "command",
        command: truncate(item.command, 500),
        output: truncate(item.aggregated_output),
        status: item.status,
        exitCode: item.exit_code ?? null,
      };
    case "file_change":
      return {
        kind: "files",
        status: item.status,
        changes: item.changes.slice(0, 100).map((change) => ({
          path: truncate(change.path, 500),
          kind: change.kind,
        })),
      };
    case "mcp_tool_call":
      return { kind: "tool", text: `${item.server}: ${item.tool}`, status: item.status };
    case "web_search":
      return { kind: "tool", text: `Web search: ${truncate(item.query, 500)}` };
    case "todo_list":
      return {
        kind: "status",
        text: item.items.map((todo) => `${todo.completed ? "✓" : "○"} ${todo.text}`).join("\n"),
      };
    case "error":
      return { kind: "error", text: truncate(item.message) };
    default:
      return null;
  }
}

async function runCodexTask(taskId, request) {
  const abortController = new AbortController();
  activeTask = { id: taskId, abortController };
  const canEdit = request.access === "workspace-write";

  try {
    const codex = new Codex({
      codexPathOverride: request.computerControl
        ? await computerUseCodexPath()
        : packagedCodexPath(),
    });
    const thread = codex.startThread({
      workingDirectory: request.workspace,
      skipGitRepoCheck: true,
      sandboxMode: canEdit ? "workspace-write" : "read-only",
      approvalPolicy: request.computerControl ? "on-request" : "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      modelReasoningEffort: "medium",
      threadSource: "vox-desktop",
    });
    const prompt = request.computerControl
      ? [
          `Use Computer Use only in ${request.targetAppName} to perform the user's explicitly confirmed task.`,
          "The user's single spoken confirmation authorizes the entire described task. Do not request a second Vox or Electron confirmation for ordinary clicks, typing, scrolling, tab management, navigation, or search within the named app.",
          "This is a tightly restricted desktop task. You may focus the named app, inspect its visible interface, click, select, scroll, type, create or switch browser tabs, navigate to a public website, and perform a public web search when the user explicitly requested it. Browser navigation through the approved app is allowed even though Codex's own HTTP and web-search tools are disabled.",
          "Do not delete or modify local files or system settings. Do not purchase, log in, enter credentials, submit account-affecting forms, install, uninstall, download, use Terminal, or run shell commands. Stop and explain if any of those actions would be required.",
          request.computerControlAction === "draft_message"
            ? "This is a draft-only communication task. You may click into the visible message or email composer and type exactly the requested text as a single-line draft. Never activate Send, Post, Publish, Share, Upload, Submit, or any equivalent control. Never press Return or Enter, and never use a keyboard shortcut that could transmit the draft. Once the text is visibly present in the composer, stop immediately and leave it unsent for the user to review. If and only if that happened, say that the draft is ready and was not sent; otherwise state that no draft was completed."
            : "Do not send, post, publish, share, upload, or submit any external communication or content.",
          "Do not use any app other than the named target. If Computer Use is unavailable or permission is denied, say so plainly and do not claim the task succeeded.",
          request.computerControlAction === "close_app"
            ? "This is a one-shot close-app task. Acquire the already-running target at most once and request a normal quit once. Never reacquire, reopen, refocus, or inspect the app after the quit action; Vox checks the running state separately and will end this session as soon as the app closes. Do not force quit or discard unsaved work. If a save/discard prompt appears, leave it untouched and report that user attention is needed."
            : "Closing a requested window is allowed. Do not force quit or discard unsaved work. Stop at any save/discard prompt and ask the user.",
          "Your final response will be spoken aloud by Vox. Use the same language as the user, keep it concise, and state only what actually happened.",
          `Confirmed user request:\n${request.prompt}`,
        ].join("\n\n")
      : request.voice
        ? [
          "Complete the user's task in the selected local project.",
          "Your final response will be spoken aloud by Vox. Write that final response in the same language as the user, keep it concise and natural for speech, and state the outcome rather than narrating your process.",
          "Never include secrets, access tokens, private keys, or large code blocks in the final response.",
          `User request:\n${request.prompt}`,
        ].join("\n\n")
        : request.prompt;
    if (request.computerControl) {
      const answer = await runComputerUseSession({
        executable: await computerUseCodexPath(),
        cwd: request.workspace,
        prompt,
        bundleId: request.targetBundleId,
        mode: request.computerUseMode,
        signal: abortController.signal,
        draftOnly: request.computerControlAction === "draft_message",
        completionCheck: request.computerControlAction === "close_app"
          ? async () => !(await isDesktopAppRunning(request.targetBundleId))
          : undefined,
        completionAnswer: request.computerControlAction === "close_app"
          ? (usesTaiwanMandarin(request.prompt)
              ? `已關閉「${request.targetAppName}」。`
              : `${request.targetAppName} has been closed.`)
          : "",
        onItem: (rawItem) => {
          const item = summarizeThreadItem(rawItem);
          if (item) sendCodexEvent({ taskId, type: "progress", item });
        },
      });
      if (!answer?.trim()) throw new Error("Local Computer Use returned no final response.");
      const finalResponse = redactSensitiveOutput(truncate(answer, 4_000));
      sendCodexEvent({ taskId, type: "completed", finalResponse });
      return { status: "completed", finalResponse };
    }
    const { events } = await thread.runStreamed(prompt, { signal: abortController.signal });
    let finalResponse = "";
    let computerUseUnavailable = false;
    let computerUseApprovalMissing = false;

    for await (const event of events) {
      if (event.type === "thread.started") {
        sendCodexEvent({ taskId, type: "thread", threadId: event.thread_id });
      } else if (event.type === "item.completed") {
        const item = summarizeThreadItem(event.item);
        if (event.item.type === "agent_message") finalResponse = event.item.text;
        if (request.computerControl && event.item.type === "mcp_tool_call") {
          // Some MCP failures are returned as successful transport calls with error text.
          const resultText = JSON.stringify(event.item.result ?? event.item.error ?? {});
          if (/Computer Use was not approved|computer.control access wasn.t approved/iu.test(resultText)) {
            computerUseApprovalMissing = true;
          }
          if (/native pipe startup failed|native pipe is unavailable/iu.test(resultText)) {
            computerUseUnavailable = true;
          }
        }
        if (
          request.computerControl &&
          event.item.type === "mcp_tool_call" &&
          event.item.status === "failed" &&
          computerUseUnavailablePattern.test(JSON.stringify(event.item))
        ) {
          computerUseUnavailable = true;
        }
        if (item) sendCodexEvent({ taskId, type: "progress", item });
      } else if (event.type === "turn.completed") {
        sendCodexEvent({ taskId, type: "usage", usage: event.usage });
      } else if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    if (request.computerControl && computerUseApprovalMissing) {
      const message = usesTaiwanMandarin(request.prompt)
        ? `本機 Computer Use 尚未獲准操作 ${request.targetAppName}。請在 ChatGPT／Codex 的「設定 → Computer Use」允許這個 App，再試一次。Vox 已收到你的口頭確認，但無法代替你批准平台權限。`
        : `Local Computer Use has not been approved for ${request.targetAppName}. Allow that app in ChatGPT/Codex Settings → Computer Use, then retry. Vox received your spoken confirmation, but cannot approve the platform permission on your behalf.`;
      sendCodexEvent({ taskId, type: "failed", message });
      return { status: "setup-required", message };
    }
    if (request.computerControl && computerUseUnavailable) {
      const message = computerUseSetupMessage(request.prompt);
      sendCodexEvent({ taskId, type: "failed", message });
      return { status: "setup-required", message };
    }
    const safeFinalResponse = truncate(finalResponse, 20_000);
    if (!safeFinalResponse.trim()) throw new Error("Local Codex returned no final response.");
    sendCodexEvent({ taskId, type: "completed", finalResponse: safeFinalResponse });
    return {
      status: "completed",
      finalResponse: request.voice
        ? redactSensitiveOutput(truncate(safeFinalResponse, 4_000))
        : safeFinalResponse,
    };
  } catch (error) {
    const cancelled = abortController.signal.aborted;
    const message = cancelled
      ? "Local Codex task cancelled."
      : truncate(error instanceof Error ? error.message : String(error));
    sendCodexEvent({
      taskId,
      type: cancelled ? "cancelled" : "failed",
      message,
    });
    return { status: cancelled ? "cancelled" : "failed", message };
  } finally {
    if (activeTask?.id === taskId) activeTask = null;
  }
}

function openCodexPanel() {
  panelOpen = true;
  layoutVoxView();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("vox-codex:panel-open", true);
  }
}

async function chooseWorkspace(title = "Choose a folder for local Codex") {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    buttonLabel: "Use this folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const workspace = await validateWorkspace(result.filePaths[0]);
  const settings = await readSettings();
  await saveSettings({ ...settings, workspace });
  return workspace;
}

async function savedOrChosenWorkspace() {
  const settings = await readSettings();
  if (typeof settings.workspace === "string") {
    try {
      return await validateWorkspace(settings.workspace);
    } catch {
      // The folder may have moved or been removed. Ask for a current project below.
    }
  }
  return chooseWorkspace("Choose a project for this voice task");
}

async function performRemoteSmartHomeCommand(command) {
  const settings = await readSettings();
  const devices = savedSmartHomeDevices(settings);
  const prompt = typeof command.prompt === "string" ? command.prompt.trim().slice(0, 4_000) : "";
  const requestedId = typeof command.deviceId === "string" ? command.deviceId.slice(0, 100) : "";
  if (!prompt) throw new Error("The phone did not send a smart-home command.");
  const promptLower = prompt.toLocaleLowerCase();
  const namedDevice = devices.find((device) =>
    typeof device.name === "string" && promptLower.includes(device.name.toLocaleLowerCase()),
  );
  const selectedId = requestedId || namedDevice?.id || (devices.length === 1 ? devices[0].id : "");
  if (!selectedId) throw new Error("Choose a configured smart-home device on the Mac first.");
  const result = await runSmartHomeCommand(unlockSmartHomeDevice(settings, selectedId), prompt);
  return result?.answer ?? result?.status ?? "The smart-home command completed.";
}

async function performRemoteDesktopControl(command) {
  if (activeTask || taskLaunchPending) throw new Error("The Mac is already working on another local task.");
  const prompt = typeof command.prompt === "string" ? command.prompt.trim() : "";
  if (!prompt || prompt.length > maximumPromptLength) throw new Error("The remote desktop request is invalid.");
  const appPolicy = approvedDesktopApp(command.appId) ??
    (await installedApps()).find((candidate) => candidate.id === command.appId);
  if (!appPolicy) throw new Error("That app is not installed on the paired Mac.");
  const actionText = currentDesktopActionText(prompt);
  if (isBlockedDesktopControlPrompt(actionText)) {
    throw new Error("That remote action is restricted by the Mac's local policy.");
  }

  const closing = isClosingDesktopApp(actionText);
  const draftOnly = isDraftOnlyDesktopControlPrompt(actionText);
  const intent = closing || command.intent === "interact" ? "interact" : "launch";
  if (intent === "launch") {
    await launchApprovedDesktopApp(appPolicy);
    lastRemoteDesktopAppId = command.appId;
    lastRemoteDesktopAppAt = Date.now();
    return `Opened ${appPolicy.name} on the paired Mac.`;
  }

  taskLaunchPending = true;
  try {
    if (!closing) await launchApprovedDesktopApp(appPolicy);
    if (closing && !(await isDesktopAppRunning(appPolicy.bundleId))) {
      return `${appPolicy.name} is already closed.`;
    }
    const workspace = await computerControlWorkingDirectory();
    const result = await runCodexTask(randomUUID(), {
      prompt,
      workspace,
      access: "read-only",
      voice: true,
      computerControl: true,
      targetAppName: appPolicy.name,
      targetBundleId: appPolicy.bundleId,
      computerUseMode: closing || command.mode === "fast" ? "fast" : "standard",
      computerControlAction: closing
        ? "close_app"
        : draftOnly
          ? "draft_message"
          : "interact",
    });
    if (result.status === "completed") {
      lastRemoteDesktopAppId = command.appId;
      lastRemoteDesktopAppAt = Date.now();
      return result.finalResponse || "The remote action completed.";
    }
    if (result.status === "setup-required") return result.message;
    if (result.status === "cancelled") return "The action was cancelled on the Mac.";
    throw new Error(result.message || "The Mac did not complete the remote action.");
  } finally {
    taskLaunchPending = false;
  }
}

async function performPhoneMacRequest(command) {
  const prompt = typeof command.prompt === "string" ? command.prompt.trim() : "";
  if (!prompt || prompt.length > maximumPromptLength) {
    throw new Error("The phone request is invalid.");
  }
  if (isPhoneSmartHomeRequest(prompt)) {
    return performRemoteSmartHomeCommand({ kind: "smart_home", prompt });
  }
  if (isPhoneWorkspaceRequest(prompt)) {
    return performRemoteCommand({ kind: "open_workspace" });
  }

  const apps = await installedApps();
  const explicit = matchInstalledApp(prompt, apps);
  const explicitApp = explicit
    ? apps.find((candidate) => candidate.id === explicit.id) ?? null
    : null;
  const inferredApp = inferPhoneDesktopApp(prompt, apps);
  const frontmostApp = isPhoneDesktopAction(prompt)
    ? await frontmostInstalledDesktopApp(apps)
    : null;
  const recentApp = Date.now() - lastRemoteDesktopAppAt <= 30 * 60_000
    ? apps.find((candidate) => candidate.id === lastRemoteDesktopAppId) ?? null
    : null;
  const targetApp = explicitApp ?? inferredApp ?? recentApp ?? frontmostApp;

  if (targetApp && (isPhoneDesktopAction(prompt) || explicit?.appOnly)) {
    return performRemoteDesktopControl({
      kind: "desktop_control",
      prompt,
      appId: targetApp.id,
      intent: phoneDesktopIntent(prompt, explicit?.appOnly),
      mode: "fast",
    });
  }
  if (isPhoneDesktopAction(prompt)) {
    throw new Error(
      usesTaiwanMandarin(prompt)
        ? "我還無法確定要操作哪個 App。請說出 App 名稱，或先在 Mac 上把它切到最前面。"
        : "I could not determine which app to control. Name the app, or bring it to the front on the Mac first.",
    );
  }
  return performRemoteCodexTask({ kind: "local_codex", prompt });
}

async function performRemoteCodexTask(command) {
  if (activeTask || taskLaunchPending) throw new Error("The Mac is already working on another local task.");
  const prompt = typeof command.prompt === "string" ? command.prompt.trim() : "";
  if (!prompt || prompt.length > maximumPromptLength) throw new Error("The remote Codex request is invalid.");
  const workspace = await savedOrChosenWorkspace();
  if (!workspace) return "The Codex task was cancelled on the Mac.";
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Remote Codex request",
    message: "Allow the paired phone to run this local Codex task?",
    detail: `Folder: ${workspace}\n\nTask: ${truncate(prompt, 700)}\n\nRemote Codex tasks require confirmation on this Mac and start read-only.`,
    buttons: ["Run read-only", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (confirmation.response !== 0) return "The Codex task was declined on the Mac.";
  taskLaunchPending = true;
  try {
    const result = await runCodexTask(randomUUID(), {
      prompt,
      workspace,
      access: "read-only",
      voice: true,
    });
    if (result.status === "completed") return result.finalResponse || "The Codex task completed.";
    if (result.status === "cancelled") return "The Codex task was cancelled on the Mac.";
    throw new Error(result.message || "Local Codex could not complete the task.");
  } finally {
    taskLaunchPending = false;
  }
}

async function performRemoteCommand(command) {
  if (!command || typeof command !== "object") throw new Error("The remote command is invalid.");
  if (command.kind === "desktop_control") return performRemoteDesktopControl(command);
  if (command.kind === "smart_home") return performRemoteSmartHomeCommand(command);
  if (command.kind === "phone_mac") return performPhoneMacRequest(command);
  if (command.kind === "local_codex") return performRemoteCodexTask(command);
  if (command.kind === "open_workspace") {
    const settings = await readSettings();
    const workspace = await validateWorkspace(settings.workspace);
    const openError = await shell.openPath(workspace);
    if (openError) throw new Error(openError);
    return `Opened ${path.basename(workspace)} in Finder on the paired Mac.`;
  }
  throw new Error("That remote command type is not supported.");
}

async function processRemoteRelay() {
  if (remoteRelayInFlight || activeConnectionMode !== "cloud") return;
  remoteRelayInFlight = true;
  try {
    let settings = await readSettings();
    const pairing = unlockedRemotePairing(settings);
    if (!pairing) return;
    const state = await cloudJson(`/api/device-pairing?deviceId=${encodeURIComponent(pairing.deviceId)}`);
    const device = state.device;
    if (
      device?.status === "pending" &&
      typeof device.claimId === "string" &&
      typeof device.claimLabel === "string" &&
      typeof device.claimProof === "string" &&
      verifyPairingClaim(pairing.secret, {
        deviceId: pairing.deviceId,
        claimId: device.claimId,
        label: device.claimLabel,
        proof: device.claimProof,
      })
    ) {
      await cloudJson("/api/device-pairing", {
        method: "POST",
        body: JSON.stringify({ action: "activate", deviceId: pairing.deviceId }),
      });
      settings = await readSettings();
      await saveSettings({
        ...settings,
        remoteMacPairing: { ...settings.remoteMacPairing, status: "active", phoneLabel: device.claimLabel },
      });
    }
    if (device?.status !== "active" && pairing.status !== "active") return;
    if (Date.now() - lastRemoteHeartbeatAt >= 30_000) {
      await cloudJson("/api/device-pairing", {
        method: "POST",
        body: JSON.stringify({ action: "heartbeat", deviceId: pairing.deviceId }),
      });
      lastRemoteHeartbeatAt = Date.now();
    }

    const pending = await cloudJson(`/api/device-commands?deviceId=${encodeURIComponent(pairing.deviceId)}`);
    for (const envelope of Array.isArray(pending.commands) ? pending.commands : []) {
      settings = await readSettings();
      const processed = Array.isArray(settings.processedRemoteCommandIds)
        ? settings.processedRemoteCommandIds.filter((id) => typeof id === "string")
        : [];
      if (processed.includes(envelope.id)) continue;
      let result;
      let commandSecret = pairing.secret;
      try {
        let payload;
        try {
          payload = decryptRemoteCommand(pairing.secret, pairing.deviceId, envelope);
        } catch (pairingError) {
          const phoneSecret = unlockedPhoneRelaySecret(settings);
          if (!phoneSecret) throw pairingError;
          commandSecret = phoneSecret;
          payload = decryptRemoteCommand(phoneSecret, pairing.deviceId, envelope);
          if (payload.command.kind !== "phone_mac") {
            throw new Error("A phone-authenticated command may only use the phone-to-Mac route.");
          }
        }
        await saveSettings({
          ...settings,
          processedRemoteCommandIds: [...processed.slice(-99), envelope.id],
        });
        if (!remoteControlArmStatus().armed) {
          throw new Error("Remote control is paused on this Mac. Open Vox Desktop and allow it until Vox quits.");
        }
        result = { ok: true, answer: await performRemoteCommand(payload.command) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "The remote command failed." };
      }
      const encrypted = encryptRemoteResult(commandSecret, pairing.deviceId, envelope.id, result);
      await cloudJson("/api/device-commands", {
        method: "PATCH",
        body: JSON.stringify({
          id: envelope.id,
          deviceId: pairing.deviceId,
          resultCiphertext: encrypted.ciphertext,
          resultIv: encrypted.iv,
        }),
      });
    }
  } catch {
    // Pairing and relay failures stay silent; the UI reports connectivity on demand.
  } finally {
    remoteRelayInFlight = false;
  }
}

function layoutVoxView() {
  if (!mainWindow || !voxView) return;
  const [width, height] = mainWindow.getContentSize();
  const reservedDrawer = panelOpen ? Math.min(drawerWidth, Math.floor(width * 0.46)) : 0;
  voxView.setBounds({
    x: 0,
    y: toolbarHeight,
    width: Math.max(1, width - reservedDrawer),
    height: Math.max(1, height - toolbarHeight),
  });
}

function registerIpcHandlers() {
  ipcMain.handle("vox-connection:status", async (event) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    return {
      mode: connectionMode(settings.connectionMode),
      ...personalKeysStatus(settings),
      secureStorageAvailable: secureStorageAvailable(),
      phoneMacRoutingConfigured: encryptedSettingConfigured(settings, "phoneRelaySecret"),
    };
  });

  ipcMain.handle("vox-connection:set-mode", async (event, rawMode) => {
    requireTrustedVoxSender(event);
    const mode = connectionMode(rawMode);
    if (!mode) throw new Error("Choose Vox Cloud or Personal mode.");
    const settings = await readSettings();
    await saveSettings({ ...settings, connectionMode: mode });
    activeConnectionMode = mode;
    setTimeout(() => void loadConnectionSurface(mode), 80);
    return { mode, ...personalKeysStatus(settings) };
  });

  ipcMain.handle("vox-connection:save-personal-keys", async (event, rawKeys) => {
    requireTrustedVoxSender(event);
    const openAIKey = typeof rawKeys?.openAIKey === "string" ? rawKeys.openAIKey.trim() : "";
    const typeSafeKey = typeof rawKeys?.typeSafeKey === "string" ? rawKeys.typeSafeKey.trim() : "";
    if (!validOpenAIKey(openAIKey)) throw new Error("Enter a valid OpenAI API key.");
    if (!validTypeSafeKey(typeSafeKey)) throw new Error("Enter a valid TypeSafe API key.");
    if (!secureStorageAvailable()) {
      throw new Error("Secure system storage is unavailable on this computer.");
    }
    const settings = await readSettings();
    const personalOpenAIKey = safeStorage.encryptString(openAIKey).toString("base64");
    const personalTypeSafeKey = safeStorage.encryptString(typeSafeKey).toString("base64");
    const current = { ...settings };
    delete current.personalApiKey;
    await saveSettings({
      ...current,
      connectionMode: "personal",
      personalOpenAIKey,
      personalTypeSafeKey,
    });
    activeConnectionMode = "personal";
    return {
      mode: "personal",
      personalKeyConfigured: true,
      openAIKeyConfigured: true,
      typeSafeKeyConfigured: true,
    };
  });

  ipcMain.handle("vox-connection:remove-personal-keys", async (event) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    const remaining = { ...settings };
    delete remaining.personalApiKey;
    delete remaining.personalOpenAIKey;
    delete remaining.personalTypeSafeKey;
    await saveSettings(remaining);
    return { removed: true };
  });

  ipcMain.handle("vox-connection:realtime-token", async (event, request) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    if (connectionMode(settings.connectionMode) !== "personal") {
      throw new Error("Personal mode is not selected.");
    }
    const apiKey = readEncryptedSetting(settings, "personalOpenAIKey", "OpenAI API key", "personalApiKey");
    return createPersonalRealtimeSecret(apiKey, request);
  });

  ipcMain.handle("vox-connection:personal-route", async (event, request) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    if (connectionMode(settings.connectionMode) !== "personal") {
      throw new Error("Personal mode is not selected.");
    }
    const apiKey = readEncryptedSetting(settings, "personalTypeSafeKey", "TypeSafe API key");
    return createPersonalRoute(apiKey, request);
  });

  ipcMain.handle("vox-connection:personal-presence", async (event, request) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    if (connectionMode(settings.connectionMode) !== "personal") {
      throw new Error("Personal mode is not selected.");
    }
    const apiKey = readEncryptedSetting(settings, "personalTypeSafeKey", "TypeSafe API key");
    return createPersonalPresence(apiKey, request);
  });

  ipcMain.handle("vox-phone:save-relay-passphrase", async (event, rawPassphrase) => {
    requireTrustedVoxSender(event);
    if (!secureStorageAvailable()) {
      throw new Error("Secure system storage is unavailable on this Mac.");
    }
    const relaySecret = derivedPhoneRelaySecret(rawPassphrase);
    const settings = await readSettings();
    await saveSettings({
      ...settings,
      phoneRelaySecret: safeStorage.encryptString(relaySecret).toString("base64"),
    });
    return { configured: true };
  });

  ipcMain.handle("vox-phone:remove-relay-passphrase", async (event) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    const remaining = { ...settings };
    delete remaining.phoneRelaySecret;
    await saveSettings(remaining);
    return { removed: true };
  });

  ipcMain.handle("vox-remote:status", async (event) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    const pairing = unlockedRemotePairing(settings);
    if (!pairing) {
      return {
        configured: false,
        secureStorageAvailable: secureStorageAvailable(),
        ...remoteControlArmStatus(),
      };
    }
    let device = null;
    if (connectionMode(settings.connectionMode) === "cloud") {
      try {
        device = (await cloudJson(`/api/device-pairing?deviceId=${encodeURIComponent(pairing.deviceId)}`)).device;
      } catch {
        // Return the locally known state while Vox Cloud is temporarily unavailable.
      }
    }
    return {
      configured: true,
      secureStorageAvailable: secureStorageAvailable(),
      deviceId: pairing.deviceId,
      name: pairing.name,
      status: device?.status ?? pairing.status,
      phoneLabel: device?.claimLabel ?? settings.remoteMacPairing?.phoneLabel ?? null,
      pairingUrl:
        device?.status === "pending" && Date.parse(device.expiresAt ?? "") > Date.now()
          ? remotePairingUrl(pairing)
          : undefined,
      ...remoteControlArmStatus(),
    };
  });

  ipcMain.handle("vox-remote:arm", async (event) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    const pairing = unlockedRemotePairing(settings);
    if (!pairing || pairing.status !== "active") {
      throw new Error("Pair and activate a phone before enabling remote control.");
    }
    remoteControlArmed = true;
    return remoteControlArmStatus();
  });

  ipcMain.handle("vox-remote:disarm", (event) => {
    requireTrustedVoxSender(event);
    remoteControlArmed = false;
    return remoteControlArmStatus();
  });

  ipcMain.handle("vox-remote:create-pairing", async (event) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    if (connectionMode(settings.connectionMode) !== "cloud") {
      throw new Error("Phone pairing is available in Vox Cloud mode.");
    }
    if (!secureStorageAvailable()) {
      throw new Error("Secure system storage is unavailable on this Mac.");
    }
    const previous = unlockedRemotePairing(settings);
    if (previous) {
      try {
        await cloudJson(`/api/device-pairing?deviceId=${encodeURIComponent(previous.deviceId)}`, {
          method: "DELETE",
        });
      } catch {
        // Creating a replacement pairing locally still invalidates the old secret on this Mac.
      }
    }
    const deviceId = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const name = "This Mac";
    await cloudJson("/api/device-pairing", {
      method: "POST",
      body: JSON.stringify({ action: "create", deviceId, name }),
    });
    await saveSettings({
      ...settings,
      remoteMacPairing: {
        deviceId,
        name,
        status: "pending",
        encryptedSecret: safeStorage.encryptString(secret).toString("base64"),
      },
      processedRemoteCommandIds: [],
    });
    lastRemoteHeartbeatAt = 0;
    void processRemoteRelay();
    return {
      configured: true,
      deviceId,
      name,
      status: "pending",
      pairingUrl: remotePairingUrl({ deviceId, secret }),
    };
  });

  ipcMain.handle("vox-remote:revoke", async (event) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    const pairing = unlockedRemotePairing(settings);
    if (pairing) {
      try {
        await cloudJson(`/api/device-pairing?deviceId=${encodeURIComponent(pairing.deviceId)}`, {
          method: "DELETE",
        });
      } catch {
        // Removing the local key immediately prevents this Mac from accepting more commands.
      }
    }
    const remaining = { ...settings };
    delete remaining.remoteMacPairing;
    delete remaining.processedRemoteCommandIds;
    await saveSettings(remaining);
    remoteControlArmed = false;
    lastRemoteHeartbeatAt = 0;
    return { revoked: true };
  });

  ipcMain.handle("vox-smart-home:status", async (event) => {
    requireTrustedVoxSender(event);
    const settings = await readSettings();
    return {
      available: true,
      secureStorageAvailable: secureStorageAvailable(),
      adapters: availableSmartHomeAdapters(),
      devices: publicSavedSmartHomeDevices(settings),
    };
  });

  ipcMain.handle("vox-smart-home:discover", async (event, rawAdapter) => {
    requireTrustedVoxSender(event);
    const adapter = typeof rawAdapter === "string" ? rawAdapter.slice(0, 80) : "";
    return { devices: await discoverSmartHomeDevices(adapter || "dyson-local") };
  });

  ipcMain.handle("vox-smart-home:save-device", async (event, rawDevice) => {
    requireTrustedVoxSender(event);
    if (!secureStorageAvailable()) {
      throw new Error("Secure system storage is unavailable on this computer.");
    }
    const configured = configureSmartHomeDevice(rawDevice);
    const settings = await readSettings();
    const currentDevices = savedSmartHomeDevices(settings);
    const existing = currentDevices.find((device) => {
      if (device.adapter !== configured.adapter) return false;
      try {
        return unlockSmartHomeDevice(settings, device.id).serial === configured.serial;
      } catch {
        return false;
      }
    });
    const encryptedConfiguration = safeStorage.encryptString(JSON.stringify({
      host: configured.host,
      serial: configured.serial,
      productType: configured.productType,
      credential: configured.credential,
    })).toString("base64");
    const savedDevice = {
      id: existing?.id ?? randomUUID(),
      adapter: configured.adapter,
      kind: configured.kind,
      name: configured.name,
      encryptedConfiguration,
    };
    const nextDevices = currentDevices.filter((device) => device.id !== savedDevice.id);
    nextDevices.push(savedDevice);
    await saveSettings({ ...settings, smartHomeDevices: nextDevices });

    try {
      const status = await runSmartHomeCommand(configured, "Dyson purifier status");
      return { device: { id: savedDevice.id, ...publicSmartHomeDevice(configured) }, connected: true, status };
    } catch (error) {
      return {
        device: { id: savedDevice.id, ...publicSmartHomeDevice(configured) },
        connected: false,
        warning: error instanceof Error ? error.message : "The device was saved but could not be reached.",
      };
    }
  });

  ipcMain.handle("vox-smart-home:remove-device", async (event, rawId) => {
    requireTrustedVoxSender(event);
    const id = typeof rawId === "string" ? rawId.slice(0, 100) : "";
    if (!id) throw new Error("Choose a smart-home device to remove.");
    const settings = await readSettings();
    const currentDevices = savedSmartHomeDevices(settings);
    const nextDevices = currentDevices.filter((device) => device.id !== id);
    if (nextDevices.length === currentDevices.length) {
      throw new Error("That smart-home device is not configured.");
    }
    await saveSettings({ ...settings, smartHomeDevices: nextDevices });
    return { removed: true };
  });

  ipcMain.handle("vox-smart-home:command", async (event, rawRequest) => {
    requireTrustedVoxSender(event);
    const now = Date.now();
    if (now - lastSmartHomeCommandAt < 750) {
      throw new Error("A smart-home command was just requested.");
    }
    const prompt = typeof rawRequest?.prompt === "string" ? rawRequest.prompt.trim().slice(0, 4_000) : "";
    const id = typeof rawRequest?.deviceId === "string" ? rawRequest.deviceId.slice(0, 100) : "";
    if (!prompt) throw new Error("Say what you want the smart-home device to do.");
    const settings = await readSettings();
    const availableDevices = savedSmartHomeDevices(settings);
    const promptLower = prompt.toLocaleLowerCase();
    const namedDevice = availableDevices.find((device) =>
      typeof device.name === "string" && promptLower.includes(device.name.toLocaleLowerCase()),
    );
    const selectedId = id || namedDevice?.id || (availableDevices.length === 1 ? availableDevices[0].id : "");
    if (!selectedId && availableDevices.length > 1) {
      throw new Error("Say the saved device name so Vox knows which one to control.");
    }
    const device = unlockSmartHomeDevice(settings, selectedId);
    lastSmartHomeCommandAt = now;
    return runSmartHomeCommand(device, prompt);
  });

  ipcMain.handle("vox-codex:set-panel-open", (event, open) => {
    requireTrustedSender(event);
    panelOpen = Boolean(open);
    layoutVoxView();
    return { open: panelOpen };
  });

  ipcMain.handle("vox-codex:status", async (event) => {
    requireTrustedSender(event);
    const settings = await readSettings();
    return {
      available: true,
      workspace: typeof settings.workspace === "string" ? settings.workspace : null,
      running: Boolean(activeTask),
      taskId: activeTask?.id ?? null,
      safety: "Local tasks stay inside the selected folder. Network access is off.",
    };
  });

  ipcMain.handle("vox-codex:choose-workspace", async (event) => {
    requireTrustedSender(event);
    const workspace = await chooseWorkspace();
    if (!workspace) return { canceled: true };
    return { canceled: false, workspace };
  });

  ipcMain.handle("vox-codex:run", async (event, rawRequest) => {
    requireTrustedSender(event);
    if (activeTask || taskLaunchPending) {
      throw new Error("A local Codex task is already running or awaiting confirmation.");
    }
    taskLaunchPending = true;
    try {
      const prompt = typeof rawRequest?.prompt === "string" ? rawRequest.prompt.trim() : "";
      if (!prompt) throw new Error("Describe what you want local Codex to do.");
      if (prompt.length > maximumPromptLength) {
        throw new Error(`Keep the task under ${maximumPromptLength.toLocaleString()} characters.`);
      }
      const workspace = await validateWorkspace(rawRequest?.workspace);
      const access = rawRequest?.access === "workspace-write" ? "workspace-write" : "read-only";
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "Run with local Codex?",
        message: access === "workspace-write" ? "Allow Codex to edit this folder?" : "Run a read-only Codex task?",
        detail: `Folder: ${workspace}\n\nTask: ${truncate(prompt, 700)}\n\nNetwork access is off. The selected access mode is enforced by Codex's local sandbox.`,
        buttons: [access === "workspace-write" ? "Run and allow edits" : "Run read-only", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) return { canceled: true };

      const taskId = randomUUID();
      void runCodexTask(taskId, { prompt, workspace, access, voice: false });
      return { canceled: false, taskId };
    } finally {
      taskLaunchPending = false;
    }
  });

  ipcMain.handle("vox-codex:voice-run", async (event, rawRequest) => {
    requireTrustedVoxSender(event);
    if (activeTask || taskLaunchPending) {
      throw new Error("A local Codex task is already running or awaiting confirmation.");
    }
    taskLaunchPending = true;
    try {
      const prompt = typeof rawRequest?.prompt === "string" ? rawRequest.prompt.trim() : "";
      if (!prompt) throw new Error("Vox did not receive a local Codex task.");
      if (prompt.length > maximumPromptLength) {
        throw new Error(`Keep the task under ${maximumPromptLength.toLocaleString()} characters.`);
      }

      const workspace = await savedOrChosenWorkspace();
      if (!workspace) return { canceled: true };

      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "Let Vox use local Codex?",
        message: "How may Codex access this project?",
        detail: `Folder: ${workspace}\n\nVox heard: ${truncate(prompt, 700)}\n\nNetwork access is off. The selected access mode is enforced by Codex's local sandbox. Codex's concise final reply will return to Vox so it can speak it, and that reply may appear in your synced conversation.`,
        buttons: ["Run read-only", "Allow edits", "Cancel"],
        defaultId: 2,
        cancelId: 2,
        noLink: true,
      });
      if (confirmation.response === 2) return { canceled: true };

      const access = confirmation.response === 1 ? "workspace-write" : "read-only";
      const taskId = randomUUID();
      openCodexPanel();
      const result = await runCodexTask(taskId, {
        prompt,
        workspace,
        access,
        voice: true,
      });

      if (result.status === "completed") {
        return { canceled: false, answer: result.finalResponse };
      }
      if (result.status === "cancelled") return { canceled: true };
      throw new Error(result.message || "Local Codex could not complete the task.");
    } finally {
      taskLaunchPending = false;
    }
  });

  ipcMain.handle("vox-desktop:open-workspace", async (event) => {
    requireTrustedVoxSender(event);
    const now = Date.now();
    if (now - lastWorkspaceOpenAt < 1_500) {
      throw new Error("The project folder was just opened.");
    }

    const settings = await readSettings();
    const workspace = await validateWorkspace(settings.workspace);
    lastWorkspaceOpenAt = now;
    const openError = await shell.openPath(workspace);
    if (openError) throw new Error(openError);
    return { opened: true, name: path.basename(workspace) };
  });

  ipcMain.handle("vox-desktop:resolve-app", async (event, text) => {
    requireTrustedVoxSender(event);
    return matchInstalledApp(text, await installedApps());
  });

  ipcMain.handle("vox-desktop:control", async (event, rawRequest) => {
    requireTrustedVoxSender(event);
    if (activeTask || taskLaunchPending) {
      throw new Error("A local Codex task is already running or awaiting confirmation.");
    }

    const now = Date.now();
    if (now - lastDesktopControlAt < 1_500) {
      throw new Error("A desktop action was just requested.");
    }

    const prompt = typeof rawRequest?.prompt === "string" ? rawRequest.prompt.trim() : "";
    if (!prompt || prompt.length > maximumPromptLength) {
      throw new Error("Vox did not receive a valid desktop action.");
    }
    const appPolicy = approvedDesktopApp(rawRequest?.appId) ??
      (await installedApps()).find(candidate => candidate.id === rawRequest?.appId);
    if (!appPolicy) throw new Error("That app could not be verified as installed on this Mac.");
    const actionText = currentDesktopActionText(prompt);
    if (isBlockedDesktopControlPrompt(actionText)) {
      return {
        canceled: false,
        answer: usesTaiwanMandarin(actionText)
          ? "這個操作涉及受限制的動作，所以我沒有執行。"
          : "That request includes a restricted action, so I did not perform it.",
      };
    }

    const closing = isClosingDesktopApp(actionText);
    const draftOnly = isDraftOnlyDesktopControlPrompt(actionText);
    const intent = closing || rawRequest?.intent === "interact" ? "interact" : "launch";
    taskLaunchPending = true;
    lastDesktopControlAt = now;
    try {
      if (intent === "launch") {
        await launchApprovedDesktopApp(appPolicy);
        return {
          canceled: false,
          answer: usesTaiwanMandarin(prompt)
            ? `已經幫你開啟「${appPolicy.name}」。`
            : `I opened ${appPolicy.name}.`,
        };
      }

      if (!closing) await launchApprovedDesktopApp(appPolicy);
      if (closing && !(await isDesktopAppRunning(appPolicy.bundleId))) {
        return {
          canceled: false,
          answer: usesTaiwanMandarin(prompt)
            ? `「${appPolicy.name}」已經是關閉狀態。`
            : `${appPolicy.name} is already closed.`,
        };
      }
      const workspace = await computerControlWorkingDirectory();
      const taskId = randomUUID();
      openCodexPanel();
      const result = await runCodexTask(taskId, {
        prompt,
        workspace,
        access: "read-only",
        voice: true,
        computerControl: true,
        targetAppName: appPolicy.name,
        targetBundleId: appPolicy.bundleId,
        computerUseMode: closing || rawRequest?.mode === "fast" ? "fast" : "standard",
        computerControlAction: closing
          ? "close_app"
          : draftOnly
            ? "draft_message"
            : "interact",
      });

      if (result.status === "completed") {
        return { canceled: false, answer: result.finalResponse };
      }
      if (result.status === "setup-required") {
        return { canceled: false, answer: result.message };
      }
      if (result.status === "cancelled") return { canceled: true };
      return {
        canceled: false,
        answer: usesTaiwanMandarin(prompt)
          ? "這次沒有完成畫面操作，而且我沒有假裝成功。你可以確認 macOS 權限後再試一次。"
          : "I did not complete the screen action, and I did not treat it as a success. Check the macOS permissions and try again.",
      };
    } finally {
      taskLaunchPending = false;
    }
  });

  ipcMain.handle("vox-codex:cancel", async (event, request) => {
    requireTrustedSender(event);
    if (!activeTask || activeTask.id !== request?.taskId) return { cancelled: false };
    activeTask.abortController.abort();
    return { cancelled: true };
  });
}

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function configureSessionSecurity() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return (
      webContents === voxView?.webContents &&
      normalizeOrigin(requestingOrigin) === activeVoxOrigin &&
      (permission === "media" || permission === "notifications")
    );
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      webContents === voxView?.webContents &&
        normalizeOrigin(details.requestingUrl) === activeVoxOrigin &&
        (permission === "media" || permission === "notifications"),
    );
  });
}

function configureDesktopApiSessionBinding() {
  if (!localVoxServer) return;
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${localVoxServer.origin}/*`] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      if (details.webContentsId === voxView?.webContents.id) {
        requestHeaders[desktopSessionHeader.name] = desktopSessionHeader.value;
      }
      callback({ requestHeaders });
    },
  );
}

function protectVoxNavigation() {
  voxView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  voxView.webContents.on("will-navigate", (event, url) => {
    let destination = null;
    try {
      destination = new URL(url);
    } catch {
      // Treat malformed navigation as untrusted.
    }
    if (
      destination?.origin === activeVoxOrigin &&
      !destination.pathname.startsWith("/api/")
    ) return;
    event.preventDefault();
    if (
      destination &&
      destination.origin !== localVoxServer?.origin &&
      (destination.protocol === "https:" || destination.protocol === "http:")
    ) void shell.openExternal(url);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 880,
    minHeight: 680,
    show: false,
    title: "Vox",
    backgroundColor: "#06141c",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  voxView = new WebContentsView({
    webPreferences: {
      preload: path.join(currentDirectory, "vox-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow.contentView.addChildView(voxView);
  voxView.setBackgroundColor("#07151d");
  configureDesktopApiSessionBinding();
  protectVoxNavigation();

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === shellUrl) return;
    event.preventDefault();
  });
  mainWindow.on("resize", layoutVoxView);
  mainWindow.on("closed", () => {
    activeTask?.abortController.abort();
    if (voxView && !voxView.webContents.isDestroyed()) voxView.webContents.close();
    voxView = null;
    mainWindow = null;
  });

  configureSessionSecurity();
  const settings = await readSettings();
  const mode = connectionMode(settings.connectionMode);
  activeConnectionMode = mode;
  const initialTarget = !app.isPackaged && developmentUrl ? developmentUrl : localVoxServer.url;
  activeVoxOrigin = new URL(initialTarget).origin;
  await Promise.all([mainWindow.loadFile(shellFile), voxView.webContents.loadURL(initialTarget)]);
  layoutVoxView();
  mainWindow.show();
}

app.whenReady().then(async () => {
  activeConnectionMode = connectionMode((await readSettings()).connectionMode);
  localVoxServer = await startLocalVoxServer(localWebRoot(), {
    cloudOrigin: productionUrl,
    desktopSessionHeader,
    getConnectionMode: () => activeConnectionMode,
    cloudFetch: (request) => session.defaultSession.fetch(request, {
      credentials: "include",
      redirect: "error",
    }),
  });
  registerIpcHandlers();
  // Installed-app discovery is useful for voice routing, but it must never sit
  // on the first conversational turn's latency path.
  void installedApps().catch(() => undefined);
  await createWindow();
  remoteRelayTimer = setInterval(() => void processRemoteRelay(), 2_500);
  void processRemoteRelay();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  remoteControlArmed = false;
  if (remoteRelayTimer) clearInterval(remoteRelayTimer);
  remoteRelayTimer = null;
  void localVoxServer?.close();
});
