// The Vox desktop app's voice filter (Mac only): background noise and music
// removal, and optionally "only listen to my voice". The page routes the
// microphone through an audio worklet; the desktop app does the processing on
// this Mac. On the web and on phones none of this exists and the microphone
// is used directly.

export type VoiceFilterStrictness = "relaxed" | "normal" | "strict";

export type VoiceFilterStatus = {
  available: boolean;
  secureStorageAvailable: boolean;
  denoise: boolean;
  onlyMyVoice: boolean;
  strictness: VoiceFilterStrictness;
  enrolled: boolean;
  enrolledAt: string | null;
  error: string | null;
};

export type VoiceFilterBridge = {
  status: () => Promise<VoiceFilterStatus>;
  update: (changes: Partial<Pick<VoiceFilterStatus, "denoise" | "onlyMyVoice" | "strictness">>) => Promise<VoiceFilterStatus>;
  finishEnrollment: () => Promise<VoiceFilterStatus & { seconds: number; consistency: number }>;
  cancelEnrollment: () => Promise<boolean>;
  forget: () => Promise<VoiceFilterStatus>;
};

export function voiceFilterBridge(): VoiceFilterBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { voxLocalCodex?: { voiceFilter?: VoiceFilterBridge } }).voxLocalCodex?.voiceFilter ?? null;
}

export type FilteredMicrophone = {
  stream: MediaStream;
  /** Called with the latest voiceprint check while "only my voice" is on. */
  onState: (listener: (state: { matched: boolean; score: number }) => void) => void;
  /** Called with each processed frame's level (0–1), for a meter. */
  onLevel: (listener: (level: number) => void) => void;
  stop: () => void;
};

/**
 * Routes a microphone stream through the desktop voice filter. "session" is a
 * live conversation; "enroll" records the owner's voice for the voiceprint.
 */
export async function filterMicrophone(raw: MediaStream, kind: "session" | "enroll"): Promise<FilteredMicrophone> {
  const context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
  await context.audioWorklet.addModule("/vox-voice-filter-worklet.js");
  const source = context.createMediaStreamSource(raw);
  const node = new AudioWorkletNode(context, "vox-voice-filter", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
  });
  const destination = context.createMediaStreamDestination();
  destination.channelCount = 1;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(node);
  node.connect(destination);
  node.connect(analyser);

  const stateListeners: Array<(state: { matched: boolean; score: number }) => void> = [];
  node.port.onmessage = (event) => {
    const data = event.data as { type?: string; matched?: boolean; score?: number };
    if (data?.type === "state" && typeof data.score === "number") {
      for (const listener of stateListeners) listener({ matched: data.matched === true, score: data.score });
    }
  };

  // One end goes to the worklet, the other to the desktop app (through the
  // preload script), so audio flows directly between them.
  const channel = new MessageChannel();
  node.port.postMessage({ type: "link", port: channel.port1 }, [channel.port1]);
  window.postMessage({ type: "vox-voice-filter:connect", kind }, window.location.origin, [channel.port2]);

  let levelTimer = 0;
  const levelListeners: Array<(level: number) => void> = [];
  const samples = new Float32Array(analyser.fftSize);
  const measure = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) sum += value * value;
    const level = Math.min(1, Math.sqrt(sum / samples.length) * 6);
    for (const listener of levelListeners) listener(level);
  };

  return {
    stream: destination.stream,
    onState: (listener) => stateListeners.push(listener),
    onLevel: (listener) => {
      levelListeners.push(listener);
      if (!levelTimer) levelTimer = window.setInterval(measure, 80);
    },
    stop: () => {
      window.clearInterval(levelTimer);
      channel.port2.close();
      source.disconnect();
      node.disconnect();
      void context.close().catch(() => undefined);
    },
  };
}
