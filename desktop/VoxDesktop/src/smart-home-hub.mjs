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

/**
 * Runs a command on a saved device. Routers hand out new addresses, so a
 * device saved months ago may no longer be where it was: when it does not
 * answer there, it is looked for on the network by its serial number and the
 * command is tried once more at the address it has now. `onMoved(host)` is
 * told, so the new address can be saved. `deps` is for tests.
 */
export async function runSmartHomeCommand(device, prompt, onMoved, deps = {}) {
  const { adapter } = adapterFor(device?.adapter);
  const run = deps.run ?? adapter.run;
  const discover = deps.discover ?? adapter.discover;
  try {
    return await run(device, prompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // A refused credential or a command it did not understand is not a lost device.
    if (!/could not connect|did not answer/iu.test(message) || !device?.serial) throw error;
    const found = (await discover(4_000).catch(() => [])).find((candidate) => candidate.serial === device.serial);
    if (!found?.host || found.host === device.host) throw error;
    const result = await run({ ...device, host: found.host }, prompt);
    await Promise.resolve(onMoved?.(found.host)).catch(() => undefined);
    return result;
  }
}

export function publicSmartHomeDevice(device) {
  if (!device || typeof device !== "object") return null;
  const { adapter, kind, name, host, serial, productType } = device;
  if (![adapter, kind, name, host, serial, productType].every((value) => typeof value === "string" && value)) {
    return null;
  }
  return { adapter, kind, name, host, serial, productType };
}
