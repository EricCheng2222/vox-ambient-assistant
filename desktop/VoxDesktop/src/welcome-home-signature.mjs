// Checks the iPhone's signed "I'm home" message against the phone pairing's
// shared secret. The iPhone signs the same string (ProximityGreeter in
// ios/VoxIOS/VoxIOS/ProximityGreeter.swift).
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Arrival message: "<kind>.<unix seconds>.<nonce>.<HMAC-SHA256, base64url>",
 * where kind is "v1" for a real arrival or "t1" for the iPhone's Test button.
 * Returns the kind when the signature checks out, otherwise false.
 */
export function verifyArrival(payload, pairing, seenNonces, now = Date.now()) {
  const match = /^(v1|t1)\.(\d{9,11})\.([A-Za-z0-9_-]{8,43})\.([A-Za-z0-9_-]{43})$/.exec(payload ?? "");
  if (!match || !pairing?.secret || !pairing?.deviceId) return false;
  const [, kind, seconds, nonce, mac] = match;
  if (Math.abs(now - Number(seconds) * 1000) > MAX_CLOCK_SKEW_MS || seenNonces.has(nonce)) return false;
  const expected = base64Url(
    createHmac("sha256", pairing.secret).update(`vox-welcome-home.${kind}.${pairing.deviceId}.${seconds}.${nonce}`).digest(),
  );
  const ok = expected.length === mac.length && timingSafeEqual(Buffer.from(expected), Buffer.from(mac));
  if (!ok) return false;
  seenNonces.add(nonce);
  return kind;
}
