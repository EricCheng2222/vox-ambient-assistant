import assert from "node:assert/strict";
const { runSmartHomeCommand } = await import("../desktop/VoxDesktop/src/smart-home-hub.mjs");

const device = { adapter: "dyson-local", kind: "air-purifier", name: "Dyson", host: "192.168.50.20", serial: "X4Z-TW-SAA0804A", productType: "527", credential: "secret" };
const lost = new Error("The Dyson purifier did not answer on the local network.");

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
// Not on the network, or still at the same address: the first failure stands.
await assert.rejects(runSmartHomeCommand(device, "x", undefined, { run: async () => { throw lost; }, discover: async () => [] }), /did not answer/u);
await assert.rejects(runSmartHomeCommand(device, "x", undefined, { run: async () => { throw lost; }, discover: async () => [{ host: device.host, serial: device.serial }] }), /did not answer/u);
// A refused credential is not a lost device: nothing is looked up.
await assert.rejects(runSmartHomeCommand(device, "x", undefined, { run: async () => { throw new Error("The purifier rejected its local device credential."); }, discover: async () => assert.fail("no need to look") }), /rejected/u);
console.log("smart home hub: ok");
