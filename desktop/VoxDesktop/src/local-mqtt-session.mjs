import mqtt from "mqtt";

import { SmartHomeConnectionError } from "./smart-home-errors.mjs";

/** One bounded MQTT session. Error/close listeners remain active until disposal. */
export async function openLocalMqttSession({ host, options, label, connect = mqtt.connect, timeoutMs = 7_000 }) {
  let client;
  let closing = false;
  let commandSent = false;
  let failure;
  let rejectFailure;
  const failed = new Promise((_, reject) => { rejectFailure = reject; });
  // A failure can arrive between operations; retain it without an unhandled rejection.
  void failed.catch(() => undefined);
  const fail = (cause) => {
    if (closing || failure) return;
    const credential = [4, 5].includes(cause?.code) || /not authorized|bad user|bad password/iu.test(cause?.message ?? "");
    const protocol = cause?.code === 1;
    const denied = ["EACCES", "EPERM"].includes(cause?.code);
    const reset = cause?.code === "ECONNRESET" || cause?.code === "MQTT_CLOSED";
    failure = new SmartHomeConnectionError(
      credential ? `${label} rejected its local device credential.`
        : denied ? `Local network access to ${label} was denied on this Mac.`
          : protocol ? `${label} rejected the MQTT protocol version.`
            : commandSent ? `${label}'s local connection closed after the command was sent; its updated state is unconfirmed.`
              : reset ? `${label} closed the local control connection.`
                : `Vox could not connect to ${label} on the local network.`,
      { kind: credential ? "credential" : denied ? "permission" : protocol ? "protocol" : "connection", retryable: !credential && !denied, retrySafe: !commandSent, cause },
    );
    rejectFailure(failure);
  };
  const onClose = () => fail(Object.assign(new Error("MQTT closed"), { code: "MQTT_CLOSED" }));
  const bounded = async (operation, milliseconds = timeoutMs) => {
    // Operations may already have started when a socket fails between calls.
    // Observe their eventual rejection even when the retained failure wins.
    void Promise.resolve(operation).catch(() => undefined);
    if (failure) throw failure;
    let timer;
    try {
      return await Promise.race([
        operation,
        failed,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new SmartHomeConnectionError(
            commandSent ? `${label}'s updated state is unconfirmed after the command was sent.` : `${label} did not answer on the local network.`,
            { kind: "timeout", retrySafe: !commandSent },
          )), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const dispose = async () => {
    closing = true;
    if (!client) return;
    // A broken broker must not leave the command or per-device queue hanging.
    await new Promise((resolve) => {
      const timer = setTimeout(() => { client.stream?.destroy(); resolve(); }, 1_000);
      client.end(true, {}, () => { clearTimeout(timer); resolve(); });
    });
    client.off("close", onClose);
    // Keep the error listener for any late socket error during destruction.
  };
  try {
    client = connect(`mqtt://${host}:1883`, options);
    client.on("error", fail);
    client.on("close", onClose);
    await bounded(new Promise((resolve) => client.once("connect", resolve)));
    return { client, bounded, dispose, markCommandSent: () => { commandSent = true; } };
  } catch (error) {
    await dispose();
    throw error;
  }
}
