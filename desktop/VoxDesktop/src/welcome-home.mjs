// "Welcome home" greeting: this Mac advertises a Bluetooth beacon
// (native/vox-beacon.swift); the paired Vox iPhone app notices when its owner
// comes within a few metres after a long time away and writes a signed
// arrival message. The Mac checks the signature against the phone pairing's
// shared secret and plays the greeting.
import { app, ipcMain } from "electron";
import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyArrival } from "./welcome-home-signature.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
// The iPhone decides what "a long time away" is; this only stops repeats.
const MIN_GAP_BETWEEN_GREETINGS_MS = 30 * 60_000;

function resource(...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.resolve(currentDirectory, "..", "resources", ...parts);
}

const beaconPath = () => resource("bin", "vox-beacon");

// Greeting sounds in resources/sounds (made by scripts/greeting).
export const WELCOME_HOME_SOUNDS = [
  { id: "cinematic-onyx", label: "Cinematic, Onyx" },
  { id: "cinematic-fable", label: "Cinematic, Fable" },
  { id: "cinematic-ash", label: "Cinematic, Ash" },
  { id: "simple-onyx", label: "Simple, Onyx" },
  { id: "simple-fable", label: "Simple, Fable" },
  { id: "simple-ash", label: "Simple, Ash" },
  { id: "simple-cedar", label: "Simple, Cedar" },
];
const DEFAULT_SOUND = "cinematic-onyx";

function soundId(value) {
  return WELCOME_HOME_SOUNDS.some((sound) => sound.id === value) ? value : DEFAULT_SOUND;
}

const soundPath = (id) => resource("sounds", `welcome-home-${soundId(id)}.m4a`);

/**
 * @param {{
 *   requireTrustedVoxSender: (event: Electron.IpcMainInvokeEvent) => void,
 *   readSettings: () => Promise<Record<string, any>>,
 *   saveSettings: (settings: Record<string, any>) => Promise<void>,
 *   pairing: (settings: Record<string, any>) => { deviceId: string, secret: string, status: string } | null,
 * }} deps
 */
export function registerWelcomeHome(deps) {
  let beacon = null;
  let bluetooth = "unknown";
  let pairing = null;
  const seenNonces = new Set();

  let player = null;

  async function play(id) {
    const sound = id ?? (await deps.readSettings()).welcomeHome?.sound;
    player?.kill();
    player = execFile("/usr/bin/afplay", [soundPath(sound)], () => {
      player = null;
    });
  }

  async function greet(kind) {
    if (kind === "t1") return play(); // The iPhone's Test button.
    const settings = await deps.readSettings();
    const last = Date.parse(settings.welcomeHome?.lastGreetedAt ?? "");
    if (Number.isFinite(last) && Date.now() - last < MIN_GAP_BETWEEN_GREETINGS_MS) return;
    play();
    await deps.saveSettings({
      ...settings,
      welcomeHome: { ...(settings.welcomeHome ?? {}), lastGreetedAt: new Date().toISOString() },
    });
  }

  function stopBeacon() {
    beacon?.kill();
    beacon = null;
    bluetooth = "off";
  }

  async function refresh() {
    const settings = await deps.readSettings();
    const enabled = settings.welcomeHome?.enabled !== false;
    pairing = deps.pairing(settings);
    const paired = pairing?.status === "active";
    if (!enabled || !paired || process.platform !== "darwin") return stopBeacon();
    if (beacon) return;
    try {
      await access(beaconPath());
    } catch {
      bluetooth = "unavailable";
      return;
    }
    beacon = spawn(beaconPath(), [], { stdio: ["pipe", "pipe", "ignore"] });
    let buffered = "";
    beacon.stdout.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      let newline;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === "state") bluetooth = message.state;
        const kind = message.type === "arrival" ? verifyArrival(message.payload, pairing, seenNonces) : false;
        if (kind) void greet(kind);
      }
    });
    beacon.on("exit", () => {
      beacon = null;
    });
  }

  async function status() {
    const settings = await deps.readSettings();
    const current = deps.pairing(settings);
    return {
      enabled: settings.welcomeHome?.enabled !== false,
      sound: soundId(settings.welcomeHome?.sound),
      sounds: WELCOME_HOME_SOUNDS,
      paired: current?.status === "active",
      bluetooth,
      lastGreetedAt: settings.welcomeHome?.lastGreetedAt ?? null,
    };
  }

  ipcMain.handle("vox-welcome-home:status", async (event) => {
    deps.requireTrustedVoxSender(event);
    await refresh();
    return status();
  });

  ipcMain.handle("vox-welcome-home:update", async (event, raw) => {
    deps.requireTrustedVoxSender(event);
    const changes = {};
    if (typeof raw?.enabled === "boolean") changes.enabled = raw.enabled;
    if (typeof raw?.sound === "string") changes.sound = soundId(raw.sound);
    if (Object.keys(changes).length) {
      const settings = await deps.readSettings();
      await deps.saveSettings({ ...settings, welcomeHome: { ...(settings.welcomeHome ?? {}), ...changes } });
    }
    await refresh();
    return status();
  });

  // Preview a sound (or the chosen one).
  ipcMain.handle("vox-welcome-home:test", async (event, id) => {
    deps.requireTrustedVoxSender(event);
    await play(typeof id === "string" ? soundId(id) : undefined);
    return true;
  });

  void refresh();
  return { refresh, stop: stopBeacon };
}
