import { getCurrentTimeContext } from "./time-context.ts";

type WebSearchAnnotation = {
  type?: string;
  title?: string;
  url?: string;
};

type WebSearchPayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: WebSearchAnnotation[];
    }>;
  }>;
  error?: { message?: string };
};

export type PhoneWebSearchResult = {
  answer: string;
  sources: string[];
};

export function normalizePhoneWebQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/gu, " ").trim().slice(0, 500);
}

function stripLinksForSpeech(value: string) {
  return value
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/giu, "$1")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/\s+([,.;:!?，。；：！？])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function readPhoneWebSearchResult(payload: WebSearchPayload): PhoneWebSearchResult {
  const content = (payload.output ?? []).flatMap((item) => item.content ?? []);
  const answer = stripLinksForSpeech(
    payload.output_text || content
      .filter((item) => item.type === "output_text")
      .map((item) => item.text ?? "")
      .join("\n"),
  ).slice(0, 4_000);
  const sources = Array.from(new Set(
    content
      .flatMap((item) => item.annotations ?? [])
      .filter((annotation) => annotation.type === "url_citation")
      .map((annotation) => annotation.title?.trim() ?? "")
      .filter(Boolean),
  )).slice(0, 5);
  return { answer, sources };
}

export function buildPhoneWebSearchRequest(query: string, now = new Date()) {
  return {
    model: "gpt-4.1-mini",
    tools: [
      {
        type: "web_search",
        user_location: {
          type: "approximate",
          country: "TW",
          timezone: "Asia/Taipei",
        },
      },
    ],
    tool_choice: "required",
    input: query,
    instructions: [
      "Search the live web and answer the caller's exact question with current, concrete facts.",
      "Use the caller's language. For Mandarin, use natural Taiwan Traditional Chinese.",
      "This result will be spoken on a phone call: keep it concise, lead with the answer, and do not include Markdown, citation syntax, or raw URLs.",
      "For weather, include the current condition and temperature when available, plus today's high/low, rain chance, and a brief practical note. Do not invent missing measurements.",
      getCurrentTimeContext(now),
    ].join("\n\n"),
    max_output_tokens: 700,
    store: false,
    text: { verbosity: "low" },
  };
}

export async function searchPhoneWeb(
  queryValue: unknown,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PhoneWebSearchResult> {
  const query = normalizePhoneWebQuery(queryValue);
  if (!query) throw new Error("A web search query is required.");
  if (!apiKey) throw new Error("Web search is not configured.");

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "vox-private-phone-web-search",
    },
    body: JSON.stringify(buildPhoneWebSearchRequest(query)),
  });
  const payload = await response.json().catch(() => ({})) as WebSearchPayload;
  if (!response.ok) {
    throw new Error(payload.error?.message || `Web search failed (${response.status}).`);
  }
  const result = readPhoneWebSearchResult(payload);
  if (!result.answer) throw new Error("Web search returned no spoken answer.");
  return result;
}
