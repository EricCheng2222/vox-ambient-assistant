import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Recording a voiceprint must not reach the live conversation as a request.
const [page, settings] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/voice-filter-settings.tsx", import.meta.url), "utf8"),
]);
assert.match(page, /<VoiceFilterSettings onRecordingChange=\{holdMicForEnrollment\} \/>/u);
assert.match(page, /track\.enabled = !holding && !mutedRef\.current/u);
assert.match(page, /type: "input_audio_buffer\.clear"/u);
assert.match(page, /if \(holding\) \{\n\s+interruptActiveVoiceResponse\(\);/u);
// Unmuting during the recording, or a conversation started during it, stays deaf.
assert.match(page, /track\.enabled = !nextMuted && !enrollmentHoldRef\.current/u);
assert.match(page, /if \(enrollmentHoldRef\.current\) stream\.getAudioTracks\(\)\.forEach\(\(track\) => \(track\.enabled = false\)\)/u);
// The conversation pauses before the recording microphone opens and resumes
// when it stops, including when the microphone could not open.
const start = settings.slice(settings.indexOf("async function startSetup"), settings.indexOf("async function finishSetup"));
assert.ok(start.indexOf("onRecordingChangeRef.current?.(true)") < start.indexOf("getUserMedia"));
assert.match(start, /catch \(error\) \{\n\s+onRecordingChangeRef\.current\?\.\(false\);/u);
const stop = settings.slice(settings.indexOf("const stopRecording"), settings.indexOf("useEffect(() => {\n    if (open)"));
assert.match(stop, /onRecordingChangeRef\.current\?\.\(false\);/u);
console.log("Enrollment hold checks passed.");
