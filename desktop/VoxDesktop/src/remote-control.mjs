import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function decode(value) {
  return Buffer.from(value, "base64url");
}

function claimText(deviceId, claimId, label) {
  return `vox-pair-claim-v1\n${deviceId}\n${claimId}\n${label}`;
}

function associatedData(deviceId, commandId, purpose) {
  return Buffer.from(`vox-remote-${purpose}-v1:${deviceId}:${commandId}`, "utf8");
}

export function verifyPairingClaim(secret, input) {
  const expected = createHmac("sha256", decode(secret))
    .update(claimText(input.deviceId, input.claimId, input.label))
    .digest();
  const received = decode(input.proof);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function decrypt(secret, deviceId, commandId, ciphertext, iv, purpose) {
  const encrypted = decode(ciphertext);
  if (encrypted.length <= 16) throw new Error("Encrypted remote payload is invalid.");
  const body = encrypted.subarray(0, -16);
  const tag = encrypted.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", decode(secret), decode(iv));
  decipher.setAAD(associatedData(deviceId, commandId, purpose));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export function decryptRemoteCommand(secret, deviceId, envelope, now = Date.now()) {
  const payload = JSON.parse(
    decrypt(secret, deviceId, envelope.id, envelope.ciphertext, envelope.iv, "command"),
  );
  if (
    payload?.version !== 1 ||
    payload.commandId !== envelope.id ||
    typeof payload.nonce !== "string" ||
    typeof payload.issuedAt !== "number" ||
    typeof payload.expiresAt !== "number" ||
    !payload.command ||
    typeof payload.command !== "object" ||
    payload.issuedAt > now + 30_000 ||
    payload.expiresAt < now ||
    payload.expiresAt - payload.issuedAt > 2 * 60_000
  ) {
    throw new Error("Remote command is expired or invalid.");
  }
  return payload;
}

export function encryptRemoteResult(secret, deviceId, commandId, result) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decode(secret), iv);
  cipher.setAAD(associatedData(deviceId, commandId, "result"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(result), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext: ciphertext.toString("base64url"), iv: iv.toString("base64url") };
}
