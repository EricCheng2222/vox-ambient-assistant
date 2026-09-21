import assert from "node:assert/strict";

const {
  adaptiveReplyLengthChoices,
  adaptiveReplyLengthInstruction,
  adaptiveReplyLengthSettings,
  defaultAdaptiveReplyLength,
  mirroredAdaptiveReplyLength,
  parseAdaptiveReplyLength,
  userTurnLengthSignals,
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

assert.equal(mirroredAdaptiveReplyLength("Hi", "balanced"), "minimal");
assert.equal(
  mirroredAdaptiveReplyLength(
    "I want to think through the privacy trade-offs and how account memory should work across different devices.",
    "less",
  ),
  "minimal",
);
assert.equal(
  mirroredAdaptiveReplyLength(
    "I want to think through the privacy trade-offs and how account memory should work across different devices.",
    "balanced",
  ),
  "brief",
);
assert.equal(
  mirroredAdaptiveReplyLength(
    "I want to think through the privacy trade-offs and how account memory should work across different devices.",
    "more",
  ),
  "standard",
);
assert.equal(
  mirroredAdaptiveReplyLength("請幫我比較本機記憶和雲端記憶的隱私差異，以及跨裝置同步時各自需要注意的問題。", "more"),
  "detailed",
);
assert.equal(mirroredAdaptiveReplyLength("Create the file", "more", { compact: true }), "brief");
assert.deepEqual(userTurnLengthSignals("你好。今天想聊聊語音助理。"), {
  characters: 13,
  meaningfulUnits: 11,
  sentenceCount: 2,
});

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
