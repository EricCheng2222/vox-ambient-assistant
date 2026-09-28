// Voice filter for the Vox page on this Mac: noise and music removal, and
// optionally "only listen to my voice". The audio work runs in a utility
// process (voice-filter-worker.mjs); this module starts it, connects the
// page's audio to it, and keeps the settings and the encrypted voiceprint.
import { app, ipcMain, safeStorage, utilityProcess } from "electron";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

// Cosine similarity a voice must reach to count as the owner.
// Tuned on CAM++ (zh+en) with scripts/voice-filter.test.mjs: the owner scores
// about 0.7–0.9 once a second of speech is in (over music too); a similar
// voice singing scored up to 0.62 and a different voice about 0.2.
export const VOICE_FILTER_THRESHOLDS = { relaxed: 0.55, normal: 0.65, strict: 0.75 };
export const VOICE_MODEL_FILES = ["dpdfnet2_48khz_hr.onnx", "campplus_zh_en.onnx", "silero_vad.onnx"];

function modelsDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "voice-models")
    : path.resolve(currentDirectory, "..", "resources", "voice-models");
}

function strictness(value) {
  return value === "relaxed" || value === "strict" ? value : "normal";
}

/**
 * @param {{
 *   requireTrustedVoxSender: (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => void,
 *   readSettings: () => Promise<Record<string, any>>,
 *   saveSettings: (settings: Record<string, any>) => Promise<void>,
 *   secureStorageAvailable: () => boolean,
 * }} deps
 */
export function registerVoiceFilter(deps) {
  let worker = null;
  let ready = null;
  let failure = "";
  const waiting = new Map();

  async function modelsPresent() {
    try {
      await Promise.all(VOICE_MODEL_FILES.map((name) => access(path.join(modelsDirectory(), name))));
      return true;
    } catch {
      return false;
    }
  }

  async function config() {
    const settings = await deps.readSettings();
    const saved = settings.voiceFilter ?? {};
    let voiceprint = null;
    if (typeof saved.voiceprint === "string" && deps.secureStorageAvailable()) {
      try {
        voiceprint = JSON.parse(safeStorage.decryptString(Buffer.from(saved.voiceprint, "base64")));
      } catch {
        voiceprint = null;
      }
    }
    return {
      // Both options start off: the original microphone path.
      denoise: saved.denoise === true,
      onlyMyVoice: saved.onlyMyVoice === true && Array.isArray(voiceprint),
      strictness: strictness(saved.strictness),
      voiceprint: Array.isArray(voiceprint) ? voiceprint : null,
      enrolledAt: typeof saved.enrolledAt === "string" ? saved.enrolledAt : null,
    };
  }

  async function configureWorker() {
    if (!worker) return;
    const current = await config();
    worker.postMessage({
      type: "configure",
      denoise: current.denoise,
      verify: current.onlyMyVoice,
      threshold: VOICE_FILTER_THRESHOLDS[current.strictness],
      voiceprint: current.voiceprint,
    });
  }

  /** Starts the audio process on first use and waits until its models load. */
  function start() {
    if (ready) return ready;
    ready = (async () => {
      if (!(await modelsPresent())) throw new Error("The voice filter's models aren't installed.");
      worker = utilityProcess.fork(path.join(currentDirectory, "voice-filter-worker.mjs"), [], {
        serviceName: "Vox Voice Filter",
        env: { ...process.env, VOX_VOICE_MODELS: modelsDirectory() },
        stdio: process.env.VOX_VOICE_FILTER_DEBUG ? "inherit" : "ignore",
      });
      worker.on("exit", () => {
        worker = null;
        ready = null;
        for (const [, pending] of waiting) pending.reject(new Error("The voice filter stopped. Try again."));
        waiting.clear();
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The voice filter took too long to start.")), 20_000);
        worker.on("message", function onReady(message) {
          if (message?.type === "ready") {
            clearTimeout(timer);
            resolve();
          } else if (message?.type === "failed") {
            clearTimeout(timer);
            reject(new Error(message.message || "The voice filter couldn't start."));
          }
        });
      });
      worker.on("message", (message) => {
        const pending = message?.id ? waiting.get(message.id) : null;
        if (!pending) return;
        waiting.delete(message.id);
        if (message.type === "enrolled") pending.resolve(message);
        else pending.reject(new Error(message.message || "Voice setup failed."));
      });
      await configureWorker();
      failure = "";
    })().catch((error) => {
      failure = error instanceof Error ? error.message : String(error);
      worker?.kill();
      worker = null;
      ready = null;
      throw error;
    });
    return ready;
  }

  async function status() {
    const current = await config();
    return {
      available: await modelsPresent(),
      secureStorageAvailable: deps.secureStorageAvailable(),
      denoise: current.denoise,
      onlyMyVoice: current.onlyMyVoice,
      strictness: current.strictness,
      enrolled: Boolean(current.voiceprint),
      enrolledAt: current.enrolledAt,
      error: failure || null,
    };
  }

  async function update(changes) {
    const settings = await deps.readSettings();
    const saved = { ...(settings.voiceFilter ?? {}), ...changes };
    await deps.saveSettings({ ...settings, voiceFilter: saved });
    await configureWorker();
  }

  ipcMain.handle("vox-voice-filter:status", async (event) => {
    deps.requireTrustedVoxSender(event);
    return status();
  });

  ipcMain.handle("vox-voice-filter:update", async (event, raw) => {
    deps.requireTrustedVoxSender(event);
    const changes = {};
    if (typeof raw?.denoise === "boolean") changes.denoise = raw.denoise;
    if (typeof raw?.onlyMyVoice === "boolean") {
      if (raw.onlyMyVoice && !(await config()).voiceprint) throw new Error("Set up your voice first.");
      changes.onlyMyVoice = raw.onlyMyVoice;
    }
    if (typeof raw?.strictness === "string") changes.strictness = strictness(raw.strictness);
    await update(changes);
    return status();
  });

  ipcMain.handle("vox-voice-filter:enroll-finish", async (event) => {
    deps.requireTrustedVoxSender(event);
    if (!deps.secureStorageAvailable()) throw new Error("Your Mac's secure storage isn't available, so Vox can't save your voiceprint.");
    await start();
    const id = `${Date.now()}-${Math.random()}`;
    const result = await new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker.postMessage({ type: "enroll-finish", id });
    });
    await update({
      voiceprint: safeStorage.encryptString(JSON.stringify(result.voiceprint)).toString("base64"),
      enrolledAt: new Date().toISOString(),
      onlyMyVoice: true,
    });
    return { ...(await status()), seconds: result.seconds, consistency: result.consistency };
  });

  ipcMain.handle("vox-voice-filter:enroll-cancel", async (event) => {
    deps.requireTrustedVoxSender(event);
    worker?.postMessage({ type: "enroll-cancel" });
    return true;
  });

  ipcMain.handle("vox-voice-filter:forget", async (event) => {
    deps.requireTrustedVoxSender(event);
    await update({ voiceprint: null, enrolledAt: null, onlyMyVoice: false });
    return status();
  });

  // The page hands over one end of a MessageChannel; audio then flows
  // directly between the page's audio worklet and the utility process.
  ipcMain.on("vox-voice-filter:connect", async (event, kind) => {
    const [port] = event.ports ?? [];
    try {
      deps.requireTrustedVoxSender(event);
      if (!port) return;
      await start();
      worker.postMessage({ type: kind === "enroll" ? "enroll-start" : "session" }, [port]);
    } catch {
      // The page falls back to the plain microphone when no audio comes back.
      port?.close();
    }
  });

  return {
    stop() {
      worker?.kill();
    },
  };
}
