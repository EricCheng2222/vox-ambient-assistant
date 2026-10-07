import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { iPhoneLocationForCallers } = await import("../lib/phone-location.ts");
const now = Date.parse("2026-09-30T12:00:00Z");
const device = (kind, place, capturedAt) => ({
  id: kind + capturedAt, name: kind, kind, createdAt: capturedAt, lastSeenAt: capturedAt,
  last: { lat: 22.62731, lon: 120.30142, accuracy: 35, capturedAt, place, battery: 0.5 },
});
// The newest iPhone position: place and how long ago, never coordinates or battery.
const said = iPhoneLocationForCallers([
  device("iphone", "高雄車站", "2026-09-30T09:00:00Z"),
  device("iphone", "十全一路, 三民區, 高雄市", "2026-09-30T11:55:00Z"),
  device("ipad", "Somewhere else", "2026-09-30T11:59:00Z"),
], now);
assert.equal(said, "The iPhone was last seen near 十全一路, 三民區, 高雄市, 5 minutes ago.");
assert.doesNotMatch(said, /22\.62|120\.30|battery|50%/u);
assert.match(iPhoneLocationForCallers([device("iphone", "高雄車站", "2026-09-29T20:00:00Z")], now), /may have moved/u);
assert.match(iPhoneLocationForCallers([device("iphone", null, "2026-09-30T11:55:00Z")], now), /no name for \(don't give coordinates\)/u);
assert.match(iPhoneLocationForCallers([device("ipad", "x", "2026-09-30T11:55:00Z")], now), /No recent location/u);
assert.match(iPhoneLocationForCallers([], now), /No recent location/u);

// The switch is re-checked when a caller asks, and starts off.
const [internal, schema, store] = await Promise.all([
  readFile(new URL("../app/api/openai/realtime-sip/internal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/phone-assistant-store.ts", import.meta.url), "utf8"),
]);
assert.match(internal, /if \(!settings\?\.enabled \|\| !settings\.shareLocationWithCallers\) \{/u);
assert.match(schema, /shareLocationWithCallers: integer\("share_location_with_callers", \{ mode: "boolean" \}\)\.notNull\(\)\.default\(false\)/u);
// Setting the phone assistant up again turns it back off.
assert.equal(store.match(/shareLocationWithCallers: false,/gu).length, 2);
console.log("Phone location checks passed.");
