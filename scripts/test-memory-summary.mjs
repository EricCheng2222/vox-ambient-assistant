import assert from "node:assert/strict";
import {
  normalizeMemorySummary,
  summarizeMemory,
} from "../lib/memory-summary.ts";

assert.equal(
  normalizeMemorySummary('  “Prefers concise, natural replies.”\n'),
  "Prefers concise, natural replies.",
);

let requestBody;
const summary = await summarizeMemory({
  apiKey: "test-key",
  category: "preference",
  utterance: "I mean, I guess I prefer shorter replies, you know?",
  previousContent: "Prefers balanced replies.",
  fetcher: async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ output_text: '{"summary":"Prefers shorter replies."}' });
  },
});

assert.equal(summary, "Prefers shorter replies.");
assert.equal(requestBody.store, false);
assert.equal(requestBody.text.format.type, "json_schema");
assert.equal(requestBody.input.includes("previous_memory"), true);
assert.match(requestBody.instructions, /never copy transcript-style wording/i);

const routeSource = await import("node:fs/promises").then(({ readFile }) =>
  readFile(new URL("../app/api/memories/route.ts", import.meta.url), "utf8"),
);
assert.match(routeSource, /source: SUMMARIZED_SOURCE/);
assert.match(routeSource, /memory\.source !== SUMMARIZED_SOURCE/);
assert.match(routeSource, /export async function PATCH/);

console.log("Memory-summary checks passed.");
