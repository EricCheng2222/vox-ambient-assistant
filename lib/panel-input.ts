import type { DashboardPanel } from "@/lib/dashboard";
import { isOwnDataPanel, watchablePageUrl, type OwnDataPanelKind } from "./dashboard.ts";
import type { StageBlock } from "@/lib/stage";

import { PANEL_TITLE_MAX } from "./panel-builder.ts";
import { sanitizeStage } from "./stage-answer.ts";
import { isCalendarDate } from "./today-time.ts";

// Checking what a client sends to /api/panels for panels that are not looked
// up on the web: notes Vox wrote and countdowns. Blocks go through the same
// rules as the stage's (known kinds only, no map, bounded sizes). No I/O.

export type PanelContent = { kind: "note" | "countdown" | "page" | OwnDataPanelKind; title: string; blocks: StageBlock[]; date: string | null; url?: string };
export type PanelInput = { ok: true; panel: PanelContent } | { ok: false; error: string };

const TITLE_MESSAGE = "Give the panel a title.";
const NOTE_MESSAGE = "A note needs something to show.";
const DATE_MESSAGE = "Give the date as YYYY-MM-DD.";

function cleanTitle(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > PANEL_TITLE_MAX ? `${text.slice(0, PANEL_TITLE_MAX - 1).trimEnd()}…` : text;
}

/** Blocks a client sent, cut down to what a panel may show. */
export function panelBlocks(value: unknown): StageBlock[] {
  return sanitizeStage({ title: "", blocks: value }).blocks.filter((block) => block.kind !== "map");
}

/** POST {kind:"note"|"countdown", title, blocks?, date?} as a panel to store. */
export function newPanelContent(body: { kind?: unknown; title?: unknown; blocks?: unknown; date?: unknown; url?: unknown }): PanelInput {
  const title = cleanTitle(body.title);
  if (!title) return { ok: false, error: TITLE_MESSAGE };
  // A watched page is live too; only its title and address are kept.
  if (body.kind === "page") {
    const url = watchablePageUrl(body.url);
    if (!url) return { ok: false, error: "Give the page’s https address." };
    return { ok: true, panel: { kind: "page", title, blocks: [], date: null, url } };
  }
  // Messages, calendar and to-do panels are live; only the title is kept.
  if (isOwnDataPanel(body.kind)) return { ok: true, panel: { kind: body.kind, title, blocks: [], date: null } };
  const blocks = panelBlocks(body.blocks);
  if (body.kind === "note") {
    if (!blocks.length) return { ok: false, error: NOTE_MESSAGE };
    return { ok: true, panel: { kind: "note", title, blocks, date: null } };
  }
  if (body.kind === "countdown") {
    if (!isCalendarDate(body.date)) return { ok: false, error: DATE_MESSAGE };
    return { ok: true, panel: { kind: "countdown", title, blocks, date: body.date } };
  }
  return { ok: false, error: "Unknown kind of panel." };
}

/** True when a PATCH body asks for an edit rather than a refresh. */
export function isPanelEdit(body: { title?: unknown; blocks?: unknown; date?: unknown }) {
  return body.title !== undefined || body.blocks !== undefined || body.date !== undefined;
}

/** PATCH {id, title?, blocks?, date?} applied to a note or countdown. */
export function editedPanelContent(
  existing: Pick<DashboardPanel, "kind" | "title" | "blocks" | "date" | "url">,
  body: { title?: unknown; blocks?: unknown; date?: unknown },
): PanelInput {
  if (existing.kind === "web") return { ok: false, error: "A panel looked up on the web can only be refreshed." };
  const title = body.title === undefined ? existing.title : cleanTitle(body.title);
  if (!title) return { ok: false, error: TITLE_MESSAGE };
  if (isOwnDataPanel(existing.kind) || existing.kind === "page") {
    if (body.blocks !== undefined || body.date !== undefined) return { ok: false, error: "This panel only has a title." };
    return existing.kind === "page"
      ? { ok: true, panel: { kind: "page", title, blocks: [], date: null, url: existing.url ?? "" } }
      : { ok: true, panel: { kind: existing.kind as OwnDataPanelKind, title, blocks: [], date: null } };
  }
  const blocks = body.blocks === undefined ? existing.blocks : panelBlocks(body.blocks);
  if (existing.kind === "note") {
    if (body.date !== undefined) return { ok: false, error: "Only a countdown has a date." };
    if (!blocks.length) return { ok: false, error: NOTE_MESSAGE };
    return { ok: true, panel: { kind: "note", title, blocks, date: null } };
  }
  const date = body.date === undefined ? existing.date : body.date;
  if (!isCalendarDate(date)) return { ok: false, error: DATE_MESSAGE };
  return { ok: true, panel: { kind: "countdown", title, blocks, date } };
}
