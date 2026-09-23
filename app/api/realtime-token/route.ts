import { buildVoiceInstructions } from "@/lib/memory";
import { transcriptionConfig } from "@/lib/transcription-language";
import { listMemories } from "@/lib/memory-store";
import { requireUser } from "@/lib/auth";
import { parseRealtimeVoice } from "@/lib/realtime-voice";
import { parseReplyLength, replyLengthInstruction } from "@/lib/reply-length";
import { API_BUDGET_MESSAGE, isProviderBudgetError } from "@/lib/provider-error";
import { realtimeTruncationConfig } from "@/lib/conversation-context";

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
    mandarinTranscription?: unknown;
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
          truncation: realtimeTruncationConfig(),
          instructions: `${buildVoiceInstructions(remembered)}\n\n${replyLengthInstruction(replyLength)}`,
          audio: {
            input: {
              transcription: transcriptionConfig(requestBody.mandarinTranscription === true),
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
