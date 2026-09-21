import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
process.env.VOX_SESSION_SECRET = "test-only-session-secret-that-is-long";
process.env.VOX_USERS_JSON = JSON.stringify([
  { id: "user-alpha", name: "Alpha", accessCode: "alpha-test-code-123" },
  { id: "user-beta", name: "Beta", accessCode: "beta-test-code-456" },
]);

const {
  createSessionToken,
  getAuthorizedUser,
  isAuthConfigured,
  verifyAccessCode,
} = await import("../lib/auth.ts");

assert.equal(isAuthConfigured(), true);
assert.deepEqual(await verifyAccessCode("alpha-test-code-123"), {
  id: "user-alpha",
  displayName: "Alpha",
});
assert.deepEqual(await verifyAccessCode("beta-test-code-456"), {
  id: "user-beta",
  displayName: "Beta",
});
assert.equal(await verifyAccessCode("wrong-test-code"), null);

const alphaToken = await createSessionToken("user-alpha");
const alphaRequest = new Request("https://vox.example.test/api/memories", {
  headers: { Cookie: `vox_session=${encodeURIComponent(alphaToken)}` },
});
assert.equal((await getAuthorizedUser(alphaRequest))?.id, "user-alpha");

const [payload, signature] = alphaToken.split(".");
const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
const tamperedRequest = new Request("https://vox.example.test/api/memories", {
  headers: { Cookie: `vox_session=${tamperedPayload}.${signature}` },
});
assert.equal(await getAuthorizedUser(tamperedRequest), null);

process.env.VOX_USERS_JSON = JSON.stringify([
  { id: "user-beta", name: "Beta", accessCode: "beta-test-code-456" },
]);
assert.equal(await getAuthorizedUser(alphaRequest), null);

console.log("Privacy authentication checks passed.");
