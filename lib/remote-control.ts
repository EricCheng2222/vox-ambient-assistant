export type RemoteMacCommand =
  | {
      kind: "desktop_control";
      taskId?: string;
      prompt: string;
      appId: string;
      intent: "launch" | "interact";
      mode: "fast" | "standard";
    }
  | { kind: "open_workspace" }
  | { kind: "smart_home"; prompt: string; deviceId?: string }
  | { kind: "phone_mac"; prompt: string }
  | { kind: "local_codex"; prompt: string; taskId?: string }
  // The websites signed in on the Mac, used from the phone or tablet.
  | { kind: "browser"; op: "look"; open?: string }
  | { kind: "browser"; op: "act"; request: { ref?: number; action: string; text?: string } }
  // The private box, filled in on the phone: values travel encrypted with the pairing key.
  | { kind: "browser"; op: "fill"; entries: Array<{ ref: number; value?: string; saved?: boolean }>; remember: boolean }
  | { kind: "browser"; op: "saved"; refs: number[] }
  // The Mac's page as a picture, with what the user did on that picture (positions are fractions of its size).
  | { kind: "browser"; op: "view"; input?: RemotePageInput; size?: [number, number] }
  // A whole website task the Mac carries out by itself, so it survives the phone being put away.
  | { kind: "browser_task"; taskId: string; goal: string; context?: string; url?: string; approval: string; language: string }
  | { kind: "web_accounts"; checks: Array<{ id: string; domains: string[]; cookies: string[] }> };

/** What the user does on the picture of the Mac's page: their own taps, drags, typing and keys. */
export type RemotePageInput =
  | { type: "tap"; x: number; y: number }
  | { type: "drag"; from: [number, number]; to: [number, number] }
  | { type: "text"; text: string }
  | { type: "key"; key: "Enter" | "Backspace" | "Tab" | "Escape" }
  | { type: "scroll"; down: boolean };

export type RemotePageView = { image: string; width: number; height: number; url: string; title: string };

export type StoredRemoteMacPairing = {
  deviceId: string;
  name: string;
  secret: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function claimText(deviceId: string, claimId: string, label: string) {
  return `vox-pair-claim-v1\n${deviceId}\n${claimId}\n${label}`;
}

function associatedData(deviceId: string, commandId: string, purpose: "command" | "result" | "progress") {
  return encoder.encode(`vox-remote-${purpose}-v1:${deviceId}:${commandId}`);
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function aesKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(secret),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function createPairingProof(
  secret: string,
  deviceId: string,
  claimId: string,
  label: string,
) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(claimText(deviceId, claimId, label)),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function encryptRemoteCommand(
  pairing: StoredRemoteMacPairing,
  commandId: string,
  command: RemoteMacCommand,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const now = Date.now();
  const plaintext = encoder.encode(JSON.stringify({
    version: 1,
    commandId,
    nonce: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + 2 * 60_000,
    command,
  }));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: associatedData(pairing.deviceId, commandId, "command"),
    },
    await aesKey(pairing.secret),
    plaintext,
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

export async function decryptRemoteResult(
  pairing: StoredRemoteMacPairing,
  commandId: string,
  ciphertext: string,
  iv: string,
) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(iv),
      additionalData: associatedData(pairing.deviceId, commandId, "result"),
    },
    await aesKey(pairing.secret),
    base64UrlToBytes(ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as {
    ok: boolean;
    answer?: string;
    error?: string;
    events?: unknown[];
  };
}

/** Progress cannot be substituted for a result or replayed for another command. */
export async function decryptRemoteTaskProgress(pairing: StoredRemoteMacPairing, commandId: string, ciphertext: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: base64UrlToBytes(iv), additionalData: associatedData(pairing.deviceId, commandId, "progress"),
  }, await aesKey(pairing.secret), base64UrlToBytes(ciphertext));
  const payload = JSON.parse(decoder.decode(plaintext)) as { version?: number; events?: unknown };
  return payload.version === 1 && Array.isArray(payload.events) ? payload.events.slice(-12) : [];
}
