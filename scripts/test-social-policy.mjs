import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  fallbackConversationRitual,
  memoryUseInstruction,
  parseConversationRitual,
  parseMemoryUse,
  ritualInstruction,
} = await import("../lib/social-policy.ts");

assert.equal(parseMemoryUse("natural_callback"), "natural_callback");
assert.equal(parseMemoryUse("unexpected"), "none");
assert.equal(parseConversationRitual("good_night"), "good_night");
assert.equal(parseConversationRitual("unexpected"), "none");
assert.equal(
  fallbackConversationRitual("早安，今天睡得不錯", {
    morning: true,
    night: false,
  }),
  "good_morning",
);
assert.equal(
  fallbackConversationRitual("我先去睡了，晚安", {
    morning: false,
    night: true,
  }),
  "good_night",
);
assert.equal(
  fallbackConversationRitual("今天工作好多", {
    morning: false,
    night: true,
  }),
  "none",
);
assert.match(memoryUseInstruction("none"), /do not bring up/i);
assert.match(memoryUseInstruction("natural_callback"), /at most one/i);
assert.match(memoryUseInstruction("emotional_followup"), /low-pressure/i);
assert.match(ritualInstruction("good_morning"), /first meaningful interaction/i);
assert.match(ritualInstruction("good_night"), /without starting a new topic/i);

const routeSource = await readFile(
  new URL("../app/api/jev-route/route.ts", import.meta.url),
  "utf8",
);
assert.match(routeSource, /memory_timing/);
assert.match(routeSource, /natural_callback/);
assert.match(routeSource, /emotional_followup/);
assert.match(routeSource, /good_morning/);
assert.match(routeSource, /good_night/);

const presenceSource = await readFile(
  new URL("../app/api/jev-presence/route.ts", import.meta.url),
  "utf8",
);
assert.match(presenceSource, /morning_hello/);
assert.match(presenceSource, /Strongly prefer silence/);

console.log("Social-policy checks passed.");
