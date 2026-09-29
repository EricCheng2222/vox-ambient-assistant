// Speaks a long answer from the reasoning models with the text-to-speech
// endpoint. The answer is split into short pieces: the first is a sentence or
// two so Vox starts talking quickly, and the next piece is fetched while the
// current one plays. Playback is interruptible, and reports roughly how much
// was said so the live conversation knows where Vox stopped.

export type AnswerSpeechResult = {
  /** The part of the answer that was spoken, approximately. */
  spokenText: string;
  interrupted: boolean;
  /** Speech stopped because a piece could not be generated. */
  failed: boolean;
};

export type AnswerSpeech = {
  /** Resolves once the first piece starts playing; rejects if it cannot. */
  started: Promise<void>;
  done: Promise<AnswerSpeechResult>;
  stop: () => void;
  setVolume: (volume: number) => void;
};

const FIRST_PIECE_CHARACTERS = 140;
const PIECE_CHARACTERS = 520;

/** Splits an answer into speakable pieces at sentence boundaries. */
export function speechPieces(text: string) {
  const sentences =
    text
      .replace(/\s+/g, " ")
      .trim()
      .match(/[^.!?。！？；;\n]+(?:[.!?。！？；;]+|$)["'”’）)]*\s*/gu)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const limit = pieces.length === 0 ? FIRST_PIECE_CHARACTERS : PIECE_CHARACTERS;
    const joined = current ? `${current} ${sentence}` : sentence;
    if (current && joined.length > limit) {
      pieces.push(current);
      current = sentence;
    } else {
      current = joined;
    }
    // Very long sentences are cut at a comma or space so no piece is huge.
    while (current.length > PIECE_CHARACTERS * 2) {
      const cut = Math.max(
        current.lastIndexOf("，", PIECE_CHARACTERS),
        current.lastIndexOf(",", PIECE_CHARACTERS),
        current.lastIndexOf(" ", PIECE_CHARACTERS),
      );
      const at = cut > PIECE_CHARACTERS / 2 ? cut + 1 : PIECE_CHARACTERS;
      pieces.push(current.slice(0, at).trim());
      current = current.slice(at).trim();
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

let context: AudioContext | null = null;

function audioContext() {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!context || context.state === "closed") context = new AudioContext();
  return context;
}

/** Call from a user gesture (starting a conversation) so browsers allow playback later. */
export function unlockAnswerSpeech() {
  const ctx = audioContext();
  if (ctx?.state === "suspended") void ctx.resume().catch(() => undefined);
}

export function speakAnswer(options: {
  text: string;
  voice: string;
  language: string;
  volume: number;
}): AnswerSpeech {
  const pieces = speechPieces(options.text);
  const ctx = audioContext();
  const abort = new AbortController();
  const gain = ctx?.createGain();
  if (ctx && gain) {
    gain.gain.value = options.volume;
    gain.connect(ctx.destination);
  }

  let stopped = false;
  let source: AudioBufferSourceNode | null = null;
  let finishPiece: (() => void) | null = null;
  let resolveStarted!: () => void;
  let rejectStarted!: (error: unknown) => void;
  const started = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  // Callers that only await `done` must not see an unhandled rejection.
  started.catch(() => undefined);

  const fetchPiece = async (text: string) => {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: options.voice, language: options.language }),
      signal: abort.signal,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Vox could not speak that answer.");
    }
    return ctx!.decodeAudioData(await response.arrayBuffer());
  };

  const done = (async (): Promise<AnswerSpeechResult> => {
    const spoken: string[] = [];
    if (!ctx || !gain || pieces.length === 0) {
      rejectStarted(new Error("Speech playback is unavailable."));
      return { spokenText: "", interrupted: false, failed: true };
    }
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    let next: Promise<AudioBuffer> | null = fetchPiece(pieces[0]);
    for (let index = 0; index < pieces.length; index += 1) {
      let buffer: AudioBuffer;
      try {
        buffer = await next!;
      } catch (error) {
        if (index === 0) rejectStarted(error);
        return { spokenText: spoken.join(" "), interrupted: stopped, failed: !stopped };
      }
      if (stopped) break;
      next = index + 1 < pieces.length ? fetchPiece(pieces[index + 1]) : null;
      next?.catch(() => undefined);

      const playing = ctx.createBufferSource();
      playing.buffer = buffer;
      playing.connect(gain);
      source = playing;
      const startedAt = ctx.currentTime;
      await new Promise<void>((resolve) => {
        finishPiece = resolve;
        playing.onended = () => resolve();
        playing.start();
        if (index === 0) resolveStarted();
      });
      finishPiece = null;
      source = null;
      if (stopped) {
        // Keep the words heard so far, in proportion to the time played.
        const fraction = Math.min(1, (ctx.currentTime - startedAt) / Math.max(buffer.duration, 0.1));
        const piece = pieces[index];
        const heard = piece.slice(0, Math.round(piece.length * fraction)).trim();
        if (heard) spoken.push(heard);
        break;
      }
      spoken.push(pieces[index]);
    }
    gain.disconnect();
    return { spokenText: spoken.join(" "), interrupted: stopped, failed: false };
  })();

  return {
    started,
    done,
    stop: () => {
      if (stopped) return;
      stopped = true;
      // No effect once playback has started.
      rejectStarted(new DOMException("Speech was stopped.", "AbortError"));
      abort.abort();
      try {
        source?.stop();
      } catch {
        // Already stopped.
      }
      finishPiece?.();
    },
    setVolume: (volume) => {
      if (gain) gain.gain.value = Math.min(1, Math.max(0, volume));
    },
  };
}
