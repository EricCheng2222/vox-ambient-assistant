import { buildVoiceInstructions } from "@/lib/memory";
import { listMemories } from "@/lib/memory-store";
import { requireAuthorized } from "@/lib/auth";

const REALTIME_MODEL = "gpt-realtime-2.1";

export async function POST(request: Request) {
  const unauthorized = await requireAuthorized(request);
  if (unauthorized) return unauthorized;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "The OpenAI API key has not been configured yet." },
      { status: 503 },
    );
  }

  const remembered = await listMemories(24).catch((error) => {
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
          instructions: buildVoiceInstructions(remembered),
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                prompt:
                  "The speaker may use English or Mandarin. Transcribe exactly in the language spoken and never translate. When the speech is Mandarin or Chinese, always write it in Traditional Chinese as used in Taiwan, with Taiwan wording and punctuation. 使用者可能說英文或華語；請依原語言逐字轉錄，不要翻譯。華語內容一律使用台灣繁體中文、台灣用詞與標點。",
              },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "marin" },
          },
        },
      }),
    },
  );

  const payload = await response.json();
  if (!response.ok) {
    console.error("Realtime token request failed", response.status);
    return Response.json(
      { error: "OpenAI could not start a Realtime session." },
      { status: response.status },
    );
  }

  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
