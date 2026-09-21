export type ResponseLanguage = "taiwan_mandarin" | "english";

type LanguageMessage = {
  role?: string;
  text: string;
};

const FILLER_ONLY =
  /^(?:um+|uh+|h+m+|er+|ah+|eh+|嗯+|呃+|欸+|誒+|喔+|哦+|啊+|唉+|對+|好+|好吧+)$/iu;

function isFillerOnly(text: string) {
  const fragments = text
    .trim()
    .toLocaleLowerCase()
    .split(/[\s,.…?!，。！？、：:;~〜-]+/u)
    .filter(Boolean);

  return fragments.length > 0 && fragments.every((fragment) => FILLER_ONLY.test(fragment));
}

export function detectSubstantiveLanguage(text: string): ResponseLanguage | null {
  const clean = text.trim();
  if (!clean || isFillerOnly(clean)) return null;

  const hanCharacters = clean.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinWords = clean.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)?.length ?? 0;

  if (hanCharacters === 0) return latinWords > 0 ? "english" : null;
  if (latinWords === 0) return "taiwan_mandarin";

  // Han characters carry meaning individually while Latin text is more naturally
  // compared by words. This keeps quoted Chinese inside an English question from
  // changing the reply language while still recognizing common mixed Mandarin.
  return hanCharacters >= Math.max(2, latinWords)
    ? "taiwan_mandarin"
    : "english";
}

export function selectResponseLanguage(
  currentText: string,
  recentMessages: LanguageMessage[] = [],
): ResponseLanguage {
  const currentLanguage = detectSubstantiveLanguage(currentText);
  if (currentLanguage) return currentLanguage;

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    if (message.role && message.role !== "user") continue;
    const language = detectSubstantiveLanguage(message.text);
    if (language) return language;
  }

  return "taiwan_mandarin";
}

export function responseLanguageInstruction(language: ResponseLanguage) {
  if (language === "taiwan_mandarin") {
    return "## Response language for this turn — mandatory\nThe user's current substantive utterance is Mandarin or Chinese. Respond entirely in natural Taiwan Mandarin. Write and speak in Traditional Chinese with Taiwan vocabulary, phrasing, and relaxed pacing. Keep every acknowledgement, preamble, status update, and final answer in Taiwan Mandarin. Do not answer in English or switch languages unless the user explicitly asks. English names and technical terms are allowed only when they are naturally necessary.";
  }

  return "## Response language for this turn — mandatory\nThe user's current substantive utterance is English. Respond entirely in English. Keep every acknowledgement, preamble, status update, and final answer in English. Do not switch languages unless the user explicitly asks.";
}
