// Short, original interface cues for the holographic theme, synthesized with
// Web Audio so no recorded sound assets are shipped or fetched.
export type HudCue = "online" | "offline" | "mute" | "unmute";

type Tone = {
  at: number;
  frequency: number;
  endFrequency?: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
};

const CUES: Record<HudCue, Tone[]> = {
  online: [
    { at: 0, frequency: 520, endFrequency: 1560, duration: 0.34, gain: 0.018, type: "sawtooth" },
    { at: 0.1, frequency: 1318.5, duration: 0.16, gain: 0.05 },
    { at: 0.2, frequency: 1975.5, duration: 0.28, gain: 0.045 },
  ],
  offline: [
    { at: 0, frequency: 1567.98, duration: 0.14, gain: 0.045 },
    { at: 0.1, frequency: 1046.5, duration: 0.2, gain: 0.04 },
    { at: 0.1, frequency: 1400, endFrequency: 360, duration: 0.36, gain: 0.014, type: "sawtooth" },
  ],
  mute: [{ at: 0, frequency: 740, endFrequency: 620, duration: 0.11, gain: 0.04 }],
  unmute: [{ at: 0, frequency: 1244.5, endFrequency: 1480, duration: 0.11, gain: 0.04 }],
};

let context: AudioContext | null = null;

function audioContext() {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!context || context.state === "closed") context = new AudioContext();
  return context;
}

export function playHudCue(cue: HudCue) {
  try {
    const ctx = audioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

    const start = ctx.currentTime + 0.02;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 5200;
    filter.connect(ctx.destination);

    for (const tone of CUES[cue]) {
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      const begin = start + tone.at;
      const end = begin + tone.duration;
      oscillator.type = tone.type ?? "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, begin);
      if (tone.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, end);
      }
      envelope.gain.setValueAtTime(0.0001, begin);
      envelope.gain.exponentialRampToValueAtTime(tone.gain, begin + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(envelope).connect(filter);
      oscillator.start(begin);
      oscillator.stop(end + 0.02);
    }
  } catch {
    // Interface cues are decorative; never let them affect the voice session.
  }
}
