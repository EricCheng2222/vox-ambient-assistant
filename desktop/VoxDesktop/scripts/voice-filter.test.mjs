// End-to-end check of the voice filter pipeline with synthetic voices (macOS
// `say`): enroll one voice, then play a scene of that voice, other voices, and
// music, and measure how much of each part gets through the gate.
// Skips unless run on macOS with the models installed (npm run voice-models).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const models = path.join(root, "resources", "voice-models");
const ready = process.platform === "darwin" && ["dpdfnet2_48khz_hr.onnx", "campplus_zh_en.onnx", "silero_vad.onnx"].every((name) => existsSync(path.join(models, name)));

test("voice filter keeps the owner's voice and drops others and music", { skip: !ready && "needs macOS and the voice models" }, async () => {
  process.env.VOX_VOICE_MODELS = models;
  const sherpa = createRequire(import.meta.url)("sherpa-onnx-node");
  const worker = await import("../src/voice-filter-worker.mjs");
  worker.load();

  const RATE = 48_000;
  const FRAME = 480;
  const scratch = mkdtempSync(path.join(os.tmpdir(), "vox-voice-filter-"));
  const say = (voice, text, name) => {
    const file = path.join(scratch, `${name}.wav`);
    execFileSync("say", ["-v", voice, "-o", file, "--file-format=WAVE", `--data-format=LEF32@${RATE}`, text]);
    return sherpa.readWave(file).samples;
  };
  const silence = (seconds) => new Float32Array(Math.round(RATE * seconds));
  const music = (length) => {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const t = i / RATE;
      out[i] = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) * 0.08 +
        Math.sin(2 * Math.PI * (440 + 60 * Math.sin(t * 1.3)) * t) * 0.07;
    }
    return out;
  };
  const withMusic = (speech) => {
    const bed = music(speech.length);
    const mixed = speech.map((value, i) => value + bed[i]);
    mixed.speech = speech; // What should come through: the voice without the music.
    return mixed;
  };

  /** A fake MessagePortMain that records what the worker sends back. */
  const fakePort = () => {
    const port = { listeners: {}, sent: [], closed: false };
    port.on = (name, fn) => { port.listeners[name] = fn; };
    port.start = () => {};
    port.close = () => { port.closed = true; };
    port.postMessage = (data) => port.sent.push(data);
    port.feed = (samples) => {
      for (let i = 0; i + FRAME <= samples.length; i += FRAME) {
        port.listeners.message({ data: samples.slice(i, i + FRAME) });
      }
    };
    return port;
  };

  // Enroll the owner: Samantha reads three sentences.
  const enrollPort = fakePort();
  const enrollment = new worker.Enrollment(enrollPort);
  for (const [i, text] of [
    "Good morning. I'd like to review my flash cards about genetics and biochemistry today.",
    "Please remind me to pick up my clothes when I leave home this evening.",
    "Could you quiz me on three hard cards before dinner, and then read me the weather?",
  ].entries()) {
    enrollPort.feed(say("Samantha", text, `enroll-${i}`));
    enrollPort.feed(silence(0.5));
  }
  const enrolled = enrollment.finish();
  assert.ok(enrolled.seconds >= 8, "enough speech was captured");

  worker.configure({ denoise: true, verify: true, threshold: 0.65, voiceprint: enrolled.voiceprint });
  const session = fakePort();
  new worker.Session(session);

  const question = "Can you check the weather and then quiz me on the next card?";
  const scene = [
    ["owner", say("Samantha", question, "owner"), true],
    ["someone else (Daniel)", say("Daniel", question, "daniel"), false],
    ["singer over music (Karen)", withMusic(say("Karen", "Tonight we dance until the morning light, oh oh oh.", "karen")), false],
    ["music alone", music(RATE * 3), false],
    ["owner over music", withMusic(say("Samantha", "Okay, next card please. I think the answer is the cytosol.", "owner-music")), true],
  ];
  const marks = [];
  let at = 0;
  for (const [label, samples, expected] of scene) {
    marks.push({ label, start: at, end: at + samples.length, expected, input: samples.speech ?? samples });
    const before = session.sent.length;
    session.feed(samples);
    session.feed(silence(1.5));
    const scores = session.sent.slice(before).filter((d) => !(d instanceof Float32Array)).map((d) => d.score.toFixed(2));
    console.log(`  scores during ${label}: ${scores.join(" ")}`);
    at += samples.length + Math.round(RATE * 1.5);
  }
  session.feed(silence(1));

  const frames = session.sent.filter((d) => d instanceof Float32Array);
  const output = new Float32Array(frames.length * FRAME);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += FRAME;
  }
  const energy = (x) => x.reduce((sum, v) => sum + v * v, 0);
  const delay = Math.round(RATE * 0.9);
  const results = marks.map((mark) => {
    const passed = energy(output.subarray(mark.start + delay, mark.end + delay)) / Math.max(1e-9, energy(mark.input));
    return { ...mark, passed };
  });
  for (const result of results) {
    console.log(`  ${result.label.padEnd(28)} passed ${(result.passed * 100).toFixed(0)}% (${result.expected ? "should pass" : "should be blocked"})`);
  }
  rmSync(scratch, { recursive: true, force: true });

  for (const result of results) {
    if (result.expected) assert.ok(result.passed > 0.5, `${result.label} should reach Vox`);
    else assert.ok(result.passed < 0.15, `${result.label} should be blocked`);
  }
});
