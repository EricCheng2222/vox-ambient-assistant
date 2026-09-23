import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  REALTIME_CONTEXT_TOKEN_LIMIT,
  boundedRecentMessages,
  formatConversationCarryover,
  realtimeTruncationConfig,
} = await import("../lib/conversation-context.ts");

assert.equal(REALTIME_CONTEXT_TOKEN_LIMIT, 8_000);
assert.deepEqual(realtimeTruncationConfig(), {
  type: "retention_ratio",
  retention_ratio: 0.8,
  token_limits: { post_instructions: 8_000 },
});

const messages = Array.from({ length: 40 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  text: `${index}:${"x".repeat(700)}`,
}));
const bounded = boundedRecentMessages(messages);
assert.ok(bounded.length <= 24);
assert.ok(bounded.reduce((total, message) => total + message.text.length, 0) <= 12_000);
assert.match(bounded.at(-1).text, /^39:/u);
assert.doesNotMatch(bounded.map((message) => message.text).join("\n"), /^0:/mu);

const carryover = formatConversationCarryover(messages);
assert.match(carryover, /<prior_conversation>/u);
assert.match(carryover, /39:/u);
assert.doesNotMatch(carryover, /USER: 0:/u);

const [page, cloudRoute, personalRoute] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/jev-route/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../desktop/VoxDesktop/src/personal-route.mjs", import.meta.url), "utf8"),
]);
for (const source of [page, cloudRoute, personalRoute]) {
  assert.doesNotMatch(source, /context_mode|contextMode|startFreshRealtimeContext/u);
}
assert.match(page, /seedConversationCarryover/u);
assert.match(page, /realtimeTruncationConfig/u);
assert.match(cloudRoute, /remembered_context/u);
assert.match(cloudRoute, /memory_timing/u);

console.log("Bounded always-on conversation context checks passed.");
