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

  // Defaults: only-my-voice on, noise removal off (Vox hears the raw microphone).
  worker.configure({ denoise: false, verify: true, threshold: 0.65, voiceprint: enrolled.voiceprint });
  const session = fakePort();
  new worker.Session(session);

  const question = "Can you check the weather and then quiz me on the next card?";
  const scene = [
    ["owner", say("Samantha", question, "owner"), true, 1.5],
    ["owner again after a short pause", say("Samantha", "And after that, remind me about the dentist.", "owner-again"), true, 1.5],
    ["someone else (Daniel)", say("Daniel", question, "daniel"), false, 1.5],
    ["singer over music (Karen)", withMusic(say("Karen", "Tonight we dance until the morning light, oh oh oh.", "karen")), false, 1.5],
    ["music alone", music(RATE * 3), false, 1.5],
    ["owner over music", withMusic(say("Samantha", "Okay, next card please. I think the answer is the cytosol.", "owner-music")), true, 1.5],
  ];
  const marks = [];
  let at = 0;
  for (const [label, samples, expected, gap] of scene) {
    // Noise removal is off, so what should come through is what the microphone heard.
    marks.push({ label, start: at, end: at + samples.length, expected, reference: samples });
    const before = session.sent.length;
    session.feed(samples);
    session.feed(silence(gap));
    const scores = session.sent.slice(before).filter((d) => !(d instanceof Float32Array)).map((d) => d.score.toFixed(2));
    console.log(`  scores during ${label}: ${scores.join(" ")}`);
    at += samples.length + Math.round(RATE * gap);
  }
  session.feed(silence(2));

  // Interrupting Vox while it talks: the owner should get through at once.
  const interruptStart = at + Math.round(RATE * 2);
  session.listeners.message({ data: { type: "assistant", speaking: true } });
  const interruption = say("Samantha", "Wait, stop, that's not what I meant.", "interrupt");
  session.feed(interruption);
  session.feed(silence(1.5));
  session.listeners.message({ data: { type: "assistant", speaking: false } });
  marks.push({ label: "owner interrupting Vox", start: interruptStart, end: interruptStart + interruption.length, expected: true, reference: interruption });

  const frames = session.sent.filter((d) => d instanceof Float32Array);
  const output = new Float32Array(frames.length * FRAME);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += FRAME;
  }
  const energy = (x) => x.reduce((sum, v) => sum + v * v, 0);
  // The first 0.3 s of speech in a clip (after any leading silence).
  const onsetOf = (x) => {
    let i = 0;
    while (i < x.length && Math.abs(x[i]) < 0.02) i++;
    return { index: i, samples: x.subarray(i, i + Math.round(RATE * 0.3)) };
  };
  // Best normalized correlation of the onset against the output, within 2 s.
  const onsetFound = (mark) => {
    const { index, samples } = onsetOf(mark.reference);
    const from = mark.start + index;
    const norm = Math.sqrt(energy(samples));
    let best = 0;
    let bestLag = 0;
    for (let lag = 0; lag < RATE * 2; lag += 24) {
      const window = output.subarray(from + lag, from + lag + samples.length);
      if (window.length < samples.length) break;
      let dot = 0;
      for (let i = 0; i < samples.length; i += 2) dot += samples[i] * window[i];
      const windowNorm = Math.sqrt(energy(window));
      const score = windowNorm > 0 ? (2 * dot) / (norm * windowNorm) : 0;
      if (score > best) {
        best = score;
        bestLag = lag;
      }
    }
    const at = from + bestLag;
    const presence = energy(output.subarray(at, at + samples.length)) / Math.max(1e-9, energy(samples));
    if (process.env.VOICE_FILTER_DEBUG) console.log(`    onset debug ${mark.label}: presence ${presence.toFixed(2)} at lag ${(bestLag / RATE).toFixed(2)}`);
    return { score: best, lag: bestLag / RATE, presence };
  };
  if (process.env.VOICE_FILTER_DEBUG) {
    const last = marks.at(-1);
    const bins = [];
    for (let t = last.start - RATE * 0.5; t < last.end + RATE; t += RATE / 10) bins.push(Math.sqrt(energy(output.subarray(t, t + RATE / 10)) / (RATE / 10)).toFixed(3));
    console.log(`    output rms from 0.5 s before the interruption, per 0.1 s: ${bins.join(" ")}`);
    const ref = [];
    for (let t = 0; t < last.reference.length; t += RATE / 10) ref.push(Math.sqrt(energy(last.reference.subarray(t, t + RATE / 10)) / (RATE / 10)).toFixed(3));
    console.log(`    reference rms per 0.1 s: ${ref.join(" ")}`);
  }
  const results = marks.map((mark) => {
    // Released audio can run behind by up to about a second.
    const passed = energy(output.subarray(mark.start, mark.end + Math.round(RATE * 1.4))) / Math.max(1e-9, energy(mark.reference));
    const found = mark.expected ? onsetFound(mark) : null;
    return { ...mark, passed, onset: found?.score ?? null, lag: found?.lag ?? null };
  });
  for (const result of results) {
    console.log(
      `  ${result.label.padEnd(32)} passed ${(result.passed * 100).toFixed(0)}%` +
        (result.onset === null
          ? " (should be blocked)"
          : `, first words ${result.onset >= 0.6 ? "kept" : "MISSING"} (match ${result.onset.toFixed(2)}), heard ${result.lag.toFixed(2)} s later`),
    );
  }
  rmSync(scratch, { recursive: true, force: true });

  for (const result of results) {
    if (result.expected) {
      assert.ok(result.passed > 0.7, `${result.label} should reach Vox`);
      assert.ok(result.onset >= 0.6, `${result.label} should keep its first words`);
    } else {
      assert.ok(result.passed < 0.15, `${result.label} should be blocked`);
    }
  }
});
