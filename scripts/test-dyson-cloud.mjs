import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import { createDysonCloudClient, dysonCloudMqttConfiguration, runDysonCloudCommand } from "../desktop/VoxDesktop/src/dyson-cloud.mjs";
import { createSmartHomeCommandRunner, publicSmartHomeDevice } from "../desktop/VoxDesktop/src/smart-home-hub.mjs";
import { SmartHomeConnectionError } from "../desktop/VoxDesktop/src/smart-home-errors.mjs";
import { createDysonLoginSessions } from "../desktop/VoxDesktop/src/dyson-login-sessions.mjs";
const require = createRequire(new URL("../desktop/VoxDesktop/package.json", import.meta.url));
const mqtt = require("mqtt");
const packet = require("mqtt-packet");
const { WebSocketServer } = require("ws");
const device = { adapter: "dyson-local", kind: "air-purifier", name: "Test purifier", host: "127.0.0.1", serial: "ABC-TW-12345678", productType: "527", credential: "test-local-credential", cloudToken: "test-account-session", cloudRegion: "global" };
const iot = { Endpoint: "test-ats.iot.eu-west-1.amazonaws.com", IoTCredentials: { ClientId: "test-client", CustomAuthorizerName: "test-authorizer", TokenKey: "dyson-token", TokenValue: "test-value", TokenSignature: "test-signature" } };

// A stolen, cancelled, expired or concurrently reused challenge cannot link an account.
let sessionTime = 0;
const sessions = createDysonLoginSessions({ now: () => sessionTime });
const details = { senderId: 7, deviceId: "test-device", serial: device.serial };
const first = sessions.start(details).challengeId;
assert.throws(() => sessions.acquire(first, 8), /expired/u);
const active = sessions.acquire(first, 7);
assert.throws(() => sessions.acquire(first, 7), /already/u);
sessions.cancel(first, 8);
sessions.assertActive(first, active);
sessions.cancel(first, 7);
assert.throws(() => sessions.assertActive(first, active), /cancelled/u);
const second = sessions.start(details).challengeId;
for (let attempt = 0; attempt < 3; attempt++) sessions.release(second, sessions.acquire(second, 7));
assert.throws(() => sessions.acquire(second, 7), /expired/u);
const third = sessions.start(details).challengeId;
sessionTime = 600_001;
assert.throws(() => sessions.acquire(third, 7), /expired/u);
const fourth = sessions.start(details).challengeId;
const completing = sessions.acquire(fourth, 7);
sessions.cancelDevice(details.deviceId);
assert.throws(() => sessions.consume(fourth, completing), /cancelled/u);
const fifth = sessions.start(details).challengeId;
sessions.consume(fifth, sessions.acquire(fifth, 7));
assert.throws(() => sessions.acquire(fifth, 7), /expired/u);

