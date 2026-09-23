import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveDysonStickerConfiguration,
  dysonMqttOptions,
  normalizeDysonManualConfiguration,
  parseDysonServiceName,
  parseDysonCommand,
} from "../src/dyson-local.mjs";

test("sticker setup derives the MQTT identity without retaining the Wi-Fi code", () => {
  const result = deriveDysonStickerConfiguration({
    name: "Living Room",
    host: "192.168.1.20",
    wifiSsid: "DYSON-ABC-TW-12345678-438K",
    wifiPassword: "sticker-code-secret",
  });
  assert.deepEqual(Object.keys(result).sort(), ["credential", "host", "name", "productType", "serial"]);
  assert.equal(result.serial, "ABC-TW-12345678");
  assert.equal(result.productType, "438K");
  assert.equal(result.credential.length, 88);
  assert.equal(JSON.stringify(result).includes("sticker-code-secret"), false);
  assert.notEqual(result.credential, "sticker-code-secret");
});

test("manual setup normalizes safe local connection values", () => {
  assert.deepEqual(normalizeDysonManualConfiguration({
    name: " Bedroom ",
    host: "DYSON-PURIFIER.LOCAL.",
    serial: "abc-tw-12345678",
    productType: "455A",
    credential: "local-device-credential-value",
  }), {
    name: "Bedroom",
    host: "dyson-purifier.local",
    serial: "ABC-TW-12345678",
    productType: "455",
    credential: "local-device-credential-value",
  });
});

test("local control uses MQTT 3.1.1 for current Dyson brokers", () => {
  const options = dysonMqttOptions({
    serial: "ABC-TW-12345678",
    credential: "local-device-credential-value",
  });
  assert.equal(options.protocolVersion, 4);
  assert.equal(options.username, "ABC-TW-12345678");
  assert.equal(options.password, "local-device-credential-value");
  assert.equal(options.clean, true);
  assert.equal(options.reconnectPeriod, 0);
  assert.match(options.clientId, /^vox-[0-9a-f]{18}$/u);
});

test("voice commands stay inside the supported purifier action set", () => {
  assert.deepEqual(parseDysonCommand("Turn the Dyson purifier off"), { kind: "power", enabled: false });
  assert.deepEqual(parseDysonCommand("把戴森清淨機風速調到 7"), { kind: "speed", speed: 7 });
  assert.deepEqual(parseDysonCommand("幫我把風速調成三好嗎"), { kind: "speed", speed: 3 });
  assert.deepEqual(parseDysonCommand("戴森調到十檔"), { kind: "speed", speed: 10 });
  assert.deepEqual(parseDysonCommand("開啟自動模式"), { kind: "auto", enabled: true });
  assert.deepEqual(parseDysonCommand("關掉夜間模式"), { kind: "night", enabled: false });
  assert.deepEqual(parseDysonCommand("Dyson air quality status"), { kind: "status" });
  assert.throws(() => parseDysonCommand("Reset the Dyson filter"), /Try power/u);
});

test("Bonjour service names reveal only validated Dyson identity fields", () => {
  assert.deepEqual(parseDysonServiceName("527_ABC-TW-12345678"), {
    productType: "527",
    serial: "ABC-TW-12345678",
  });
  assert.deepEqual(parseDysonServiceName("not-a-dyson-service"), {});
});
