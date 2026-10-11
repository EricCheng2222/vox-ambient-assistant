import { sanitizeStage } from "./stage-answer.ts";
import type { StageContent, StageSource } from "@/lib/stage";

// Recently shown stages: kept so one can be opened again after closing, and
// on the user's other devices. See db/schema.ts (stage_history).

export const MAX_STAGE_HISTORY = 12;
const MAX_STAGE_BYTES = 40_000;

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max) : "");

function cleanSource(value: unknown): StageSource | null {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  let url: URL;
  try {
    url = new URL(clean(item.url, 2_000));
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
  return {
    url: url.toString(),
    title: clean(item.title, 200) || url.hostname,
    site: url.hostname.replace(/^www\./u, ""),
    excerpt: clean(item.excerpt, 400) || null,
  };
}

/**
 * A stage as it is stored: checked against the stage's own shapes, trimmed,
 * and bounded. Null when there is nothing worth keeping (for example a map of
 * the user's devices, which is never stored).
 */
export function stageForHistory(value: unknown): StageContent | null {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const { title, blocks } = sanitizeStage(input);
  const sources = (Array.isArray(input.sources) ? input.sources : []).map(cleanSource).filter((source): source is StageSource => source !== null).slice(0, 6);
  const id = clean(input.id, 64).replace(/[^A-Za-z0-9_-]/gu, "");
  if (!id || !title || (!blocks.length && !sources.length)) return null;
  const createdAt = typeof input.createdAt === "number" && Number.isFinite(input.createdAt) ? input.createdAt : Date.now();
  const stage: StageContent = { id, title, sources, blocks, createdAt };
  return JSON.stringify(stage).length <= MAX_STAGE_BYTES ? stage : null;
}

/** Newest first, one per title (showing the same thing again replaces the older one). */
export function mergeStageHistory(current: StageContent[], next: StageContent): StageContent[] {
  return [next, ...current.filter((item) => item.id !== next.id && item.title !== next.title)].slice(0, MAX_STAGE_HISTORY);
}

const BLOCK_NAMES: Record<string, string> = { table: "table", steps: "steps", list: "list", facts: "facts", quote: "quote" };

/** One line about a kept stage: what it holds and when it was shown. */
export function stageHistoryDetail(stage: StageContent, now = Date.now()) {
  const parts: string[] = [];
  const kinds = [...new Set(stage.blocks.map((block) => BLOCK_NAMES[block.kind]).filter(Boolean))];
  if (kinds.length) parts.push(kinds.slice(0, 3).join(", "));
  if (stage.sources.length) parts.push(stage.sources.length === 1 ? stage.sources[0].site : `${stage.sources.length} pages`);
  const days = Math.floor((now - stage.createdAt) / 86_400_000);
  parts.push(days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);
  return parts.join(", ");
}
