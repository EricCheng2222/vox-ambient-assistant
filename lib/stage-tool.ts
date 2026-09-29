import type { StageBlock, StageContent, StageSource } from "@/lib/stage";

// The live voice model's way to put something on screen while it explains:
// a function tool the page carries out by filling the stage.

const MAX_TEXT = 300;
const MAX_ITEMS = 12;

/** The Realtime function tool definition. */
export const STAGE_TOOL = {
  type: "function",
  name: "show_on_stage",
  description:
    "Show details on the user's screen while you explain them: key facts, numbers, dates, a comparison table, steps, or a short list, optionally with the web page they come from. The screen shows it immediately; keep talking about it rather than reading it all out.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "A short heading: the topic or question." },
      url: { type: "string", description: "Optional https address of the web page the details come from." },
      blocks: {
        type: "array",
        description: "One to three blocks of details.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["facts", "table", "steps", "list", "quote"] },
            title: { type: "string" },
            facts: {
              type: "array",
              description: "For kind facts: label and value pairs.",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: "string" } },
                required: ["label", "value"],
              },
            },
            columns: { type: "array", items: { type: "string" }, description: "For kind table." },
            rows: {
              type: "array",
              items: { type: "array", items: { type: "string" } },
              description: "For kind table: one array of cells per row.",
            },
            items: { type: "array", items: { type: "string" }, description: "For kinds steps and list." },
            text: { type: "string", description: "For kind quote." },
          },
          required: ["kind"],
        },
      },
    },
    required: ["title", "blocks"],
  },
} as const;

export const STAGE_VOICE_INSTRUCTIONS =
  "You can put details on the user's screen with show_on_stage. Use it when concrete details are easier to see than to hear: dates, numbers, prices, specs, a comparison, steps to follow, or a web page you're describing. Call it once, early in your answer, with a short title and one to three compact blocks, then explain in speech. Only show facts you are confident of. Don't use it for chit-chat, feelings, or short answers.";

function text(value: unknown, max = MAX_TEXT) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function texts(value: unknown, maxItems = MAX_ITEMS) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean).slice(0, maxItems) : [];
}

function httpsSource(value: unknown): StageSource | null {
  const raw = text(value, 2_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const site = url.hostname.replace(/^www\./, "");
    return { url: url.toString(), title: site, site };
  } catch {
    return null;
  }
}

function block(value: unknown): StageBlock | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = text(raw.title, 80);
  switch (raw.kind) {
    case "facts": {
      const rows = (Array.isArray(raw.facts) ? raw.facts : Array.isArray(raw.rows) ? raw.rows : [])
        .map((row) => (row && typeof row === "object" ? { label: text((row as Record<string, unknown>).label, 80), value: text((row as Record<string, unknown>).value, 160) } : null))
        .filter((row): row is { label: string; value: string } => Boolean(row?.label && row.value))
        .slice(0, MAX_ITEMS);
      return rows.length ? { kind: "facts", title, rows } : null;
    }
    case "table": {
      const columns = texts(raw.columns, 6);
      const rows = (Array.isArray(raw.rows) ? raw.rows : [])
        .map((row) => texts(row, columns.length || 6))
        .filter((row) => row.length > 0)
        .slice(0, MAX_ITEMS);
      return columns.length && rows.length ? { kind: "table", title, columns, rows } : null;
    }
    case "steps":
    case "list": {
      const items = texts(raw.items);
      return items.length ? { kind: raw.kind, title, items } : null;
    }
    case "quote": {
      const quote = text(raw.text, 600);
      return quote ? { kind: "quote", text: quote, source: text(raw.title, 80) || undefined } : null;
    }
    default:
      return null;
  }
}

/** Validates the model's show_on_stage arguments into stage content. */
export function stageFromToolArguments(rawArguments: string | undefined, now = Date.now()): StageContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments ?? "");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const args = parsed as Record<string, unknown>;
  const title = text(args.title, 120);
  const blocks = (Array.isArray(args.blocks) ? args.blocks : []).map(block).filter((item): item is StageBlock => Boolean(item)).slice(0, 3);
  const source = httpsSource(args.url);
  if (!title || (!blocks.length && !source)) return null;
  return {
    id: crypto.randomUUID(),
    title,
    sources: source ? [source] : [],
    blocks,
    createdAt: now,
  };
}
