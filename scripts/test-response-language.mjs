import assert from "node:assert/strict";

const {
  detectSubstantiveLanguage,
  responseLanguageInstruction,
  selectResponseLanguage,
} = await import("../lib/response-language.ts");

assert.equal(detectSubstantiveLanguage("嘿,我剛吃完晚餐。"), "taiwan_mandarin");
assert.equal(detectSubstantiveLanguage("我覺得 AI 這樣回答滿自然的。"), "taiwan_mandarin");
assert.equal(detectSubstantiveLanguage("I just finished dinner."), "english");
assert.equal(detectSubstantiveLanguage("What does 中文 mean here?"), "english");
assert.equal(detectSubstantiveLanguage("嗯，欸"), null);

assert.equal(
  selectResponseLanguage("嗯", [{ role: "user", text: "Let's keep talking." }]),
  "english",
);
assert.equal(
  selectResponseLanguage("嗯", [{ role: "user", text: "我還想繼續聊。" }]),
  "taiwan_mandarin",
);
assert.equal(selectResponseLanguage("", []), "taiwan_mandarin");

assert.match(
  responseLanguageInstruction("taiwan_mandarin"),
  /entirely in natural Taiwan Mandarin/,
);
assert.match(responseLanguageInstruction("english"), /entirely in English/);

console.log("Response-language checks passed.");
