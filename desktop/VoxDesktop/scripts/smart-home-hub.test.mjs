import test from "node:test";
import assert from "node:assert/strict";
import {
  availableSmartHomeAdapters,
  configureSmartHomeDevice,
  publicSmartHomeDevice,
} from "../src/smart-home-hub.mjs";

test("the hub exposes adapters without exposing their implementation", () => {
  assert.deepEqual(availableSmartHomeAdapters(), [{
    id: "dyson-local",
    kind: "air-purifier",
    label: "Dyson purifier",
  }]);
});

test("the public device shape never includes a credential", () => {
  const device = configureSmartHomeDevice({
    adapter: "dyson-local",
    method: "manual",
    name: "Living room",
    host: "192.168.1.20",
    serial: "ABC-TW-12345678",
    productType: "438K",
    credential: "local-device-credential-value",
  });
  assert.equal(device.adapter, "dyson-local");
  assert.equal(device.kind, "air-purifier");
  assert.equal(Object.hasOwn(publicSmartHomeDevice(device), "credential"), false);
});
