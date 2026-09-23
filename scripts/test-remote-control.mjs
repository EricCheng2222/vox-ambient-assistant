import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import {
  createPairingProof,
  decryptRemoteResult,
  encryptRemoteCommand,
} from "../lib/remote-control.ts";
import {
  decryptRemoteCommand,
  encryptRemoteResult,
  verifyPairingClaim,
} from "../desktop/VoxDesktop/src/remote-control.mjs";

const secret = randomBytes(32).toString("base64url");
const deviceId = randomUUID();
const claimId = randomUUID();
const label = "Test phone";
const pairing = { deviceId, name: "Test Mac", secret };

const proof = await createPairingProof(secret, deviceId, claimId, label);
assert.equal(verifyPairingClaim(secret, { deviceId, claimId, label, proof }), true);
assert.equal(verifyPairingClaim(secret, { deviceId, claimId, label: "Another phone", proof }), false);

const commandId = randomUUID();
const encryptedCommand = await encryptRemoteCommand(pairing, commandId, {
  kind: "desktop_control",
  prompt: "Open Safari",
  appId: "safari",
  intent: "launch",
  mode: "fast",
});
const decryptedCommand = decryptRemoteCommand(secret, deviceId, {
  id: commandId,
  ...encryptedCommand,
});
assert.equal(decryptedCommand.command.kind, "desktop_control");
assert.equal(decryptedCommand.command.appId, "safari");

const encryptedResult = encryptRemoteResult(secret, deviceId, commandId, {
  ok: true,
  answer: "Safari opened.",
});
const decryptedResult = await decryptRemoteResult(
  pairing,
  commandId,
  encryptedResult.ciphertext,
  encryptedResult.iv,
);
assert.deepEqual(decryptedResult, { ok: true, answer: "Safari opened." });

await assert.rejects(
  () => decryptRemoteResult(
    pairing,
    randomUUID(),
    encryptedResult.ciphertext,
    encryptedResult.iv,
  ),
  /operation-specific|decrypt|authentication|cipher/iu,
);

console.log("Remote Mac pairing crypto checks passed.");
