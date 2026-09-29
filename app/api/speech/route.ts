import { requireUser } from "@/lib/auth";
import { API_BUDGET_MESSAGE, isProviderBudgetError } from "@/lib/provider-error";
import { parseRealtimeVoice } from "@/lib/realtime-voice";

// Speaks a long answer from the reasoning models with a text-to-speech model,
// in the same voice as the live conversation. The page sends the answer a few
// sentences at a time so playback starts quickly.

const TTS_MODEL = "gpt-4o-mini-tts";
const MAX_CHARACTERS = 1_800;

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "The speech service is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    text?: unknown;
    voice?: unknown;
    language?: unknown;
  };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_CHARACTERS) : "";
  if (!text) return Response.json({ error: "Text is required." }, { status: 400 });
  const mandarin = body.language === "taiwan_mandarin";

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: parseRealtimeVoice(body.voice),
      input: text,
      instructions:
        "You are Vox, a personal voice assistant, explaining something carefully to the person you are talking with. " +
        "Speak naturally and warmly at a steady, unhurried pace, with clear pauses between ideas. " +
        (mandarin
          ? "Speak Taiwan Mandarin with natural Taiwanese pronunciation; say English terms inside Chinese sentences in natural English."
          : "Speak natural English; pronounce any Chinese words correctly."),
      response_format: "mp3",
    }),
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    console.error("Speech request failed", response.status);
    return Response.json(
      {
        error: isProviderBudgetError(response, payload)
          ? API_BUDGET_MESSAGE
          : "Vox could not speak that answer.",
      },
      { status: response.status || 502 },
    );
  }

  return new Response(response.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
