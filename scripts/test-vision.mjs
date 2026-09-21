import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  createVisionItemId,
  fallbackVisionNeed,
  parseVisionNeed,
  visualTurnInstruction,
} = await import("../lib/vision.ts");

const imageItemIds = Array.from({ length: 100 }, createVisionItemId);
assert.equal(new Set(imageItemIds).size, imageItemIds.length);
for (const id of imageItemIds) {
  assert.ok(id.length <= 32, "Realtime rejects item IDs longer than 32 characters");
  assert.match(id, /^item_[a-f0-9]+$/);
}

assert.equal(parseVisionNeed("inspect_low"), "inspect_low");
assert.equal(parseVisionNeed("inspect_high"), "inspect_high");
assert.equal(parseVisionNeed("always_watch"), "none");
assert.equal(fallbackVisionNeed("Can you look at this?"), "inspect_low");
assert.equal(fallbackVisionNeed("Please read the small text on this label"), "inspect_high");
assert.equal(fallbackVisionNeed("你幫我看一下這是什麼"), "inspect_low");
assert.equal(fallbackVisionNeed("你看上面的小字寫什麼"), "inspect_high");
assert.equal(fallbackVisionNeed("I bought a new camera"), "none");
assert.match(visualTurnInstruction("attached", "auto"), /one requested still frame/i);
assert.match(
  visualTurnInstruction("attached", "auto"),
  /do not routinely mention image quality/i,
);
assert.match(
  visualTurnInstruction("attached", "auto"),
  /only when it genuinely prevents a reasonably confident answer/i,
);
assert.match(visualTurnInstruction("unavailable"), /camera is off/i);
assert.match(visualTurnInstruction("blocked"), /temporary usage limit/i);
assert.match(visualTurnInstruction("delivery_failed"), /was not accepted/i);

const pageSource = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
assert.match(pageSource, /type: "input_image"/);
assert.match(pageSource, /need === "inspect_high" \? "high" : "auto"/);
assert.match(pageSource, /Local preview ·/);
assert.match(pageSource, /no frames sent/i);
assert.match(pageSource, /announceFrameCapture\(itemId, detail, imageUrl\)/);
assert.match(pageSource, /await attachRequestedVision/);
assert.match(pageSource, /conversation\.item\.done/);
assert.match(pageSource, /event_id: eventId/);
assert.match(pageSource, /Frame delivered/);
assert.match(pageSource, /Frame not sent/);
assert.match(pageSource, /Answer this visual question using the attached current frame/);
assert.match(pageSource, /aria-live="assertive"/);
assert.match(pageSource, /sessionFramesSent/);
assert.match(pageSource, /conversation\.item\.delete/);
assert.doesNotMatch(pageSource, /visionSampling|Every 60 sec|Every second/);

const routeSource = await readFile(
  new URL("../app/api/jev-route/route.ts", import.meta.url),
  "utf8",
);
assert.match(routeSource, /Strongly prefer none/);
assert.match(routeSource, /Never inspect merely because a camera preview is available/);
assert.match(routeSource, /visionNeedConfidence < 0\.8/);
assert.match(routeSource, /claimVisionAnalysis/);

const usageSource = await readFile(
  new URL("../lib/vision-usage-store.ts", import.meta.url),
  "utf8",
);
assert.match(usageSource, /VISION_HOURLY_ANALYSIS_LIMIT = 30/);
assert.match(usageSource, /VISION_DAILY_ANALYSIS_LIMIT = 120/);
assert.match(usageSource, /VISION_MINIMUM_INTERVAL_MS = 3_000/);

const schemaSource = await readFile(
  new URL("../db/schema.ts", import.meta.url),
  "utf8",
);
assert.match(schemaSource, /visionUsage/);
assert.doesNotMatch(schemaSource, /imageDataUrl|image_blob|frame_data/);

console.log("Conservative vision checks passed.");
