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
    identity: (device) => device.serial,
    discoveryPatch: (found) => ({ host: found.host, ...(found.productType ? { productType: found.productType } : {}) }),
    resultPatch: (result) => ({ host: result.host, productType: result.productType }),
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

/** Shared recovery/serialization boundary; adapters own identity and connection fields. */
export function createSmartHomeCommandRunner(registry) {
  const pending = new Map();
  return async function runCommand(device, prompt, onMoved, deps = {}) {
    const adapter = registry.get(device?.adapter);
    if (!adapter) throw new Error("That smart-home device adapter is not available yet.");
    const identity = adapter.identity?.(device);
    const key = `${device.adapter}:${identity || device.id || device.host}`;
    const previous = pending.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      const run = deps.run ?? adapter.run;
      const discover = deps.discover ?? adapter.discover;
      let connection = device;
      let result;
      try {
        result = await run(connection, prompt);
      } catch (error) {
        // Adapters must explicitly mark both transience and safety to retry.
        if (!error?.retryable || !error?.retrySafe) throw error;
        const found = identity && discover
          ? (await discover(4_000).catch(() => [])).find((candidate) => adapter.identity(candidate) === identity)
          : undefined;
        if (found?.host) connection = { ...device, ...(adapter.discoveryPatch?.(found) ?? { host: found.host }) };
        // Multicast discovery can miss a reachable device. A fresh session at the
        // saved address is still worth one attempt, including when the IP is unchanged.
        await (deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(300);
        result = await run(connection, prompt);
      }
      const patch = adapter.resultPatch?.(result) ?? { host: connection.host };
      const host = patch.host ?? connection.host;
      const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
      if (host !== device.host || Object.entries(changes).some(([field, value]) => device[field] !== value)) {
        await Promise.resolve(onMoved?.(host, changes)).catch(() => undefined);
      }
      return result;
    });
    pending.set(key, task);
    try { return await task; }
    finally { if (pending.get(key) === task) pending.delete(key); }
  };
}

export const runSmartHomeCommand = createSmartHomeCommandRunner(adapters);

export function publicSmartHomeDevice(device) {
  if (!device || typeof device !== "object") return null;
  const { adapter, kind, name, host, serial, productType } = device;
  if (![adapter, kind, name, host, serial, productType].every((value) => typeof value === "string" && value)) {
    return null;
  }
  return { adapter, kind, name, host, serial, productType };
}
