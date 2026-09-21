import type { MemoryCategory } from "./memory";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ResponsePayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

const MEMORY_SUMMARY_LIMIT = 180;

function readOutputText(payload: ResponsePayload) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

export function normalizeMemorySummary(value: string) {
  return value
    .trim()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim()
    .slice(0, MEMORY_SUMMARY_LIMIT);
}

export async function summarizeMemory({
  apiKey,
  category,
  utterance,
  previousContent,
  fetcher = fetch,
}: {
  apiKey: string;
  category: MemoryCategory;
  utterance: string;
  previousContent?: string;
  fetcher?: Fetcher;
}) {
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      store: false,
      input: JSON.stringify({
        category,
        new_user_statement: utterance,
        previous_memory: previousContent ?? null,
      }),
      instructions:
        "Rewrite the supplied information as one compact, durable memory for a personal voice assistant. Summarize the meaning; never copy transcript-style wording, filler words, repetition, false starts, or speech-recognition artifacts. Preserve only facts explicitly supported by the input and do not infer sensitive details. Use a neutral standalone fact, not a quote and not phrases such as 'the user said'. Preserve the language of the new statement; for Mandarin, use natural Taiwan Mandarin in Traditional Chinese. When previous_memory is present, produce a complete replacement that keeps still-valid information and incorporates corrections without retaining superseded details. Prefer 8–18 English words or 12–35 Chinese characters, and never exceed 140 characters.",
      max_output_tokens: 160,
      text: {
        format: {
          type: "json_schema",
          name: "memory_summary",
          strict: true,
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
            },
            required: ["summary"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Memory summarization returned ${response.status}`);
  }

  const output = readOutputText((await response.json()) as ResponsePayload);
  const parsed = JSON.parse(output) as { summary?: unknown };
  const summary =
    typeof parsed.summary === "string"
      ? normalizeMemorySummary(parsed.summary)
      : "";
  if (!summary) throw new Error("Memory summarization returned no text");
  return summary;
}
