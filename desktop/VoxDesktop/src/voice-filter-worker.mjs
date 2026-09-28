// Runs in an Electron utility process: cleans the microphone for the Vox
// page on this Mac. DPDFNet removes background noise and music; when "only
// listen to my voice" is on, Silero VAD finds speech and CAM++ compares it
// with the enrolled voiceprint so only the owner's speech reaches Vox. Audio
// and voiceprints never leave this Mac.
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node");

const RATE = 48_000;
const FRAME = 480; // 10 ms at 48 kHz, matching the page's audio worklet.
const LOW_RATE = 16_000;
const DELAY_SECONDS = 0.9; // Covers the first words until a second voiceprint check confirms the speaker.
const CHECK_EVERY = 0.24 * LOW_RATE; // Re-check about four times a second of speech.
const MIN_SPEECH = 0.56 * LOW_RATE; // Shortest stretch worth a voiceprint.
const MAX_SPEECH = 1.2 * LOW_RATE; // Recent speech used per check; short so a new speaker shows quickly.
const HOLD_SECONDS = 1.2; // Keep listening briefly after a match.
const RAMP = FRAME * 2; // 20 ms fade in and out of the gate.

const modelDirectory = process.env.VOX_VOICE_MODELS ?? "";
const debug = (...args) => {
  if (process.env.VOX_VOICE_FILTER_DEBUG) console.error("[voice-filter]", ...args);
};
const model = (name) => path.join(modelDirectory, name);

let denoiser = null;
let extractor = null;
let settings = { denoise: true, verify: false, threshold: 0.65, voiceprint: null };
let enrollment = null;

function post(message) {
  process.parentPort?.postMessage(message);
}

