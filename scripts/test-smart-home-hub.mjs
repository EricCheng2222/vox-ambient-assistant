import assert from "node:assert/strict";
const { runSmartHomeCommand } = await import("../desktop/VoxDesktop/src/smart-home-hub.mjs");

const device = { adapter: "dyson-local", kind: "air-purifier", name: "Dyson", host: "192.168.50.20", serial: "X4Z-TW-SAA0804A", productType: "527", credential: "secret" };
const { SmartHomeConnectionError } = await import("../desktop/VoxDesktop/src/smart-home-errors.mjs");
const lost = new SmartHomeConnectionError("The Dyson purifier did not answer on the local network.");

// Where it was saved: one try, nothing looked up.
{
  const tried = [];
  const result = await runSmartHomeCommand(device, "turn it off", undefined, { run: async (d) => { tried.push(d.host); return { answer: "Off." }; }, discover: async () => assert.fail("no need to look") });
  assert.deepEqual([result.answer, tried], ["Off.", ["192.168.50.20"]]);
}
// It moved: found by its serial, the command goes to the new address, and the address is passed on to be saved.
{
  const tried = [];
  const moved = [];
  const result = await runSmartHomeCommand(device, "turn it off", (host) => moved.push(host), {
    run: async (d) => { tried.push(d.host); if (d.host === "192.168.50.20") throw lost; return { answer: "Off." }; },
    discover: async () => [{ host: "192.168.50.9", serial: "OTHER" }, { host: "192.168.50.126", serial: "X4Z-TW-SAA0804A" }],
  });
  assert.deepEqual([result.answer, tried, moved], ["Off.", ["192.168.50.20", "192.168.50.126"], ["192.168.50.126"]]);
}
// A persistent failure is bounded to two sessions, even if discovery misses the device.
await assert.rejects(runSmartHomeCommand(device, "x", undefined, { run: async () => { throw lost; }, discover: async () => [] }), /did not answer/u);
await assert.rejects(runSmartHomeCommand(device, "x", undefined, { run: async () => { throw lost; }, discover: async () => [{ host: device.host, serial: device.serial }] }), /did not answer/u);
// A refused credential is not a lost device: nothing is looked up.
await assert.rejects(runSmartHomeCommand(device, "x", undefined, { run: async () => { throw new Error("The purifier rejected its local device credential."); }, discover: async () => assert.fail("no need to look") }), /rejected/u);
console.log("smart home hub: ok");

// Transient failures recover at the same address, with or without multicast discovery.
for (const found of [[], [{ host: device.host, serial: device.serial }]]) {
  let attempts = 0;
  const result = await runSmartHomeCommand(device, "status", undefined, {
    run: async () => { if (++attempts === 1) throw lost; return { answer: "Recovered" }; },
    discover: async () => found, wait: async () => undefined,
  });
  assert.equal(result.answer, "Recovered");
  assert.equal(attempts, 2);
}
// A device's advertised topic can change without its IP changing.
{
  const changes = [];
  let attempts = 0;
  await runSmartHomeCommand({ ...device, productType: "527K" }, "status", (host, patch) => changes.push({ host, patch }), {
    run: async (d) => { if (++attempts === 1) throw lost; assert.equal(d.productType, "527"); return { host: d.host, productType: d.productType }; },
    discover: async () => [{ host: device.host, serial: device.serial, productType: "527" }], wait: async () => undefined,
  });
  assert.deepEqual(changes, [{ host: device.host, patch: { host: device.host, productType: "527" } }]);
}
// Never replay a possibly delivered command, regardless of discovery results.
await assert.rejects(runSmartHomeCommand(device, "turn it off", undefined, {
  run: async () => { throw new SmartHomeConnectionError("unconfirmed", { retrySafe: false }); },
  discover: async () => assert.fail("must not rediscover/replay a delivered action"),
}), /unconfirmed/u);
// The same recovery and serialization works for a future non-Dyson adapter, without serial numbers.
{
  const { createSmartHomeCommandRunner } = await import("../desktop/VoxDesktop/src/smart-home-hub.mjs");
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const runner = createSmartHomeCommandRunner(new Map([["lamp", {
    identity: d => d.hardwareId,
    discover: async () => [{ hardwareId: "lamp-one", host: "new-host" }],
    run: async (d, prompt) => {
      events.push(prompt);
      if (prompt === "first") await gate;
      if (prompt === "recover" && d.host === "old-host") throw lost;
      return { host: d.host };
    },
  }]]));
  const lamp = { adapter: "lamp", host: "old-host", hardwareId: "lamp-one" };
  const first = runner(lamp, "first");
  const second = runner(lamp, "second");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["first"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first", "second"]);
  assert.equal((await runner(lamp, "recover", undefined, { wait: async () => undefined })).host, "new-host");
}