const cipher = createCipheriv("aes-256-cbc", Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)), Buffer.alloc(16));
const encrypted = Buffer.concat([cipher.update(JSON.stringify({ serial: device.serial, apPasswordHash: device.credential })), cipher.final()]).toString("base64");
const calls = [];
const replies = [{ accountStatus: "ACTIVE" }, { challengeId: "12345678-1234-1234-1234-123456789abc" }, { token: device.cloudToken }, [{ serialNumber: device.serial, connectedConfiguration: { mqtt: { localBrokerCredentials: encrypted, mqttRootTopicLevel: "527" } } }], iot];
const cloud = createDysonCloudClient({ fetch: async (url, options) => { calls.push({ url, options }); return Response.json(replies.shift()); } });
const challenge = await cloud.beginLogin({ email: "test@example.test" });
const account = await cloud.completeLogin(challenge, { code: "123456", password: "test-account-password" });
assert.deepEqual(await cloud.deviceConfiguration(account, device.serial), { credential: device.credential, productType: "527" });
assert.deepEqual(await cloud.iotCredentials(account, device.serial), iot);
assert.equal(calls[2].options.body.includes('"password":"test-account-password"'), true);
assert.equal(calls[3].options.headers.Authorization, `Bearer ${device.cloudToken}`);
assert.deepEqual(JSON.parse(calls[4].options.body), { Serial: device.serial });
assert.equal(calls.every(call => new URL(call.url).origin === "https://appapi.cp.dyson.com" && call.options.redirect === "error"), true);
await assert.rejects(createDysonCloudClient({ fetch: async () => new Response("test-account-password test-account-session", { status: 401 }) }).iotCredentials(account, device.serial), error => error.kind === "credential" && !/test-account/u.test(error.message));
await assert.rejects(cloud.beginLogin({ email: "invalid" }), /email/u);
await assert.rejects(createDysonCloudClient({ fetch: async () => Response.json([]) }).deviceConfiguration(account, device.serial), /does not list/u);
assert.throws(() => dysonCloudMqttConfiguration({ ...iot, Endpoint: "attacker.example" }), /unsupported cloud broker/u);
assert.throws(() => dysonCloudMqttConfiguration({ ...iot, IoTCredentials: { ...iot.IoTCredentials, TokenSignature: "bad\r\nheader" } }), /valid cloud broker credentials/u);
const socketOptions = dysonCloudMqttConfiguration(iot);
assert.equal(socketOptions.options.protocolVersion, 4);
assert.equal(socketOptions.options.wsOptions.headers["X-Amz-CustomAuthorizer-Signature"], "test-signature");
assert.equal(publicSmartHomeDevice(device).cloudConnected, true);
assert.equal(Object.hasOwn(publicSmartHomeDevice(device), "cloudToken"), false);

