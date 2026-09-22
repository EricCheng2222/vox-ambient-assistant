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
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Codex } from "@openai/codex-sdk";
import { runComputerUseSession } from "./computer-use-session.mjs";
import { installedApps, matchInstalledApp } from "./installed-apps.mjs";
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
  approvedDesktopApp,
  currentDesktopActionText,
  hasRunningDesktopApp,
  isBlockedDesktopControlPrompt,
  isClosingDesktopApp,
  isDraftOnlyDesktopControlPrompt,
} from "./desktop-control-policy.mjs";

const productionUrl = "https://vox-assistant.ericcheng306.workers.dev/";
const developmentUrl = process.env.VOX_DESKTOP_DEV_URL;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const shellFile = path.join(currentDirectory, "shell.html");
const shellUrl = pathToFileURL(shellFile).href;
const settingsFileName = "desktop-settings.json";
const toolbarHeight = 56;
const drawerWidth = 460;
const maximumPromptLength = 12_000;
const execFileAsync = promisify(execFile);
const computerUseUnavailablePattern =
  /(?:Sky Computer Use native pipe startup failed|computer[- ]control access wasn'?t approved|computer use.+(?:unavailable|not connected)|cua_repl.+failed)/iu;

let mainWindow = null;
let voxView = null;
let localVoxServer = null;
let activeVoxOrigin = "";
let panelOpen = false;
let activeTask = null;
let taskLaunchPending = false;
let lastWorkspaceOpenAt = 0;
let lastDesktopControlAt = 0;

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
    new URL(productionUrl).origin,
    localVoxServer?.origin,
    developmentUrl ? new URL(developmentUrl).origin : null,
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
  const target = mode === "cloud"
    ? (app.isPackaged || !developmentUrl ? productionUrl : developmentUrl)
    : localVoxServer.url;
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
    };
  });

  ipcMain.handle("vox-connection:set-mode", async (event, rawMode) => {
    requireTrustedVoxSender(event);
    const mode = connectionMode(rawMode);
    if (!mode) throw new Error("Choose Vox Cloud or Personal mode.");
    const settings = await readSettings();
    await saveSettings({ ...settings, connectionMode: mode });
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

function protectVoxNavigation() {
  voxView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  voxView.webContents.on("will-navigate", (event, url) => {
    if (normalizeOrigin(url) === activeVoxOrigin) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
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
  const initialTarget = mode === "cloud"
    ? (app.isPackaged || !developmentUrl ? productionUrl : developmentUrl)
    : localVoxServer.url;
  activeVoxOrigin = new URL(initialTarget).origin;
  await Promise.all([mainWindow.loadFile(shellFile), voxView.webContents.loadURL(initialTarget)]);
  layoutVoxView();
  mainWindow.show();
}

app.whenReady().then(async () => {
  localVoxServer = await startLocalVoxServer(localWebRoot());
  registerIpcHandlers();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void localVoxServer?.close();
});
