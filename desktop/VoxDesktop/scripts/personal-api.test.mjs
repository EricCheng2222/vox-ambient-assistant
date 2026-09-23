import assert from "node:assert/strict";

import {
  createPersonalRealtimeSecret,
  personalRealtimeSession,
  validOpenAIKey,
} from "../src/personal-api.mjs";

assert.equal(validOpenAIKey("not-a-key"), false);
assert.equal(validOpenAIKey(`sk-${"a".repeat(24)}`), true);

const session = personalRealtimeSession({
  voice: "cedar",
  mandarinTranscription: true,
  instructions: "Speak naturally.",
});
assert.equal(session.audio.output.voice, "cedar");
assert.equal(session.audio.input.transcription.language, "zh");
assert.equal(session.audio.input.turn_detection.create_response, false);
assert.equal(session.truncation.type, "retention_ratio");
assert.equal(session.truncation.retention_ratio, 0.8);
assert.equal(session.truncation.token_limits.post_instructions, 8_000);

let requestHeaders;
const result = await createPersonalRealtimeSecret(
  `sk-${"b".repeat(24)}`,
  { voice: "cedar" },
  async (_url, init) => {
    requestHeaders = init.headers;
    return new Response(JSON.stringify({ value: "ek_test", expires_at: 123 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
);
assert.deepEqual(result, { value: "ek_test", expires_at: 123 });
assert.match(requestHeaders.Authorization, /^Bearer sk-/u);
assert.equal(JSON.stringify(result).includes("sk-"), false);

console.log("Personal API checks passed.");