// Actual WebSocket/MQTT packets verify authentication headers, AWS's 'mqtt'
// subprotocol, state/commands, and DISCONNECT on healthy teardown.
const sockets = new Set();
let resolveDisconnect;
const disconnected = new Promise(resolve => { resolveDisconnect = resolve; });
const server = http.createServer();
const websocketServer = new WebSocketServer({ server, handleProtocols: protocols => { assert.equal(protocols.has("mqtt"), true); return "mqtt"; } });
websocketServer.on("connection", (socket, request) => {
  assert.equal(request.headers["dyson-token"], "test-value");
  assert.equal(request.headers["x-amz-customauthorizer-name"], "test-authorizer");
  assert.equal(request.headers["x-amz-customauthorizer-signature"], "test-signature");
  sockets.add(socket);
  socket.on("error", () => undefined);
  socket.on("close", () => sockets.delete(socket));
  const parser = packet.parser();
  const send = value => socket.send(packet.generate(value));
  const state = { fpwr: "OFF", fnsp: "0002" };
  const report = () => send({ cmd: "publish", topic: `527/${device.serial}/status/current`, payload: JSON.stringify({ msg: "CURRENT-STATE", "product-state": state }), qos: 0, retain: false, dup: false });
  parser.on("packet", message => {
    if (message.cmd === "connect") { assert.equal(message.protocolVersion, 4); assert.equal(message.clientId, "test-client"); assert.equal(message.username, undefined); send({ cmd: "connack", returnCode: 0, sessionPresent: false }); }
    if (message.cmd === "subscribe") send({ cmd: "suback", messageId: message.messageId, granted: message.subscriptions.map(() => 0) });
    if (message.cmd === "publish") {
      const body = JSON.parse(message.payload);
      if (message.qos === 1) send({ cmd: "puback", messageId: message.messageId });
      if (body.msg === "STATE-SET") { Object.assign(state, body.data); report(); }
      if (body.msg === "REQUEST-CURRENT-STATE") report();
    }
    if (message.cmd === "disconnect") { resolveDisconnect(); socket.close(); }
  });
  parser.on("error", () => socket.terminate());
  socket.on("message", data => parser.parse(data));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const result = await runDysonCloudCommand(device, "turn the purifier on", {
    cloud: { iotCredentials: async (passed, serial) => { assert.equal(passed.token, device.cloudToken); assert.equal(serial, device.serial); return iot; } },
    connect: (url, options) => { assert.equal(url, socketOptions.url); assert.deepEqual(options.wsOptions.headers, socketOptions.options.wsOptions.headers); return mqtt.connect(`ws://127.0.0.1:${server.address().port}/mqtt`, options); },
    stateTimeoutMs: 100, commandTimeoutMs: 100, timeoutMs: 300,
  });
  assert.equal(result.transport, "cloud"); assert.equal(result.verified, true); assert.equal(result.powered, true);
  let timer;
  try { await Promise.race([disconnected, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Broker did not receive DISCONNECT")), 300); })]); }
  finally { clearTimeout(timer); }
} finally { for (const socket of sockets) socket.terminate(); await new Promise(resolve => websocketServer.close(resolve)); await new Promise(resolve => server.close(resolve)); }

// This recovery boundary applies to future devices too. Successful fallback is
// preferred temporarily; uncertain writes are never sent on another transport.
let localCalls = 0, fallbackCalls = 0, now = 0;
const registry = new Map([["future-lamp", { identity: d => d.hardwareId, canFallback: d => Boolean(d.account), run: async () => { localCalls++; throw new SmartHomeConnectionError("offline"); }, runFallback: async () => { fallbackCalls++; return { connected: true, host: "lamp.local" }; } }]]);
const run = createSmartHomeCommandRunner(registry);
const lamp = { adapter: "future-lamp", hardwareId: "lamp-1", account: true, host: "lamp.local" };
await run(lamp, "on", undefined, { now: () => now });
await run(lamp, "off", undefined, { now: () => now });
assert.equal(localCalls, 1); assert.equal(fallbackCalls, 2);
now = 300_001;
await run(lamp, "on", undefined, { now: () => now });
assert.equal(localCalls, 2); assert.equal(fallbackCalls, 3);
await assert.rejects(createSmartHomeCommandRunner(new Map([["future-lamp", { ...registry.get("future-lamp"), run: async () => { throw new SmartHomeConnectionError("unconfirmed", { retrySafe: false }); } }]]))(lamp, "on"), /unconfirmed/u);
assert.equal(fallbackCalls, 3);
const unsafeCloud = createSmartHomeCommandRunner(new Map([["future-lamp", { ...registry.get("future-lamp"), runFallback: async () => { fallbackCalls++; if (fallbackCalls > 4) throw new SmartHomeConnectionError("cloud unconfirmed", { retrySafe: false }); return { connected: true }; } }]]));
await unsafeCloud(lamp, "on");
const beforeLocal = localCalls;
await assert.rejects(unsafeCloud(lamp, "off"), /cloud unconfirmed/u);
assert.equal(localCalls, beforeLocal);
assert.equal(fallbackCalls, 5);
let fallbackHealthy = true, localHealthy = false, cloudAttempts = 0;
const recover = createSmartHomeCommandRunner(new Map([["future-lamp", {
  ...registry.get("future-lamp"),
  run: async () => { if (!localHealthy) throw new SmartHomeConnectionError("local offline"); return { connected: true }; },
  runFallback: async () => { cloudAttempts++; if (!fallbackHealthy) throw new SmartHomeConnectionError("account expired", { kind: "credential", retryable: false }); return { connected: true }; },
}]]));
await recover(lamp, "on");
fallbackHealthy = false;
await assert.rejects(recover(lamp, "off"), /account expired/u);
assert.equal(cloudAttempts, 2); // An expired account is not requested twice.
fallbackHealthy = true;
await recover(lamp, "on");
fallbackHealthy = false; localHealthy = true;
assert.equal((await recover(lamp, "off")).connected, true);
console.log("Dyson cloud authentication, verified commands, graceful disconnect, and general fallback: ok");
