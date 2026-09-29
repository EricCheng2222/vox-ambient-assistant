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


// Every background path carries the recent conversation.
const { parseRecentMessages, earlierMessages, formatTaskContext } = await import(
  "../lib/conversation-context.ts"
);
assert.deepEqual(parseRecentMessages("nope"), []);
assert.deepEqual(
  parseRecentMessages([{ role: "system", text: "x" }, { role: "user", text: "hi" }, { role: "assistant", text: 3 }]),
  [{ role: "user", text: "hi" }],
);
const dialogue = [
  { role: "user", text: "Tell me about the Krebs cycle." },
  { role: "assistant", text: "It oxidizes acetyl-CoA in the mitochondria." },
  { role: "user", text: "Now compare it" },
  { role: "user", text: "with glycolysis in detail." },
];
assert.deepEqual(
  earlierMessages(dialogue, "Now compare it with glycolysis in detail."),
  dialogue.slice(0, 2),
);
const taskContext = formatTaskContext(dialogue, "Now compare it with glycolysis in detail.");
assert.match(taskContext, /USER: Tell me about the Krebs cycle\./u);
assert.match(taskContext, /VOX: It oxidizes acetyl-CoA/u);
assert.doesNotMatch(taskContext, /with glycolysis in detail/u);
assert.equal(formatTaskContext([{ role: "user", text: "hello" }], "hello"), "");

for (const route of ["reason", "files", "reminders"]) {
  const source = await readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8");
  assert.match(source, /formatTaskContext|recentMessages/u, `${route} carries the conversation`);
}
console.log("Bounded always-on conversation context checks passed.");
