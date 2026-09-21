import assert from "node:assert/strict";

const {
  adaptiveReplyLengthChoices,
  adaptiveReplyLengthInstruction,
  adaptiveReplyLengthSettings,
  defaultAdaptiveReplyLength,
  parseAdaptiveReplyLength,
} = await import("../lib/reply-length.ts");

assert.deepEqual(adaptiveReplyLengthChoices("less"), [
  "minimal",
  "brief",
  "standard",
]);
assert.deepEqual(adaptiveReplyLengthChoices("balanced"), [
  "minimal",
  "brief",
  "standard",
  "detailed",
]);
assert.deepEqual(adaptiveReplyLengthChoices("more"), [
  "brief",
  "standard",
  "detailed",
  "expansive",
]);

assert.equal(defaultAdaptiveReplyLength("less"), "brief");
assert.equal(defaultAdaptiveReplyLength("balanced"), "standard");
assert.equal(defaultAdaptiveReplyLength("more"), "detailed");
assert.equal(parseAdaptiveReplyLength("minimal", "balanced"), "minimal");
assert.equal(parseAdaptiveReplyLength("minimal", "more"), "detailed");
assert.equal(parseAdaptiveReplyLength("unexpected", "less"), "brief");

assert.match(
  adaptiveReplyLengthInstruction("more", "expansive"),
  /fuller exploration/i,
);
assert.equal(adaptiveReplyLengthSettings("minimal").verbosity, "low");
assert.equal(adaptiveReplyLengthSettings("standard").verbosity, "medium");
assert.equal(adaptiveReplyLengthSettings("expansive").verbosity, "high");
assert.ok(
  adaptiveReplyLengthSettings("detailed", true).maxOutputTokens >
    adaptiveReplyLengthSettings("detailed").maxOutputTokens,
);

console.log("Adaptive reply-length checks passed.");
