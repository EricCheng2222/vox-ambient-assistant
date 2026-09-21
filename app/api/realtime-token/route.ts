import { buildVoiceInstructions } from "@/lib/memory";
import { listMemories } from "@/lib/memory-store";
import { requireUser } from "@/lib/auth";
import { parseRealtimeVoice } from "@/lib/realtime-voice";
import { parseReplyLength, replyLengthInstruction } from "@/lib/reply-length";
import { API_BUDGET_MESSAGE, isProviderBudgetError } from "@/lib/provider-error";

const REALTIME_MODEL = "gpt-realtime-2.1";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "The live voice service has not been configured yet." },
      { status: 503 },
    );
  }

  const requestBody = (await request.json().catch(() => ({}))) as {
    voice?: unknown;
    replyLength?: unknown;
  };
  const voice = parseRealtimeVoice(requestBody.voice);
  const replyLength = parseReplyLength(requestBody.replyLength);

  const remembered = await listMemories(auth.user.id, 24).catch((error) => {
    console.error("Starting Realtime without saved memory", error);
    return [];
  });

  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": "vox-web-guest",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          output_modalities: ["audio"],
          instructions: `${buildVoiceInstructions(remembered)}\n\n${replyLengthInstruction(replyLength)}`,
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                prompt:
                  "The speaker may use English or Mandarin. Transcribe verbatim in the language spoken and never translate. Preserve hesitation sounds, filler words, self-corrections, and trailing speech such as um, uh, hmm, er, 嗯, 呃, 欸, 那個, and 就是 instead of silently removing them. If a final sound or word is conspicuously prolonged, preserve that delivery with a natural repeated sound or ellipsis instead of polishing it into a finished sentence. When the speech is Mandarin or Chinese, always write it in Traditional Chinese as used in Taiwan, with Taiwan wording and punctuation. 使用者可能說英文或華語；請依原語言逐字轉錄，不要翻譯，並保留嗯、呃、欸、那個、就是等語助詞、停頓、自我修正與拖長音。華語內容一律使用台灣繁體中文、台灣用詞與標點。",
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
        },
      }),
    },
  );

  const payload = await response.json();
  if (!response.ok) {
    console.error("Realtime token request failed", response.status);
    return Response.json(
      {
        error: isProviderBudgetError(response, payload)
          ? API_BUDGET_MESSAGE
          : "Vox could not start a live voice session.",
      },
      { status: response.status },
    );
  }

  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
