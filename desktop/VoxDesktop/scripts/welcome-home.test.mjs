import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyArrival } from "../src/welcome-home-signature.mjs";

const pairing = { deviceId: "3f1c2a10-0000-4000-8000-000000000001", secret: "s3cr3t-pairing-key-for-tests-only-0123456789" };
const sign = (seconds, nonce, secret = pairing.secret, kind = "v1") =>
  createHmac("sha256", secret).update(`vox-welcome-home.${kind}.${pairing.deviceId}.${seconds}.${nonce}`).digest("base64url");

test("accepts a fresh arrival signed with the pairing secret, once", () => {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const payload = `v1.${seconds}.nonce-abc12345.${sign(seconds, "nonce-abc12345")}`;
  const seen = new Set();
  assert.equal(verifyArrival(payload, pairing, seen, now), "v1");
  assert.equal(verifyArrival(payload, pairing, seen, now), false, "replay is rejected");
});

test("rejects a wrong key, a stale time, and malformed input", () => {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  assert.equal(verifyArrival(`v1.${seconds}.nonce-xyz12345.${sign(seconds, "nonce-xyz12345", "another-key")}`, pairing, new Set(), now), false);
  const old = seconds - 3600;
  assert.equal(verifyArrival(`v1.${old}.nonce-old12345.${sign(old, "nonce-old12345")}`, pairing, new Set(), now), false);
  assert.equal(verifyArrival("hello", pairing, new Set(), now), false);
  assert.equal(verifyArrival(`v1.${seconds}.nonce-abc12345.${sign(seconds, "nonce-abc12345")}`, null, new Set(), now), false);
});

test("recognizes a signed test arrival, and a test signature can't pass as a real one", () => {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const testSig = sign(seconds, "nonce-test1234", pairing.secret, "t1");
  assert.equal(verifyArrival(`t1.${seconds}.nonce-test1234.${testSig}`, pairing, new Set(), now), "t1");
  assert.equal(verifyArrival(`v1.${seconds}.nonce-test1234.${testSig}`, pairing, new Set(), now), false);
});
