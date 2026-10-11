import assert from "node:assert/strict";
import net from "node:net";
import { createRequire } from "node:module";
import { runDysonCommand } from "../desktop/VoxDesktop/src/dyson-local.mjs";
const require = createRequire(new URL("../desktop/VoxDesktop/package.json", import.meta.url));
const mqtt = require("mqtt");
const packet = require("mqtt-packet");
const device = { name: "Test purifier", host: "127.0.0.1", serial: "ABC-TW-12345678", productType: "527K", credential: "test-local-credential" };

async function withBroker(mode, check) {
  const sockets = new Set();
  const observed = { versions: [], commands: [] };
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    const parser = packet.parser();
    const send = value => { if (!socket.destroyed) socket.write(packet.generate(value)); };
    const state = { fpwr: "OFF", fnsp: "0001", nmod: "OFF" };
    const report = () => send({ cmd: "publish", topic: `527/${device.serial}/status/current`, payload: JSON.stringify({ msg: "CURRENT-STATE", "product-state": state }), qos: 0, retain: false, dup: false });
    parser.on("packet", message => {
      if (message.cmd === "connect") {
        observed.versions.push(message.protocolVersion);
        if (mode === "legacy" && message.protocolVersion === 4) return socket.destroy();
        send({ cmd: "connack", returnCode: mode === "auth" ? 5 : 0, sessionPresent: false });
      }
      if (message.cmd === "subscribe" && mode !== "no-suback") send({ cmd: "suback", messageId: message.messageId, granted: message.subscriptions.map(() => 0) });
      if (message.cmd === "publish") {
        const body = JSON.parse(message.payload);
        observed.commands.push(body.msg);
        if (body.msg === "STATE-SET" && mode === "drop-after-send") return socket.destroy();
        if (message.qos === 1) send({ cmd: "puback", messageId: message.messageId });
        if (body.msg === "STATE-SET") {
          if (mode !== "wrong-state") Object.assign(state, body.data);
          report();
        }
        if (body.msg === "REQUEST-CURRENT-STATE" && message.topic.startsWith("527/") && mode !== "no-state") report();
      }
    });
    parser.on("error", () => socket.destroy());
    socket.on("data", data => parser.parse(data));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const deps = {
    connect: (_url, options) => mqtt.connect(`mqtt://127.0.0.1:${server.address().port}`, options),
    timeoutMs: 180, stateTimeoutMs: 50, commandTimeoutMs: 50, sensorWaitMs: 0,
  };
  try { await check(deps, observed); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}

// Real MQTT packets exercise protocol fallback and the advertised base topic.
await withBroker("legacy", async (deps, observed) => {
  const result = await runDysonCommand(device, "status", deps);
  assert.deepEqual(observed.versions, [4, 3]);
  assert.equal(result.connected, true);
  assert.equal(result.productType, "527");
  assert.equal(result.powered, false);
});
// Successful changes need the requested state, not merely another state revision.
await withBroker("normal", async deps => {
  const result = await runDysonCommand(device, "turn the purifier on", deps);
  assert.equal(result.verified, true);
  assert.equal(result.powered, true);
});
await withBroker("wrong-state", async deps => {
  const result = await runDysonCommand(device, "turn the purifier on", deps);
  assert.equal(result.verified, false);
  assert.equal(result.powered, false);
  assert.match(result.answer, /could not verify/u);
});
// Neither a broker handshake nor discovery alone is a successful status read.
await withBroker("no-state", async deps => {
  await assert.rejects(runDysonCommand(device, "status", deps), /did not answer the device state/u);
});
await withBroker("no-suback", async deps => {
  await assert.rejects(runDysonCommand(device, "status", deps), error => error.kind === "timeout" && error.retrySafe);
});
// Authentication failures do not negotiate another protocol or reconnect blindly.
await withBroker("auth", async (deps, observed) => {
  await assert.rejects(runDysonCommand(device, "status", deps), error => error.kind === "credential" && !error.retryable);
  assert.deepEqual(observed.versions, [4]);
});
// A drop after sending an action keeps the uncertainty and blocks automatic replay.
await withBroker("drop-after-send", async deps => {
  await assert.rejects(runDysonCommand(device, "turn the purifier on", deps), error => error.retrySafe === false && /unconfirmed/u.test(error.message));
});
console.log("Smart-home transport and device verification: ok");
