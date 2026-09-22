import assert from "node:assert/strict";

import {
  createPersonalPresence,
  createPersonalRoute,
  validTypeSafeKey,
} from "../src/personal-route.mjs";

assert.equal(validTypeSafeKey("wrong"), false);
assert.equal(validTypeSafeKey(`apikey_${"a".repeat(32)}`), true);

const result = await createPersonalRoute(
  `apikey_${"b".repeat(32)}`,
  { text: "Can you help me understand this?", replyLength: "balanced" },
  async () =>
    new Response(
      JSON.stringify({
        answers: {
          route: { choice: "realtime", confidence: 0.9 },
          turn_state: { choice: "complete", confidence: 0.9 },
          context_mode: { choice: "continue", confidence: 0.8 },
          conversation_move: { choice: "answer", confidence: 0.9 },
          response_length: { choice: "standard", confidence: 0.8 },
          visual_need: { choice: "none", confidence: 0.9 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
);
assert.equal(result.route, "realtime");
assert.equal(result.responsePosture, "answer");

const presence = await createPersonalPresence(
  `apikey_${"c".repeat(32)}`,
  {
    initiative: "social",
    quietForMs: 120_000,
    sinceAssistantMs: 120_000,
    recentMessages: [{ role: "user", text: "I am still deciding what to do next." }],
  },
  async () =>
    new Response(
      JSON.stringify({
        answers: {
          timing: { choice: "continue_topic", confidence: 0.88 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
);
assert.equal(presence.action, "continue_topic");

const guardedPresence = await createPersonalPresence(`apikey_${"d".repeat(32)}`, {
  initiative: "off",
});
assert.equal(guardedPresence.action, "stay_silent");

console.log("Personal TypeSafe routing checks passed.");
