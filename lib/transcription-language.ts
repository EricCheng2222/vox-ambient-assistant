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
