import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { parsePing, cleanDeviceName, parseDeviceKind, ageLabel } = await import("../lib/location.ts");
const { deviceLocationsToolOutput, FIND_DEVICES_TOOL } = await import("../lib/stage-tool.ts");

const now = Date.parse("2026-09-29T12:00:00Z");
const good = { lat: 22.6273456789, lon: 120.3014, accuracy: 35.4, capturedAt: "2026-09-29T11:55:00Z", place: "十全一路, 三民區, 高雄市", battery: 0.82 };
assert.deepEqual(parsePing(good, now), {
  lat: 22.627346, lon: 120.3014, accuracy: 35, capturedAt: "2026-09-29T11:55:00.000Z", place: "十全一路, 三民區, 高雄市", battery: 0.82,
});
// Nonsense positions and broken clocks are refused.
for (const bad of [
  null, "x", { ...good, lat: 91 }, { ...good, lon: -181 }, { ...good, lat: "abc" }, { ...good, accuracy: -1 },
  { ...good, capturedAt: "2026-09-29T13:00:00Z" }, { ...good, capturedAt: "2026-08-01T00:00:00Z" }, { ...good, capturedAt: "soon" },
]) assert.equal(parsePing(bad, now), null, JSON.stringify(bad));
// Place names are cleaned; battery is optional and clamped.
assert.equal(parsePing({ ...good, place: "Home‮\n  street", battery: 7 }, now).place, "Home street");
assert.equal(parsePing({ ...good, battery: 7 }, now).battery, 1);
assert.equal(parsePing({ ...good, battery: null, place: undefined }, now).battery, null);
assert.equal(cleanDeviceName("  ‮Evil\u0000 "), "Evil");
assert.equal(cleanDeviceName(""), "Device");
assert.equal(parseDeviceKind("iphone"), "iphone");
assert.equal(parseDeviceKind("toaster"), "other");
assert.equal(ageLabel("2026-09-29T11:55:00Z", now), "5 minutes ago");
assert.equal(ageLabel("2026-09-28T10:00:00Z", now), "26 hours ago");

assert.equal(FIND_DEVICES_TOOL.name, "find_my_devices");
assert.match(deviceLocationsToolOutput([], now), /No device shares its location yet/u);
assert.match(deviceLocationsToolOutput(null, now), /couldn't be loaded/u);
assert.equal(
  deviceLocationsToolOutput([{ name: "iPhone", last: { place: "十全一路, 高雄市", capturedAt: "2026-09-29T11:55:00Z", accuracy: 35, battery: 0.82 } }], now).split("\n")[0],
  "iPhone: 十全一路, 高雄市, 5 min ago, accurate to about 35 m, battery 82%.",
);

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [ping, list, devices, store, page, csp, proxy] = await Promise.all([
  read("app/api/locations/ping/route.ts"),
  read("app/api/locations/route.ts"),
  read("app/api/locations/devices/route.ts"),
  read("lib/location-store.ts"),
  read("app/page.tsx"),
  read("cloudflare/worker-entry.mjs"),
  read("desktop/VoxDesktop/src/local-web-server.mjs"),
]);
// Devices ping with their own token; reading and managing need the signed-in owner.
assert.doesNotMatch(ping, /requireUser/u);
assert.match(ping, /recordLocationPing\(token, position\)\) \? 204 : 401/u);
assert.match(list, /requireUser\(request\)/u);
assert.equal(devices.match(/requireUser\(request\)/gu).length, 2);
assert.equal(devices.match(/if \(!sameOrigin\(request\)\)/gu).length, 2);
// Tokens are stored hashed, positions encrypted and bound to their device.
assert.match(store, /tokenHash: await sha256\(token\)/u);
assert.match(store, /additionalData: new TextEncoder\(\)\.encode\(deviceId\)/u);
// The map shows on the web and the Mac, not in the iPhone app.
assert.match(page, /view === "today" && todayAvailable && !iphoneApp/u);
assert.match(page, /if \(points\.length && !isIPhoneApp\(\)\)/u);
assert.match(csp, /"img-src 'self' data: blob: https:"/u);
assert.match(proxy, /\["\/api\/locations", new Set\(\["GET"\]\)\]/u);
console.log("Device location checks passed.");
