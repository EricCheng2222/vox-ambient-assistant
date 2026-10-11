// Vox checking on itself. A fixed list of checks is run on this Mac; each
// comes back as a finding in plain words, sorted into one of five kinds:
//
//   fine          nothing to do
//   can_fix       Vox can put this right itself, safely and reversibly, when the user taps Fix
//   needs_you     only the user can do it (sign in, allow something, switch a device on)
//   needs_change  a fault in Vox itself: it is written up for whoever maintains it
//   unknown       the check could not be made
//
// The cautious part is the triage: a repair is offered only for things that
// change settings or leftovers on this Mac, can be undone or redone, and do
// not touch the user's accounts, their data, or Vox's own code. Nothing here
// is reachable from a web page, an email, the phone relay, or the model: the
// checks and repairs run only when asked for from the Mac app's own window.
//
// Everything outside (the network, the disk, the settings file) arrives
// through `deps`, so the logic can be tested without any of it.

export const KINDS = ["fine", "can_fix", "needs_you", "needs_change", "unknown"];

/** Most pressing first: what needs the user, what Vox can fix, what needs a change, what could not be checked, what is fine. */
const ORDER = { needs_you: 0, can_fix: 1, needs_change: 2, unknown: 3, fine: 4 };

const finding = (id, title, kind, says, extra = {}) => ({ id, title, kind, says, ...extra });

/** Runs one check so that a check which throws is a finding ("could not be checked"), never a crash. */
async function attempt(id, title, check) {
  try {
    return await check();
  } catch (error) {
    return finding(id, title, "unknown", "This could not be checked just now.", { detail: String(error?.message ?? error).slice(0, 200) });
  }
}

const CHECKS = [
  ["account", "Your Vox account", async (deps) => {
    const signedIn = await deps.signedIn();
    return signedIn
      ? finding("account", "Your Vox account", "fine", "Signed in and reaching the Vox server.")
      : finding("account", "Your Vox account", "needs_you", "This Mac is not signed in to Vox, so nothing that needs the server will work.", { how: "Sign in on the Vox window with your access code." });
  }],
  ["phone", "Your phone and tablet", async (deps) => {
    const link = await deps.phoneLink();
    if (!link.paired) return finding("phone", "Your phone and tablet", "fine", "No phone is paired with this Mac. Pair one from Phone control if you want Vox on your phone to use this Mac.");
    if (!link.allowed) return finding("phone", "Your phone and tablet", "needs_you", "A phone is paired, but this Mac is not accepting its requests, so website tasks and home devices will not work from the phone.", { how: "In Vox on this Mac, open Phone control and allow remote control." });
    return finding("phone", "Your phone and tablet", "fine", `Paired${link.label ? ` with ${link.label}` : ""} and accepting requests.`);
  }],
  ["planner", "Working websites without the paid API", async (deps) => {
    const planner = await deps.planner();
    if (!planner.installed) return finding("planner", "Working websites without the paid API", "needs_change", "The part of Vox that plans website steps on this Mac is missing from the app, so every step is being paid for through the API.");
    if (!planner.signedIn) return finding("planner", "Working websites without the paid API", "needs_you", "Codex on this Mac is not signed in to ChatGPT, so website steps are being paid for through the API.", { how: "Open the ChatGPT or Codex app on this Mac and sign in." });
    return finding("planner", "Working websites without the paid API", "fine", "Website steps are planned on this Mac under your ChatGPT sign-in.");
  }],
  ["home", "Home devices", async (deps) => {
    const devices = await deps.homeDevices();
    if (!devices.length) return finding("home", "Home devices", "fine", "No home devices are set up.");
    if (deps.checkHomeDevice) {
      const results = await Promise.allSettled(devices.map((device) => deps.checkHomeDevice(device)));
      const failures = results.flatMap((result, index) => result.status === "rejected" || result.value?.connected !== true
        ? [{ device: devices[index], error: result.status === "rejected" ? result.reason : null }] : []);
      if (failures.length) {
        const needsCredential = failures.some(({ error }) => error?.kind === "credential");
        const needsPermission = failures.some(({ error }) => error?.kind === "permission");
        return finding("home", "Home devices", needsCredential || needsPermission ? "needs_you" : "unknown",
          `${failures.map(({ device }) => device.name).join(", ")} ${needsCredential ? "rejected the saved local credential" : needsPermission ? "cannot be reached because local network access was denied" : "did not confirm a working local control connection after recovery"}.`,
          { how: needsCredential ? "Reconnect the device in Home devices using its local credential." : needsPermission ? "Allow Vox in macOS Settings → Privacy & Security → Local Network." : "Open Home devices to check the saved connection. Network discovery alone does not confirm that device control works." });
      }
      return finding("home", "Home devices", "fine", `${devices.map((device) => device.name).join(", ")} ${devices.length === 1 ? "answered" : "all answered"} a local device status request.`);
    }
    const seen = await deps.devicesOnNetwork();
    const moved = devices.filter((device) => seen.some((found) => found.serial === device.serial && found.host !== device.host));
    const missing = devices.filter((device) => !seen.some((found) => found.serial === device.serial));
    if (moved.length) {
      return finding("home", "Home devices", "can_fix", `${moved.map((device) => device.name).join(", ")} moved to a new address on your network, so Vox is looking for ${moved.length === 1 ? "it" : "them"} in the wrong place.`, { fix: "Remember the new address", undo: "Nothing else changes; the device and its settings are untouched." });
    }
    if (missing.length) {
      return finding("home", "Home devices", "needs_you", `${missing.map((device) => device.name).join(", ")} cannot be found on your network right now.`, { how: "Check that it is switched on and on the same Wi-Fi as this Mac." });
    }
    return finding("home", "Home devices", "fine", `${devices.map((device) => device.name).join(", ")} ${devices.length === 1 ? "is" : "are"} on the network where Vox expects.`);
  }],
  ["space", "Room on this Mac", async (deps) => {
    const { freeGb, leftovers } = await deps.disk();
    const leftoverGb = Math.round((leftovers.bytes / 1e9) * 10) / 10;
    if (leftovers.files > 0 && (freeGb < 15 || leftoverGb >= 1)) {
      return finding("space", "Room on this Mac", "can_fix", `Old Vox installer files are taking up ${leftoverGb} GB${freeGb < 15 ? `, and this Mac has only ${Math.round(freeGb)} GB free` : ""}.`, { fix: "Delete the old installers", undo: "They are build leftovers; the installed app is not touched, and building again recreates them." });
    }
    if (freeGb < 5) return finding("space", "Room on this Mac", "needs_you", `This Mac has only ${Math.round(freeGb)} GB free. Vox may fail to update or save files.`, { how: "Free some space on this Mac." });
    return finding("space", "Room on this Mac", "fine", `${Math.round(freeGb)} GB free.`);
  }],
  ["errors", "Faults in the last day", async (deps) => {
    const faults = await deps.recentFaults();
    if (!faults.length) return finding("errors", "Faults in the last day", "fine", "Vox has not recorded any faults in the last day.");
    const total = faults.reduce((sum, fault) => sum + fault.count, 0);
    const worst = [...faults].sort((a, b) => b.count - a.count)[0];
    return finding("errors", "Faults in the last day", "needs_change", `Vox recorded ${total} ${total === 1 ? "fault" : "faults"} in the last day, most often in “${worst.kind}”. This is a problem in Vox itself, not something you did.`, {
      report: faults.map((fault) => `${fault.count}× ${fault.kind}: ${fault.sample}`).join("\n").slice(0, 2_000),
    });
  }],
  ["version", "Vox's version", async (deps) => {
    const { running, source } = await deps.versions();
    if (!source) return finding("version", "Vox's version", "fine", `Running ${running}.`);
    if (source !== running) return finding("version", "Vox's version", "needs_you", `Running ${running}; version ${source} has been prepared but not installed.`, { how: "Use Update Vox below. It runs the full set of checks first and only installs if they all pass." });
    return finding("version", "Vox's version", "fine", `Running ${running}, the newest prepared version.`);
  }],
];

