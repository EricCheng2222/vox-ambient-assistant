import assert from "node:assert/strict";
import { speechText } from "../lib/speech-text.ts";

for (const reference of [
  "([apnews.com](https://apnews.com/article/123?utm_source=openai))",
  "([apnews.com]\\(https://apnews.com/article/123?utm\\_source=openai\\))",
  "https://apnews.com/article/123",
  "citeturn0search0",
]) {
  assert.equal(speechText(`今天晴天。 ${reference}`), "今天晴天。");
}
assert.equal(speechText("See [the report](https://example.com/report) for details."), "See the report for details.");
assert.equal(speechText("氣溫32度，漲幅5%。"), "氣溫32度，漲幅5%。");
assert.equal(speechText("Visit https://example.com，然後回來。"), "Visit，然後回來。");
assert.equal(speechText("Hello, world!"), "Hello, world!");
console.log("Speech citation checks passed");
