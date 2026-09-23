export type RemoteMacCommand =
  | {
      kind: "desktop_control";
      prompt: string;
      appId: string;
      intent: "launch" | "interact";
      mode: "fast" | "standard";
    }
  | { kind: "open_workspace" }
  | { kind: "smart_home"; prompt: string; deviceId?: string }
  | { kind: "local_codex"; prompt: string };

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

function associatedData(deviceId: string, commandId: string, purpose: "command" | "result") {
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
  };
}
