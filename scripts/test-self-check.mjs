import assert from "node:assert/strict";
const { runChecks, repair, summarise, faultsFromLog } = await import("../desktop/VoxDesktop/src/self-check.mjs");

const now = Date.UTC(2026, 9, 11, 9, 0);
const dyson = { name: "Dyson", serial: "X4Z", host: "192.168.50.20" };
function world(over = {}) {
  const state = { devices: [{ ...dyson }], seen: [{ serial: "X4Z", host: "192.168.50.20" }], leftovers: { files: 0, bytes: 0 }, freeGb: 40, calls: [], ...over };
  const deps = {
    now: () => now,
    signedIn: async () => state.signedIn ?? true,
    phoneLink: async () => state.phone ?? { paired: true, allowed: true, label: "iPhone" },
    planner: async () => state.planner ?? { installed: true, signedIn: true },
    homeDevices: async () => state.devices,
    devicesOnNetwork: async () => state.seen,
    disk: async () => ({ freeGb: state.freeGb, leftovers: state.leftovers }),
    recentFaults: async () => state.faults ?? [],
    versions: async () => state.versions ?? { running: "0.9.45", source: "0.9.45" },
    rememberDeviceAddresses: async () => { state.calls.push("remember"); for (const device of state.devices) device.host = state.seen.find((found) => found.serial === device.serial)?.host ?? device.host; },
    deleteLeftovers: async () => { state.calls.push("delete"); if (state.deleteFails) throw new Error("permission denied"); state.leftovers = { files: 0, bytes: 0 }; },
  };
  return { state, deps };
}
const kinds = (result) => Object.fromEntries(result.findings.map((item) => [item.id, item.kind]));

// All well.
{
  const result = await runChecks(world().deps);
  assert.ok(result.findings.every((item) => item.kind === "fine"));
  assert.equal(result.summary, "Everything checked is working.");
  assert.equal(result.checkedAt, now);
}
// Each kind of trouble lands in the right place, and what needs the user comes first.
{
  const result = await runChecks(world({
    signedIn: false,
    phone: { paired: true, allowed: false },
    planner: { installed: true, signedIn: false },
    seen: [{ serial: "X4Z", host: "192.168.50.126" }],
    leftovers: { files: 12, bytes: 6.4e9 },
    faults: [{ kind: "local planner", count: 3, sample: "The local planner took too long." }, { kind: "relay", count: 1, sample: "fetch failed" }],
    versions: { running: "0.9.44", source: "0.9.45" },
  }).deps);
  assert.deepEqual(kinds(result), { account: "needs_you", phone: "needs_you", planner: "needs_you", version: "needs_you", home: "can_fix", space: "can_fix", errors: "needs_change" });
  assert.deepEqual(result.findings.map((item) => item.kind), ["needs_you", "needs_you", "needs_you", "needs_you", "can_fix", "can_fix", "needs_change"]);
  assert.equal(result.summary, "4 things need you, 2 Vox can fix, 1 needs a change to Vox.");
  const by = Object.fromEntries(result.findings.map((item) => [item.id, item]));
  assert.match(by.home.says, /Dyson moved to a new address/u);
  assert.match(by.space.says, /6\.4 GB/u);
  assert.match(by.errors.says, /4 faults in the last day, most often in “local planner”/u);
  assert.match(by.errors.report, /3× local planner: The local planner took too long\./u);
  // What the user is to do is always said; what Vox would do, and how it is undone, too.
  for (const item of result.findings.filter((entry) => entry.kind === "needs_you")) assert.ok(item.how, item.id);
  for (const item of result.findings.filter((entry) => entry.kind === "can_fix")) assert.ok(item.fix && item.undo, item.id);
}
// A device that is off is the user's to see to; a missing planner is Vox's fault; little space with nothing to delete is the user's.
assert.equal(kinds(await runChecks(world({ seen: [] }).deps)).home, "needs_you");
assert.equal(kinds(await runChecks(world({ planner: { installed: false, signedIn: false } }).deps)).planner, "needs_change");
assert.equal(kinds(await runChecks(world({ freeGb: 3 }).deps)).space, "needs_you");
assert.equal(kinds(await runChecks(world({ leftovers: { files: 2, bytes: 2e8 } }).deps)).space, "fine", "a few small leftovers are not worth a notice");
assert.equal(kinds(await runChecks(world({ phone: { paired: false, allowed: false } }).deps)).phone, "fine");
// A check that fails is "could not be checked", and the rest still run.
{
  const w = world();
  w.deps.disk = async () => { throw new Error("no such volume"); };
  const result = await runChecks(w.deps);
  assert.equal(kinds(result).space, "unknown");
  assert.equal(result.summary, "1 could not be checked.");
  assert.equal(result.findings.filter((item) => item.kind === "fine").length, 6);
}

// Repairs: only the listed ones, only when still needed, and checked afterwards.
{
  const w = world({ seen: [{ serial: "X4Z", host: "192.168.50.126" }] });
  const fixed = await repair("home", w.deps);
  assert.deepEqual([fixed.done, fixed.says, fixed.finding.kind], [true, "Fixed.", "fine"]);
  assert.equal(w.state.devices[0].host, "192.168.50.126");
  // Asked again, there is nothing to do, and nothing is done.
  const again = await repair("home", w.deps);
  assert.deepEqual([again.done, again.says], [false, "That is already fine."]);
  assert.deepEqual(w.state.calls, ["remember"]);
}
{
  const w = world({ leftovers: { files: 12, bytes: 6.4e9 }, deleteFails: true });
  const failed = await repair("space", w.deps);
  assert.deepEqual([failed.done, failed.says], [false, "The fix did not work. Nothing else was changed."]);
}
for (const id of ["account", "phone", "planner", "errors", "version", "nonsense"]) {
  const w = world({ signedIn: false });
  assert.equal((await repair(id, w.deps)).done, false, id);
  assert.deepEqual(w.state.calls, [], `${id}: nothing was touched`);
}
assert.equal(summarise([]), "Everything checked is working.");

// The error log, read into faults: the last day only, grouped, secrets kept out.
{
  const log = [
    `${new Date(now - 60_000).toISOString()} local planner\nError: The local planner took too long.\n    at next (file.mjs:1:1)`,
    `${new Date(now - 120_000).toISOString()} local planner (while closing)\nError: The local planner was stopped.`,
    `${new Date(now - 3_600_000).toISOString()} relay\nError: request failed with Bearer abc.def-123 for token=xyz987`,
    `${new Date(now - 3 * 24 * 3_600_000).toISOString()} old thing\nError: long ago`,
    "garbage that is not an entry",
  ].join("\n\n");
  const faults = faultsFromLog(log, now);
  assert.deepEqual(faults.map((fault) => [fault.kind, fault.count]), [["local planner", 2], ["relay", 1]]);
  assert.ok(!/abc\.def|xyz987/u.test(JSON.stringify(faults)));
  assert.deepEqual(faultsFromLog("", now), []);
}
console.log("self check: ok");
