import {
  configureDysonDevice,
  discoverDysonPurifiers,
  runDysonCommand,
} from "./dyson-local.mjs";

const adapters = new Map([
  ["dyson-local", {
    kind: "air-purifier",
    label: "Dyson purifier",
    configure: configureDysonDevice,
    discover: discoverDysonPurifiers,
    run: runDysonCommand,
  }],
]);

function adapterFor(value) {
  const id = typeof value === "string" ? value : "";
  const adapter = adapters.get(id);
  if (!adapter) throw new Error("That smart-home device adapter is not available yet.");
  return { id, adapter };
}

export function availableSmartHomeAdapters() {
  return [...adapters.entries()].map(([id, adapter]) => ({
    id,
    kind: adapter.kind,
    label: adapter.label,
  }));
}

export function configureSmartHomeDevice(raw) {
  const { id, adapter } = adapterFor(raw?.adapter ?? "dyson-local");
  return {
    adapter: id,
    kind: adapter.kind,
    ...adapter.configure(raw),
  };
}

export async function discoverSmartHomeDevices(adapterId = "dyson-local") {
  const { id, adapter } = adapterFor(adapterId);
  const devices = await adapter.discover();
  return devices.map((device) => ({ adapter: id, kind: adapter.kind, ...device }));
}

export async function runSmartHomeCommand(device, prompt) {
  const { adapter } = adapterFor(device?.adapter);
  return adapter.run(device, prompt);
}

export function publicSmartHomeDevice(device) {
  if (!device || typeof device !== "object") return null;
  const { adapter, kind, name, host, serial, productType } = device;
  if (![adapter, kind, name, host, serial, productType].every((value) => typeof value === "string" && value)) {
    return null;
  }
  return { adapter, kind, name, host, serial, productType };
}