export function load() {
  try {
    denoiser = new sherpa.OnlineSpeechDenoiser({
      model: { dpdfnet: { model: model("dpdfnet2_48khz_hr.onnx") }, numThreads: 1, debug: 0, provider: "cpu" },
    });
    extractor = new sherpa.SpeakerEmbeddingExtractor({ model: model("campplus_zh_en.onnx"), numThreads: 1, debug: 0 });
    post({ type: "ready" });
  } catch (error) {
    post({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 48 kHz to 16 kHz for speech detection and voiceprints: a short low-pass
 * filter, then every third sample. (Done in JavaScript because Electron
 * doesn't allow the native resampler's external buffers.)
 */
class Downsampler {
  constructor() {
    // 15-tap windowed-sinc low-pass at about 7 kHz.
    const taps = 15;
    const cutoff = 7_000 / RATE;
    this.kernel = new Float32Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const n = i - (taps - 1) / 2;
      const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
      const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
      this.kernel[i] = sinc * window;
      sum += this.kernel[i];
    }
    for (let i = 0; i < taps; i++) this.kernel[i] /= sum;
    this.history = new Float32Array(taps - 1);
    this.phase = 0;
  }

  resample(input) {
    const taps = this.kernel.length;
    const buffer = new Float32Array(this.history.length + input.length);
    buffer.set(this.history);
    buffer.set(input, this.history.length);
    const out = [];
    for (let i = this.phase; i + taps <= buffer.length; i += 3) {
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += buffer[i + k] * this.kernel[k];
      out.push(acc);
      this.phase = i + 3;
    }
    // Keep the tail for the next call and carry the decimation phase over.
    const keepFrom = buffer.length - this.history.length;
    this.phase -= keepFrom;
    this.history = buffer.slice(keepFrom);
    return Float32Array.from(out);
  }
}

/** Audio frames arrive as a Float32Array (or its bytes) from the page. */
function asFrame(data) {
  if (data instanceof Float32Array) return data;
  if (data instanceof ArrayBuffer) return new Float32Array(data);
  if (ArrayBuffer.isView(data)) return new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
  return null;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function embed(samples) {
  const stream = extractor.createStream();
  stream.acceptWaveform({ samples, sampleRate: LOW_RATE });
  stream.inputFinished();
  return extractor.isReady(stream) ? extractor.compute(stream, false) : null;
}

/** Holds the most recent stretch of speech at 16 kHz. */
class SpeechBuffer {
  constructor(capacity) {
    this.data = new Float32Array(capacity);
    this.length = 0;
  }
  push(samples) {
    if (samples.length >= this.data.length) {
      this.data.set(samples.subarray(samples.length - this.data.length));
      this.length = this.data.length;
      return;
    }
    const overflow = Math.max(0, this.length + samples.length - this.data.length);
    if (overflow) {
      this.data.copyWithin(0, overflow, this.length);
      this.length -= overflow;
    }
    this.data.set(samples, this.length);
    this.length += samples.length;
  }
  recent(count) {
    return this.data.slice(Math.max(0, this.length - count), this.length);
  }
  clear() {
    this.length = 0;
  }
}

/** One live microphone connection from the Vox page. */
export class Session {
  constructor(port) {
    this.port = port;
    this.resampler = new Downsampler();
    this.vad = new sherpa.Vad(
      {
        sileroVad: { model: model("silero_vad.onnx"), threshold: 0.5, minSpeechDuration: 0.2, minSilenceDuration: 0.3, windowSize: 512 },
        sampleRate: LOW_RATE,
        numThreads: 1,
        debug: 0,
      },
      30,
    );
    this.pending = new Float32Array(0); // 16 kHz samples waiting for a VAD window.
    this.speech = new SpeechBuffer(MAX_SPEECH);
    this.sinceCheck = 0;
    this.inSpeech = false;
    this.delay = new Float32Array(Math.round(RATE * DELAY_SECONDS));
    this.delayIndex = 0;
    this.gain = 0;
    this.openUntil = 0; // In 48 kHz samples processed.
    this.clock = 0;
    this.lastScore = null;
    this.frames = 0;
    debug("session started");
    port.on("message", (event) => this.onFrame(event.data));
    port.on("close", () => this.close());
    port.start();
  }

  onFrame(data) {
    const input = asFrame(data);
    if (!this.frames++) debug("first frame", Object.prototype.toString.call(data), input?.length);
    if (!input || input.length !== FRAME) return;
    let clean = input;
    if (settings.denoise && denoiser) {
      const result = denoiser.run({ samples: input, sampleRate: RATE, enableExternalBuffer: false });
      clean = result.samples.length === FRAME ? result.samples : new Float32Array(FRAME);
    }
    this.clock += FRAME;
    const verifying = settings.verify && settings.voiceprint && extractor;
    const output = verifying ? this.gate(clean) : clean;
    this.port.postMessage(Float32Array.from(output));
  }

  /** Passes delayed audio only while the speech matches the owner's voiceprint. */
  gate(clean) {
    const low = this.resampler.resample(clean);
    const merged = new Float32Array(this.pending.length + low.length);
    merged.set(this.pending);
    merged.set(low, this.pending.length);
    let offset = 0;
    while (merged.length - offset >= 512) {
      const window = merged.subarray(offset, offset + 512);
      this.vad.acceptWaveform(window);
      const speaking = this.vad.isDetected();
      while (!this.vad.isEmpty()) this.vad.pop();
      if (speaking) {
        if (!this.inSpeech) {
          this.inSpeech = true;
          this.speech.clear();
          this.sinceCheck = 0;
        }
        this.speech.push(window);
        this.sinceCheck += window.length;
        if (this.speech.length >= MIN_SPEECH && this.sinceCheck >= CHECK_EVERY) {
          this.sinceCheck = 0;
          const embedding = embed(this.speech.recent(MAX_SPEECH));
          if (embedding) {
            this.lastScore = cosine(embedding, settings.voiceprint);
            const matched = this.lastScore >= settings.threshold;
            if (matched) {
              // Open for the delayed audio of this utterance too.
              this.openUntil = this.clock + Math.round(RATE * (DELAY_SECONDS + HOLD_SECONDS));
            } else if (this.lastScore < settings.threshold - 0.1) {
              this.openUntil = 0;
            }
            this.port.postMessage({ type: "state", matched, score: Math.round(this.lastScore * 1000) / 1000 });
          }
        }
      } else if (this.inSpeech) {
        this.inSpeech = false;
      }
      offset += 512;
    }
    this.pending = merged.slice(offset);

    // Delay line: what leaves now was spoken DELAY_SECONDS ago.
    const out = new Float32Array(FRAME);
    const open = this.clock <= this.openUntil;
    for (let i = 0; i < FRAME; i++) {
      out[i] = this.delay[this.delayIndex] * this.gain;
      this.delay[this.delayIndex] = clean[i];
      this.delayIndex = (this.delayIndex + 1) % this.delay.length;
      this.gain = open ? Math.min(1, this.gain + 1 / RAMP) : Math.max(0, this.gain - 1 / RAMP);
    }
    return out;
  }

  close() {
    sessions.delete(this);
  }
}

const sessions = new Set();

/** Collects the owner's clean speech while they read the setup sentences. */
export class Enrollment {
  constructor(port) {
    this.port = port;
    this.resampler = new Downsampler();
    this.vad = new sherpa.Vad(
      {
        sileroVad: { model: model("silero_vad.onnx"), threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.25, windowSize: 512 },
        sampleRate: LOW_RATE,
        numThreads: 1,
        debug: 0,
      },
      120,
    );
    this.pending = new Float32Array(0);
    this.segments = [];
    port.on("message", (event) => this.onFrame(event.data));
    port.start();
  }

  onFrame(data) {
    const input = asFrame(data);
    if (!input || input.length !== FRAME) return;
    const clean = denoiser ? denoiser.run({ samples: input, sampleRate: RATE, enableExternalBuffer: false }).samples : input;
    // Echo the audio so the page's level meter shows it's hearing the user.
    this.port.postMessage(Float32Array.from(clean));
    const low = this.resampler.resample(clean.length === FRAME ? clean : input);
    const merged = new Float32Array(this.pending.length + low.length);
    merged.set(this.pending);
    merged.set(low, this.pending.length);
    let offset = 0;
    while (merged.length - offset >= 512) {
      this.vad.acceptWaveform(merged.subarray(offset, offset + 512));
      offset += 512;
    }
    this.pending = merged.slice(offset);
    while (!this.vad.isEmpty()) {
      this.segments.push(this.vad.front(false).samples);
      this.vad.pop();
    }
  }

  finish() {
    this.vad.flush();
    while (!this.vad.isEmpty()) {
      this.segments.push(this.vad.front(false).samples);
      this.vad.pop();
    }
    const speech = this.segments.reduce((total, segment) => total + segment.length, 0);
    if (speech < 8 * LOW_RATE) {
      throw new Error("Vox needs about 8 seconds of your speech. Read the sentences aloud, a little closer to the microphone.");
    }
    // Several embeddings over 3-second pieces, averaged and normalized.
    const all = new Float32Array(speech);
    let at = 0;
    for (const segment of this.segments) {
      all.set(segment, at);
      at += segment.length;
    }
    const piece = 3 * LOW_RATE;
    const embeddings = [];
    for (let start = 0; start + LOW_RATE * 1.5 <= all.length; start += piece) {
      const embedding = embed(all.subarray(start, Math.min(all.length, start + piece)));
      if (embedding) embeddings.push(embedding);
    }
    if (!embeddings.length) throw new Error("Vox couldn't learn your voice from that recording. Try again.");
    const mean = new Float32Array(embeddings[0].length);
    for (const embedding of embeddings) {
      const norm = Math.hypot(...embedding) || 1;
      for (let i = 0; i < mean.length; i++) mean[i] += embedding[i] / norm / embeddings.length;
    }
    // How consistent the pieces are: a quick quality check for the recording.
    const consistency = embeddings.reduce((sum, embedding) => sum + cosine(embedding, mean), 0) / embeddings.length;
    return { voiceprint: Array.from(mean), seconds: Math.round(speech / LOW_RATE), consistency };
  }
}

export function configure(message) {
  settings = {
    denoise: message.denoise !== false,
    verify: message.verify === true,
    threshold: Number.isFinite(message.threshold) ? message.threshold : 0.65,
    voiceprint: Array.isArray(message.voiceprint) ? Float32Array.from(message.voiceprint) : null,
  };
}

function onMessage(event) {
  const message = event.data ?? {};
  const [port] = event.ports ?? [];
  switch (message.type) {
    case "configure":
      configure(message);
      break;
    case "session":
      if (port) sessions.add(new Session(port));
      break;
    case "enroll-start":
      if (port) enrollment = new Enrollment(port);
      break;
    case "enroll-finish":
      try {
        if (!enrollment) throw new Error("Voice setup wasn't running.");
        post({ type: "enrolled", id: message.id, ...enrollment.finish() });
      } catch (error) {
        post({ type: "enroll-failed", id: message.id, message: error instanceof Error ? error.message : String(error) });
      } finally {
        enrollment?.port.close();
        enrollment = null;
      }
      break;
    case "enroll-cancel":
      enrollment?.port.close();
      enrollment = null;
      break;
    default:
      break;
  }
}

// In the Electron utility process; tests import the classes directly.
if (process.parentPort) {
  process.parentPort.on("message", onMessage);
  load();
}
