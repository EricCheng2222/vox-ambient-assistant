import { execFile, spawn } from "node:child_process";
import { access, constants, mkdir, open, readdir, readFile, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { app, dialog, ipcMain } from "electron";

import { faultsFromLog, repair, runChecks } from "./self-check.mjs";

// Vox's health, as the Mac app offers it: the checks and repairs of
// self-check.mjs wired to this Mac, the regression run, and the guarded
// update. All of it is asked for from the Vox window on this Mac and nowhere
// else: these handlers accept only that window, and none of them is among the
// commands a phone, a web page, or the model can send.

const LEFTOVER = /^Vox-[\d.]+-arm64.*\.(?:zip|dmg|blockmap)$/u;

function execOk(file, args, timeout = 8_000) {
  return new Promise((resolve) => execFile(file, args, { timeout }, (error) => resolve(!error)));
}

/** Runs a script of Vox's own source folder with the user's shell (so `node` is found) and collects what it says. */
function runScript(folder, script, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn("/bin/zsh", ["-lc", `node ${script} ${args.join(" ")}`], { cwd: folder, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (chunk) => {
      output = (output + chunk).slice(-20_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, output: "The script could not be started." });
    });
  });
}

export function registerHealth({ requireTrustedVoxSender, getWindow, readSettings, saveSettings, signedIn, phoneLink, codexPath, homeDevices, devicesOnNetwork, rememberDeviceAddress }) {
  /** Vox's own source, when this Mac has it: where the regression run and the update live. */
  async function sourceFolder() {
    const folder = (await readSettings()).voxSourceFolder;
    if (typeof folder !== "string" || !path.isAbsolute(folder)) return null;
    try {
      await access(path.join(folder, "scripts", "update-vox.mjs"), constants.R_OK);
      await access(path.join(folder, "scripts", "regression.mjs"), constants.R_OK);
      return folder;
    } catch {
      return null;
    }
  }

  async function leftovers() {
    const folder = await sourceFolder();
    if (!folder) return { files: 0, bytes: 0, paths: [] };
    const dist = path.join(folder, "desktop", "VoxDesktop", "dist");
    const names = (await readdir(dist).catch(() => [])).filter((name) => LEFTOVER.test(name));
    let bytes = 0;
    for (const name of names) bytes += (await stat(path.join(dist, name)).catch(() => ({ size: 0 }))).size;
    return { files: names.length, bytes, paths: names.map((name) => path.join(dist, name)) };
  }

  const deps = {
    now: () => Date.now(),
    signedIn,
    phoneLink,
    planner: async () => {
      const binary = codexPath();
      const installed = Boolean(binary) && (await access(binary, constants.X_OK).then(() => true, () => false));
      return { installed, signedIn: installed ? await execOk(binary, ["login", "status"]) : false };
    },
    homeDevices,
    devicesOnNetwork,
    disk: async () => {
      const space = await statfs(app.getPath("home"));
      const left = await leftovers();
      return { freeGb: (space.bavail * space.bsize) / 1e9, leftovers: { files: left.files, bytes: left.bytes } };
    },
    recentFaults: async () => faultsFromLog(await readFile(path.join(app.getPath("logs"), "main-errors.log"), "utf8").catch(() => ""), Date.now()),
    versions: async () => {
      const folder = await sourceFolder();
      let source = null;
      if (folder) {
        try {
          source = JSON.parse(await readFile(path.join(folder, "desktop", "VoxDesktop", "package.json"), "utf8")).version ?? null;
        } catch {
          source = null;
        }
      }
      return { running: app.getVersion(), source };
    },
    rememberDeviceAddresses: async () => {
      const [saved, seen] = await Promise.all([homeDevices(), devicesOnNetwork()]);
      for (const device of saved) {
        const found = seen.find((candidate) => candidate.serial === device.serial);
        if (found && found.host !== device.host) await rememberDeviceAddress(device.id, found.host);
      }
    },
    deleteLeftovers: async () => {
      // Only the files matched by name in Vox's own build folder; never a folder, never anything else.
      for (const file of (await leftovers()).paths) await rm(file, { force: true });
    },
  };

  ipcMain.handle("vox-health:check", async (event) => {
    requireTrustedVoxSender(event);
    return { ...(await runChecks(deps)), source: await sourceFolder() };
  });

  ipcMain.handle("vox-health:fix", async (event, id) => {
    requireTrustedVoxSender(event);
    return repair(typeof id === "string" ? id.slice(0, 40) : "", deps);
  });

  ipcMain.handle("vox-health:choose-source", async (event) => {
    requireTrustedVoxSender(event);
    const picked = await dialog.showOpenDialog(getWindow(), { title: "Where Vox's own source is kept", properties: ["openDirectory"] });
    if (picked.canceled || !picked.filePaths[0]) return { source: await sourceFolder() };
    const settings = await readSettings();
    await saveSettings({ ...settings, voxSourceFolder: picked.filePaths[0] });
    const source = await sourceFolder();
    return source ? { source } : { source: null, error: "That folder is not Vox's source (it has no scripts/update-vox.mjs)." };
  });

  let busy = false;
  ipcMain.handle("vox-health:regression", async (event) => {
    requireTrustedVoxSender(event);
    const folder = await sourceFolder();
    if (!folder) return { passed: false, says: "Vox's source folder is not set on this Mac." };
    if (busy) return { passed: false, says: "The checks are already running." };
    busy = true;
    try {
      const { code, output } = await runScript(folder, "scripts/regression.mjs", [], 20 * 60_000);
      const lines = output.trim().split("\n");
      return { passed: code === 0, says: lines.at(-1) ?? "", failed: lines.filter((line) => line.startsWith("FAIL")).map((line) => line.replace(/^FAIL\s+/u, "").replace(/\s+[\d.]+s$/u, "")) };
    } finally {
      busy = false;
    }
  });

  ipcMain.handle("vox-health:update", async (event) => {
    requireTrustedVoxSender(event);
    const folder = await sourceFolder();
    if (!folder) return { started: false, says: "Vox's source folder is not set on this Mac." };
    if (busy) return { started: false, says: "The checks are running; wait for them to finish." };
    // The user's own yes, in a window of the Mac itself, every time.
    const answer = await dialog.showMessageBox(getWindow(), {
      type: "question",
      buttons: ["Update Vox", "Not now"],
      defaultId: 1,
      cancelId: 1,
      message: "Update Vox now?",
      detail: "Every check runs first; nothing is installed unless they all pass. Vox will then restart. The version running now is kept, and put back if the new one does not start.",
    });
    if (answer.response !== 0) return { started: false, says: "Not updated." };
    const logFolder = app.getPath("logs");
    await mkdir(logFolder, { recursive: true });
    const logPath = path.join(logFolder, "update.log");
    const log = await open(logPath, "w");
    // On its own, so it carries on when this app is quit to be replaced.
    const child = spawn("/bin/zsh", ["-lc", "node scripts/update-vox.mjs"], { cwd: folder, detached: true, stdio: ["ignore", log.fd, log.fd] });
    child.unref();
    await log.close();
    return { started: true, says: "Updating. The checks run first (a few minutes); Vox restarts only if they all pass.", log: logPath };
  });

  ipcMain.handle("vox-health:update-log", async (event) => {
    requireTrustedVoxSender(event);
    const text = await readFile(path.join(app.getPath("logs"), "update.log"), "utf8").catch(() => "");
    return { lines: text.split("\n").filter((line) => line.startsWith("[update]")).map((line) => line.replace(/^\[update\] /u, "")).slice(-8) };
  });
}
