import type { StageBlock, StageSource } from "@/lib/stage";

import { isProviderBudgetError } from "./provider-error.ts";
import { selectResponseLanguage } from "./response-language.ts";
import { collectSources, sanitizeStage, STAGE_INSTRUCTIONS, STAGE_SCHEMA, type ResponsesPayload } from "./stage-answer.ts";
import { getCurrentTimeContext } from "./time-context.ts";

// Building a dashboard panel: look the question up on the web, then pull a few
// key facts out of the answer, the same way the stage does for a spoken answer.

const WEB_TIMEOUT_MS = 25_000;
const FACTS_TIMEOUT_MS = 8_000;
export const PANEL_TITLE_MAX = 60;
const FALLBACK_SENTENCES = 3;

export type BuiltPanel = { title: string; blocks: StageBlock[]; sources: StageSource[] };

/** The lookup didn't produce a panel. `budget` marks the provider being out of budget. */
export class PanelBuildError extends Error {
  readonly budget: boolean;
  constructor(message: string, budget = false) {
    super(message);
    this.name = "PanelBuildError";
    this.budget = budget;
  }
}

type OutputPayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

function readOutputText(payload: OutputPayload) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

function trimTo(value: string, max: number) {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The answer's first sentences, for a panel whose facts couldn't be pulled out. */
export function answerSentences(answer: string, max = FALLBACK_SENTENCES) {
  return answer
    .replace(/\s+/gu, " ")
    .trim()
    // After 。！？ anywhere; after . ! ? only before a space, so "31.5" stays whole.
    .split(/(?<=[。！？])|(?<=[.!?])\s+/u)
    .map((sentence) => trimTo(sentence, 200))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * A panel's title and blocks from the facts call: no map, never empty, and a
 * title even when the model gave none.
 */
export function finishPanel(
  question: string,
  answer: string,
  stage: { title: string; blocks: StageBlock[] },
): { title: string; blocks: StageBlock[] } {
  let blocks = stage.blocks.filter((block) => block.kind !== "map");
  if (!blocks.length) {
    const items = answerSentences(answer);
    if (items.length) blocks = [{ kind: "list", title: "", items }];
  }
  const title = trimTo(stage.title, PANEL_TITLE_MAX) || trimTo(question, PANEL_TITLE_MAX);
  return { title, blocks };
}

async function postResponses(apiKey: string, timeoutMs: number, body: unknown) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as OutputPayload & ResponsesPayload;
  if (!response.ok) {
    throw new PanelBuildError(`OpenAI returned ${response.status}`, isProviderBudgetError(response, payload));
  }
  return payload;
}

/** Looks the question up on the web and returns the panel's title, facts, and sources. */
export async function buildPanel(question: string, apiKey: string): Promise<BuiltPanel> {
  const mandarin = selectResponseLanguage(question) === "taiwan_mandarin";

  let payload: Awaited<ReturnType<typeof postResponses>>;
  try {
    payload = await postResponses(apiKey, WEB_TIMEOUT_MS, {
      model: "gpt-5.6-terra",
      input: question,
      instructions:
        "Look up what the user wants to keep an eye on and write a short factual answer for a dashboard panel: the key current facts (figures, dates, names, status), each stated plainly with its unit and the date it applies to when that matters. At most about 120 words. No markdown, no lists, no links, no preamble, and no follow-up question. " +
        (mandarin
          ? "Write in Traditional Chinese as used in Taiwan."
          : "Write in English.") +
        `\n\n${getCurrentTimeContext()}`,
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      max_output_tokens: 2000,
      tools: [{ type: "web_search" }],
      store: false,
    });
  } catch (error) {
    if (error instanceof PanelBuildError) throw error;
    throw new PanelBuildError(error instanceof Error ? error.message : "The web lookup failed.");
  }
  const answer = readOutputText(payload).trim().slice(0, 8000);
  if (!answer) throw new PanelBuildError("The web lookup returned no answer.");
  const sources = collectSources(payload);

  // Stated outright: left to infer it, the model sometimes switches language.
  const language = mandarin
    ? "Write the title, every label, and every value in Traditional Chinese as used in Taiwan."
    : "Write the title, every label, and every value in English.";
  const sourceTitles = sources.map((source) => `${source.title} (${source.site})`);
  let stage: { title: string; blocks: StageBlock[] } = { title: "", blocks: [] };
  try {
    const facts = await postResponses(apiKey, FACTS_TIMEOUT_MS, {
      model: "gpt-5.6-luna",
      instructions: `${STAGE_INSTRUCTIONS} ${language}`,
      input:
        `Question:\n${question}\n\nAnswer:\n${answer}` +
        (sourceTitles.length ? `\n\nCited pages:\n${sourceTitles.map((title) => `- ${title}`).join("\n")}` : ""),
      reasoning: { effort: "low" },
      max_output_tokens: 1200,
      store: false,
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "stage", strict: true, schema: STAGE_SCHEMA },
      },
    });
    stage = sanitizeStage(JSON.parse(readOutputText(facts)));
  } catch (error) {
    if (error instanceof PanelBuildError && error.budget) throw error;
    // The answer is still good: the panel shows its first sentences instead.
    console.error("Panel facts failed", error instanceof Error ? error.message : "unknown");
  }

  const finished = finishPanel(question, answer, stage);
  if (!finished.blocks.length) throw new PanelBuildError("The web lookup returned nothing to show.");
  return { ...finished, sources };
}
