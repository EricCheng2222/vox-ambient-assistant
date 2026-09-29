import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { speechPieces } = await import("../lib/answer-speech.ts");

// The first piece is short so Vox starts talking quickly; nothing is lost.
const english = Array.from({ length: 30 }, (_, index) => `Sentence number ${index + 1} explains one step of the proof.`).join(" ");
const pieces = speechPieces(english);
assert.ok(pieces.length > 2);
assert.ok(pieces[0].length <= 140, pieces[0]);
assert.ok(pieces.every((piece) => piece.length <= 1_040));
assert.equal(pieces.join(" "), english);

const chinese = "克氏循環在粒線體基質進行。它把 acetyl-CoA 氧化成二氧化碳！每一圈產生三個 NADH；還有一個 FADH2。".repeat(12);
const chinesePieces = speechPieces(chinese);
assert.ok(chinesePieces[0].length <= 140);
assert.equal(chinesePieces.join("").replace(/\s+/g, ""), chinese.replace(/\s+/g, ""));

// A single run-on sentence is still cut into bounded pieces.
const runOn = `${"word ".repeat(600)}end`;
assert.ok(speechPieces(runOn).every((piece) => piece.length <= 1_040));
assert.deepEqual(speechPieces("   "), []);

const [page, router, speech, proxy] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/jev-route/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/speech/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../desktop/VoxDesktop/src/local-web-server.mjs", import.meta.url), "utf8"),
]);
// Only the reasoning routes use text-to-speech; everything else stays live.
assert.equal(page.match(/speakLongAnswer\(/g)?.length, 2);
assert.match(page, /void speakLongAnswer\(reasoned\.answer\.trim\(\)\)/u);
assert.match(page, /answerSpeechRef\.current\?\.stop\(\)/u);
assert.match(page, /role: "assistant", content: \[\{ type: "output_text", text: answer \}\]/u);
assert.match(router, /Choose realtime by default/u);
assert.match(router, /never choose them for chat, quick questions/u);
assert.match(speech, /parseRealtimeVoice\(body\.voice\)/u);
assert.match(proxy, /\["\/api\/speech", new Set\(\["POST"\]\)\]/u);

console.log("Answer speech checks passed.");
