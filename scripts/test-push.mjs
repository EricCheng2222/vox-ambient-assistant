import assert from "node:assert/strict";

const { apnsToken, createApnsSender, cutToBytes, getApnsConfig, isDeviceToken } = await import("../lib/apns.ts");
const { createOwnerReacher, pushParts } = await import("../lib/owner-push.ts");

// A throwaway key, made here: the same kind Apple issues (P-256, PKCS#8 PEM).
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/gu).join("\n")}\n-----END PRIVATE KEY-----`;
const config = { keyId: "ABCDE12345", teamId: "GQ8P29VDJ8", privateKey: pem, bundleId: "com.ericcheng.vox" };

assert.deepEqual(getApnsConfig({ APNS_KEY_ID: "ABCDE12345", APNS_TEAM_ID: "GQ8P29VDJ8", APNS_PRIVATE_KEY: pem }), config);
assert.equal(getApnsConfig({}), null);
assert.equal(getApnsConfig({ APNS_KEY_ID: "short", APNS_TEAM_ID: "GQ8P29VDJ8", APNS_PRIVATE_KEY: pem }), null);

// The token is a real ES256 signature over Apple's header and claims.
const jwt = await apnsToken(config, 1_700_000_000);
const [head, claims, signature] = jwt.split(".");
assert.deepEqual(JSON.parse(Buffer.from(head, "base64url").toString()), { alg: "ES256", kid: "ABCDE12345" });
assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), { iss: "GQ8P29VDJ8", iat: 1_700_000_000 });
assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(signature, "base64url"), Buffer.from(`${head}.${claims}`)));

const token = "ab".repeat(32);
assert.equal(isDeviceToken(token), true);
assert.equal(isDeviceToken("AB".repeat(32)), false);
assert.equal(isDeviceToken("../etc"), false);
assert.equal(cutToBytes("短".repeat(100), 30).endsWith("…"), true);
assert.ok(new TextEncoder().encode(cutToBytes("短".repeat(100), 30)).length <= 30);

// One request per device, to the right Apple host, with nothing but the notification in it.
{
  const calls = [];
  const send = createApnsSender({ config: () => config, now: () => 1_700_000_000_000, fetcher: async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 200 }); } });
  assert.deepEqual(await send({ token, environment: "development" }, { title: "Good morning", body: "10:00 Standup" }), { ok: true });
  assert.equal(calls[0].url, `https://api.sandbox.push.apple.com/3/device/${token}`);
  assert.equal(calls[0].init.headers["apns-topic"], "com.ericcheng.vox");
  assert.match(calls[0].init.headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/u);
  assert.deepEqual(JSON.parse(calls[0].init.body), { aps: { alert: { title: "Good morning", body: "10:00 Standup" }, sound: "default", "thread-id": "vox" } });
  await send({ token, environment: "production" }, { title: "Vox", body: "x" });
  assert.equal(calls[1].url, `https://api.push.apple.com/3/device/${token}`);
  assert.equal(calls[1].init.headers.authorization, calls[0].init.headers.authorization, "the token is reused, not minted per request");
}
{
  const gone = createApnsSender({ config: () => config, fetcher: async () => Response.json({ reason: "Unregistered" }, { status: 410 }) });
  assert.deepEqual(await gone({ token, environment: "development" }, { title: "Vox", body: "x" }), { ok: false, error: "apns_410_Unregistered", gone: true });
  const busy = createApnsSender({ config: () => config, fetcher: async () => Response.json({ reason: "TooManyRequests" }, { status: 429 }) });
  assert.deepEqual(await busy({ token, environment: "development" }, { title: "Vox", body: "x" }), { ok: false, error: "apns_429_TooManyRequests", gone: false });
  const down = createApnsSender({ config: () => config, fetcher: async () => { throw new Error("network"); } });
  assert.deepEqual(await down({ token, environment: "development" }, { title: "Vox", body: "x" }), { ok: false, error: "unreachable", gone: false });
  const off = createApnsSender({ config: () => null });
  assert.equal((await off({ token, environment: "development" }, { title: "Vox", body: "x" })).error, "not_configured");
}

// A briefing as a notification: its heading is the title, and the link line is left off.
assert.deepEqual(pushParts("Good morning, Thursday\n\nToday\n10:00 Standup\nhttps://vox.example"), { title: "Good morning, Thursday", body: "Today\n10:00 Standup" });
assert.deepEqual(pushParts("Leave by 9:10 for Standup."), { title: "Vox", body: "Leave by 9:10 for Standup." });
assert.deepEqual(pushParts("Leave by 9:10 for Standup.\nhttps://vox.example"), { title: "Vox", body: "Leave by 9:10 for Standup." });

// Every message is left as a notice; it is delivered now by push, else by text; dead devices are forgotten.
{
  const log = [];
  const reach = (devices, results, { textOk = true, collectors = 0 } = {}) =>
    createOwnerReacher({
      devicesFor: async () => devices,
      forgetDevice: async (t) => { log.push(`forget ${t}`); },
      sendToDevice: async (device) => results[device.token],
      text: async () => { log.push("text"); return textOk ? { ok: true } : { ok: false, error: "no_number" }; },
      leaveNotice: async (_owner, note, delivered) => { log.push(`notice ${note.title} delivered=${delivered}`); return collectors; },
    });
  const a = { token: "a", environment: "development" };
  const b = { token: "b", environment: "development" };
  assert.deepEqual(await reach([a, b], { a: { ok: true }, b: { ok: false, error: "apns_410", gone: true } })("o", "hello"), { ok: true });
  assert.deepEqual(log, ["forget b", "notice Vox delivered=true"], "pushed to one device: no text, and the dead one is forgotten");
  log.length = 0;
  assert.deepEqual(await reach([], {})("o", "Good morning\n10:00 Standup"), { ok: true });
  assert.deepEqual(log, ["text", "notice Good morning delivered=true"]);
  log.length = 0;
  assert.deepEqual(await reach([], {}, { textOk: false, collectors: 1 })("o", "hello"), { ok: true }, "no text possible, but a device will collect it");
  assert.deepEqual(log, ["text", "notice Vox delivered=false"]);
  assert.deepEqual(await reach([], {}, { textOk: false, collectors: 0 })("o", "hello"), { ok: false, error: "no_number" }, "nobody to tell: reported as not sent");
}

console.log("Push checks passed.");