/** Runs every check. Resolves to the findings, most pressing first, and a one-line summary. */
export async function runChecks(deps) {
  const findings = await Promise.all(CHECKS.map(([id, title, check]) => attempt(id, title, () => check(deps))));
  findings.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  return { findings, summary: summarise(findings), checkedAt: deps.now() };
}

export function summarise(findings) {
  const count = (kind) => findings.filter((item) => item.kind === kind).length;
  const parts = [];
  if (count("needs_you")) parts.push(`${count("needs_you")} ${count("needs_you") === 1 ? "thing needs" : "things need"} you`);
  if (count("can_fix")) parts.push(`${count("can_fix")} Vox can fix`);
  if (count("needs_change")) parts.push(`${count("needs_change")} ${count("needs_change") === 1 ? "needs" : "need"} a change to Vox`);
  if (count("unknown")) parts.push(`${count("unknown")} could not be checked`);
  return parts.length ? parts.join(", ") + "." : "Everything checked is working.";
}

/** The repairs Vox may make by itself: only these, only for a finding that is still "can_fix" when checked again. */
const REPAIRS = {
  home: (deps) => deps.rememberDeviceAddresses(),
  space: (deps) => deps.deleteLeftovers(),
};

/**
 * Makes one repair. The check is run again first (what was true a minute ago
 * may not be now) and again afterwards, so the answer says what actually happened.
 */
export async function repair(id, deps) {
  const entry = CHECKS.find(([checkId]) => checkId === id);
  const fix = REPAIRS[id];
  if (!entry || !fix) return { done: false, says: "Vox does not fix that by itself." };
  const before = await attempt(id, entry[1], () => entry[2](deps));
  if (before.kind !== "can_fix") return { done: false, says: before.kind === "fine" ? "That is already fine." : "That is no longer something Vox can fix by itself.", finding: before };
  try {
    await fix(deps);
  } catch (error) {
    return { done: false, says: "The fix did not work. Nothing else was changed.", detail: String(error?.message ?? error).slice(0, 200), finding: before };
  }
  const after = await attempt(id, entry[1], () => entry[2](deps));
  return { done: after.kind === "fine", says: after.kind === "fine" ? "Fixed." : "The fix ran, but the problem is still there.", finding: after };
}

/** Groups the app's error log (entries of "<ISO time> <kind>\n<text>\n\n") into faults from the last day. */
export function faultsFromLog(log, now) {
  const faults = new Map();
  for (const entry of String(log ?? "").split(/\n\n+/u)) {
    const match = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) ([^\n]+)\n?([\s\S]*)$/u.exec(entry.trim());
    if (!match) continue;
    const at = Date.parse(match[1]);
    if (!Number.isFinite(at) || now - at > 24 * 60 * 60_000 || at > now + 60_000) continue;
    const kind = match[2].replace(/ \(while closing\)$/u, "").slice(0, 60);
    const fault = faults.get(kind) ?? { kind, count: 0, sample: "" };
    fault.count += 1;
    // The first line only, and never anything that looks like a secret.
    fault.sample = match[3].split("\n")[0].replace(/(sk-|Bearer\s+|token[=:]\s*)[\w.-]+/giu, "$1…").slice(0, 160);
    faults.set(kind, fault);
  }
  return [...faults.values()];
}
