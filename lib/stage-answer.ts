import type { StageBlock, StageSource } from "@/lib/stage";

// Turning a web answer into stage content: the pages it cited (from the
// Responses API's url_citation annotations) and a few facts pulled out of the
// answer by a small structured-output call.

export const MAX_STAGE_SOURCES = 5;
export const MAX_STAGE_BLOCKS = 3;

type Annotation = { type?: string; url?: string; title?: string };
export type ResponsesPayload = {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; annotations?: Annotation[] }> }>;
};

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The cited page's URL without the tracking parameter OpenAI adds. */
function citationUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (url.searchParams.get("utm_source") === "openai") url.searchParams.delete("utm_source");
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/** url_citation annotations on the answer's output_text parts, deduplicated by URL, in order. */
export function collectSources(payload: ResponsesPayload, max = MAX_STAGE_SOURCES): StageSource[] {
  const sources: StageSource[] = [];
  const seen = new Set<string>();
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      for (const annotation of part.annotations ?? []) {
        if (annotation?.type !== "url_citation" || typeof annotation.url !== "string") continue;
        const url = citationUrl(annotation.url);
        if (!url) continue;
        const key = url.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        const site = url.hostname.toLowerCase().replace(/^www\./u, "");
        sources.push({ url: key, title: clean(annotation.title, 200) || site, site, image: null, excerpt: null });
        if (sources.length >= max) return sources;
      }
    }
  }
  return sources;
}

const stringArray = { type: "array", items: { type: "string" } };

/** Strict json_schema for { title, blocks } following the StageBlock union. */
export const STAGE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    blocks: {
      type: "array",
      maxItems: MAX_STAGE_BLOCKS,
      items: {
        anyOf: [
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["facts"] },
              title: { type: "string" },
              rows: {
                type: "array",
                items: {
                  type: "object",
                  properties: { label: { type: "string" }, value: { type: "string" } },
                  required: ["label", "value"],
                  additionalProperties: false,
                },
              },
            },
            required: ["kind", "title", "rows"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["table"] },
              title: { type: "string" },
              columns: stringArray,
              rows: { type: "array", items: stringArray },
            },
            required: ["kind", "title", "columns", "rows"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: { kind: { type: "string", enum: ["steps", "list"] }, title: { type: "string" }, items: stringArray },
            required: ["kind", "title", "items"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: { kind: { type: "string", enum: ["quote"] }, text: { type: "string" }, source: { type: ["string", "null"] } },
            required: ["kind", "text", "source"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["title", "blocks"],
  additionalProperties: false,
} as const;

export const STAGE_INSTRUCTIONS =
  "You prepare the on-screen companion for a spoken answer. Given the user's question, the answer, and the titles of the pages it cited, return a short title for the topic (a few words, in the answer's language) and at most 3 blocks that show key facts from the answer at a glance: facts (label and value pairs, such as a date, price, score, or place), table (only when the answer compares several items on the same attributes), steps (an ordered procedure), list (a few parallel items), or quote (a short sentence quoted in the answer, with its source name if the answer gives one, else null). Use only facts stated in the answer, in the answer's language and wording. Never add, estimate, convert, or complete a value, and never use a source title as a fact. Keep labels and values short. If nothing in the answer benefits from being shown, return an empty blocks array.";

function strings(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value) ? value.map((item) => clean(item, maxLength)).filter(Boolean).slice(0, maxItems) : [];
}

/** The model's { title, blocks }, checked against the StageBlock union and trimmed. */
export function sanitizeStage(value: unknown): { title: string; blocks: StageBlock[] } {
  const input = (value && typeof value === "object" ? value : {}) as { title?: unknown; blocks?: unknown };
  const blocks: StageBlock[] = [];
  for (const raw of Array.isArray(input.blocks) ? input.blocks : []) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    const title = clean(block.title, 120);
    if (block.kind === "facts") {
      const rows = (Array.isArray(block.rows) ? block.rows : [])
        .map((row) => {
          const item = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
          return { label: clean(item.label, 60), value: clean(item.value, 200) };
        })
        .filter((row) => row.label && row.value)
        .slice(0, 8);
      if (rows.length) blocks.push({ kind: "facts", title, rows });
    } else if (block.kind === "table") {
      const columns = strings(block.columns, 6, 60);
      const rows = (Array.isArray(block.rows) ? block.rows : [])
        .map((row) => {
          // Cells keep their positions: pad or cut to the column count.
          const cells = Array.isArray(row) ? row.slice(0, columns.length).map((cell) => clean(cell, 120)) : [];
          return [...cells, ...Array<string>(columns.length - cells.length).fill("")];
        })
        .filter((row) => row.some(Boolean))
        .slice(0, 12);
      if (columns.length && rows.length) blocks.push({ kind: "table", title, columns, rows });
    } else if (block.kind === "steps" || block.kind === "list") {
      const items = strings(block.items, 10, 200);
      if (items.length) blocks.push({ kind: block.kind, title, items });
    } else if (block.kind === "quote") {
      const text = clean(block.text, 400);
      const source = clean(block.source, 120);
      if (text) blocks.push(source ? { kind: "quote", text, source } : { kind: "quote", text });
    }
    if (blocks.length >= MAX_STAGE_BLOCKS) break;
  }
  return { title: clean(input.title, 120), blocks };
}
