import type { StageBlock } from "@/lib/stage";
import { blocksFromToolArguments, STAGE_TOOL } from "./stage-tool.ts";

// The live voice model's way to make something that stays: a panel on the
// user's dashboard, created in the middle of a conversation.

/** The Realtime function tool definition. */
export const PANEL_TOOL = {
  type: "function",
  name: "create_panel",
  description:
    "Add a panel to the user's dashboard that stays there after the conversation. kind \"web\": something to keep an eye on, looked up on the web and refreshable (an exchange rate, a typhoon, a ticket price); give `question`. kind \"note\": something you wrote for them to keep (a packing list, a study plan, a comparison, the steps you agreed on); give `blocks`. kind \"countdown\": days until a date (an exam, a trip, a deadline); give `date`. kind \"messages\": a live view of new texts to their Vox number and emails that need them, checked every 30 seconds unless they say otherwise; only a title. kind \"calendar\": their coming events from their own calendar; kind \"tasks\": their open to-dos; both live from their Google account, only a title. Never use kind web for the user's own schedule, tasks, email, or messages: the web can't see those.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["web", "note", "countdown", "messages", "calendar", "tasks"] },
      title: { type: "string", description: "A short name for the panel, in the user's language." },
      question: { type: "string", description: "For kind web: what to look up, as a full question." },
      date: { type: "string", description: "For kind countdown: the date, as YYYY-MM-DD." },
      refresh_minutes: {
        type: "number",
        enum: [0, 0.5, 15, 60, 360, 1440],
        description: "For kinds web and messages: how often it refreshes itself, in minutes (0 = only when asked, 0.5 = every 30 seconds). Leave out for the default (hourly for web, 30 seconds for messages). Each web refresh is a paid look-up, so use 0.5 for web only if the user asks for it.",
      },
      blocks: { ...STAGE_TOOL.parameters.properties.blocks, description: "For kind note (optional for countdown): one or two blocks." },
    },
    required: ["kind", "title"],
  },
} as const;

export const REMOVE_PANEL_TOOL = {
  type: "function",
  name: "remove_panel",
  description: "Remove a panel from the user's dashboard by its title, when they ask to take it down.",
  parameters: {
    type: "object",
    properties: { title: { type: "string", description: "The panel's title, or the closest words the user used." } },
    required: ["title"],
  },
} as const;

export const PANEL_VOICE_INSTRUCTIONS =
  "The user has a dashboard of small panels. Use create_panel when they ask to keep, pin, track, watch, or count down to something (\"keep an eye on the yen\", \"show my messages on the dashboard\", \"make me a packing list\", \"how many days until the exam, put it on my dashboard\"), or when you've just worked out something with them that they'll want to see again; in that second case offer first and create it only if they agree. Don't make panels for one-off answers. Use remove_panel when they ask to take one down.";

export type PanelRequest =
  | { kind: "web"; question: string; refreshMinutes?: number }
  | { kind: "messages" | "calendar" | "tasks"; title: string; refreshMinutes?: number }
  | { kind: "note"; title: string; blocks: StageBlock[] }
  | { kind: "countdown"; title: string; date: string; blocks: StageBlock[] };

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A real calendar date in YYYY-MM-DD form, or "". */
export function calendarDate(value: unknown) {
  const raw = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : "";
}

/** Validates the model's create_panel arguments into a POST /api/panels body. */
export function panelRequestFromToolArguments(rawArguments: string | undefined): PanelRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments ?? "");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const args = parsed as Record<string, unknown>;
  const title = text(args.title, 80);
  const refreshMinutes = [0, 0.5, 15, 60, 360, 1440].includes(args.refresh_minutes as number) ? (args.refresh_minutes as number) : undefined;
  const pace = refreshMinutes === undefined ? {} : { refreshMinutes };
  if (args.kind === "messages" || args.kind === "calendar" || args.kind === "tasks") return title ? { kind: args.kind, title, ...pace } : null;
  if (args.kind === "web") {
    const question = text(args.question, 200) || title;
    if (question.length < 3) return null;
    return { kind: "web", question, ...pace };
  }
  const blocks = blocksFromToolArguments(args.blocks, 2);
  if (args.kind === "note") return title && blocks.length ? { kind: "note", title, blocks } : null;
  if (args.kind === "countdown") {
    const date = calendarDate(args.date);
    return title && date ? { kind: "countdown", title, date, blocks } : null;
  }
  return null;
}

/** Whole days from the local day `now` falls on until `date`; negative once past. */
export function daysUntil(date: string, now = new Date()) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const target = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/** The panel whose title best matches what the user called it. */
export function matchPanel<T extends { id: string; title: string }>(panels: T[], wanted: string): T | null {
  const norm = (value: string) => value.toLocaleLowerCase().replace(/[\s\p{P}]+/gu, "");
  const target = norm(wanted);
  if (!target) return null;
  return (
    panels.find((panel) => norm(panel.title) === target) ??
    panels.find((panel) => norm(panel.title).includes(target) || target.includes(norm(panel.title))) ??
    null
  );
}

/**
 * A typed panel request that is really about the user's own data ("my
 * schedule", "to-do list", "new messages") and so must not go to the web.
 * Short, personal phrasings only; anything longer or naming a public
 * calendar stays a web look-up.
 */
export function ownDataKindFor(value: string): "calendar" | "tasks" | "messages" | null {
  const words = value.toLocaleLowerCase().replace(/[\p{P}]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!words || words.split(" ").length > 4) return null;
  const rest = words.replace(/\b(my|the|show|me|today|todays|today s|new|list|panel|upcoming|google)\b|我的|今天的?|顯示/gu, " ").replace(/\s+/g, " ").trim();
  if (/^(calendar|schedule|calendar schedule|agenda|events|行事曆|行程|日程)$/u.test(rest)) return "calendar";
  if (/^(tasks?|to ?dos?|to do|todo|待辦|待辦事項|任務)$/u.test(rest)) return "tasks";
  if (/^(messages?|texts?|inbox|dms?|訊息|簡訊)$/u.test(rest)) return "messages";
  return null;
}
