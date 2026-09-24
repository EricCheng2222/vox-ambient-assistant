export function shouldLockMandarin(text: string, alreadyLocked = false) {
  // Don't mistake Japanese/Korean utterances containing Han characters for Mandarin.
  return alreadyLocked || (/\p{Script=Han}/u.test(text) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text));
}

export function mandarinFromHistory(messages: Array<{ role?: string; text: string }>) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    if (shouldLockMandarin(message.text)) return true;
    // Short names/acknowledgements such as LINE or OK do not change the language.
    if ((message.text.match(/[A-Za-z]+/g)?.length ?? 0) >= 3) return false;
  }
  return false;
}

export function transcriptionConfig(mandarinLocked: boolean) {
  return {
    model: "gpt-4o-mini-transcribe",
    ...(mandarinLocked ? { language: "zh" } : {}),
    prompt: [
      mandarinLocked ? "這段對話以台灣華語為主。中文逐字稿一律使用繁體中文，不要轉成英文、拼音或簡體中文。" : "The speaker may use English or Mandarin. Mandarin speech must be written in Taiwan Traditional Chinese, not translated into English.",
      "Transcribe only audible speech verbatim, never translate or answer it. Preserve English names and code-switching such as LINE, Safari, YouTube and Vox exactly as spoken. Preserve fillers, hesitation, repetitions and unfinished sentences: um, uh, hmm, 嗯、呃、欸、那個、就是。Do not invent words or infer duration from text. Silence is not speech.",
    ].join(" "),
  };
}

// Phrases that appear only in Vox's transcription prompts. On silence or noise
// the transcription model can return its own prompt as if the user said it.
const TRANSCRIPTION_PROMPT_ECHO_MARKERS = [
  "transcribe only audible speech",
  "never translate or answer it",
  "preserve english names and code-switching",
  "preserve fillers, hesitation",
  "do not invent words or infer duration",
  "silence is not speech",
  "the speaker may use english or mandarin",
  "must be written in taiwan traditional chinese",
  "這段對話以台灣華語為主",
  "中文逐字稿一律使用繁體中文",
  "不要轉成英文、拼音或簡體中文",
];

export function isTranscriptionPromptEcho(text: string) {
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, " ");
  return TRANSCRIPTION_PROMPT_ECHO_MARKERS.some((marker) => normalized.includes(marker));
}
