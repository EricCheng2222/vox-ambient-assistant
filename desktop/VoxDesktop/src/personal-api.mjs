const realtimeVoices = new Set([
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
]);

export function validOpenAIKey(value) {
  return typeof value === "string" && /^sk-[A-Za-z0-9_-]{20,}$/u.test(value.trim());
}

export function personalRealtimeSession(request = {}) {
  const voice = realtimeVoices.has(request.voice) ? request.voice : "marin";
  const instructions =
    typeof request.instructions === "string"
      ? request.instructions.trim().slice(0, 30_000)
      : "Be a warm, natural, interruptible voice companion.";
  const mandarin = request.mandarinTranscription === true;

  return {
    type: "realtime",
    model: "gpt-realtime-2.1",
    output_modalities: ["audio"],
    instructions,
    audio: {
      input: {
        transcription: {
          model: "gpt-4o-mini-transcribe",
          ...(mandarin ? { language: "zh" } : {}),
          prompt: [
            mandarin
              ? "這段對話以台灣華語為主。中文逐字稿一律使用繁體中文，不要轉成英文、拼音或簡體中文。"
              : "The speaker may use English or Mandarin. Mandarin speech must be written in Taiwan Traditional Chinese, not translated into English.",
            "Transcribe only audible speech verbatim, never translate or answer it. Preserve English names and code-switching such as LINE, Safari, YouTube and Vox exactly as spoken. Preserve fillers, hesitation, repetitions and unfinished sentences: um, uh, hmm, 嗯、呃、欸、那個、就是。 Silence is not speech.",
          ].join(" "),
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: false,
          interrupt_response: false,
        },
      },
      output: { voice },
    },
  };
}

export async function createPersonalRealtimeSecret(apiKey, request, fetchImpl = fetch) {
  if (!validOpenAIKey(apiKey)) throw new Error("Add a valid OpenAI API key first.");

  const response = await fetchImpl("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "vox-desktop-personal",
    },
    body: JSON.stringify({ session: personalRealtimeSession(request) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.value !== "string") {
    const providerMessage =
      typeof payload?.error?.message === "string" ? payload.error.message : "";
    if (response.status === 401) throw new Error("OpenAI rejected this API key. Replace it and try again.");
    if (response.status === 429) throw new Error("Your OpenAI account has reached a usage or rate limit.");
    throw new Error(providerMessage || "OpenAI could not create a private voice session.");
  }
  return {
    value: payload.value,
    expires_at: typeof payload.expires_at === "number" ? payload.expires_at : undefined,
  };
}
