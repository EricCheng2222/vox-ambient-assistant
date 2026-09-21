import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  fallbackVisionNeed,
  parseVisionNeed,
  visualTurnInstruction,
} = await import("../lib/vision.ts");

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

const pageSource = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
assert.match(pageSource, /type: "input_image"/);
assert.match(pageSource, /need === "inspect_high" \? "high" : "auto"/);
assert.match(pageSource, /Local preview ·/);
assert.match(pageSource, /no frames sent/i);
assert.match(pageSource, /announceFrameCapture\(detail\)/);
assert.match(pageSource, /Frame sent/);
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
