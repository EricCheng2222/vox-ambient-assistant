import { requireUser } from "@/lib/auth";
import { defaultPanelRefresh, isOwnDataPanel, MAX_DASHBOARD_PANELS, panelRefreshChoice } from "@/lib/dashboard";
import { buildPanel, PanelBuildError } from "@/lib/panel-builder";
import { editedPanelContent, isPanelEdit, newPanelContent } from "@/lib/panel-input";
import { countPanels, createPanel, getPanel, listPanels, PanelLimitError, removePanel, updatePanel } from "@/lib/panel-store";
import { ownDataKindFor } from "@/lib/panel-tool";
import { API_BUDGET_MESSAGE } from "@/lib/provider-error";
import type { DashboardPanel, OwnDataPanelKind } from "@/lib/dashboard";

const OWN_DATA_TITLES: Record<OwnDataPanelKind, string> = { messages: "Messages", calendar: "Calendar", tasks: "To do" };

/**
 * A web look-up panel that is really about the user's own data ("Calendar
 * schedule") can never work: the web can't see their calendar. Such panels
 * become the live panel of that kind (or go, if there already is one).
 */
async function repairOwnDataPanels(ownerId: string, panels: DashboardPanel[]): Promise<DashboardPanel[]> {
  const repaired: DashboardPanel[] = [];
  const kinds = new Set(panels.map((panel) => panel.kind));
  for (const panel of panels) {
    const own = panel.kind === "web" ? (ownDataKindFor(panel.question) ?? ownDataKindFor(panel.title)) : null;
    // A web panel with nothing to look up is left over from a kind that no longer exists.
    if (panel.kind === "web" && !panel.question.trim()) {
      await removePanel(ownerId, panel.id);
      continue;
    }
    if (!own) {
      repaired.push(panel);
      continue;
    }
    if (kinds.has(own)) {
      await removePanel(ownerId, panel.id);
      continue;
    }
    kinds.add(own);
    const next = await updatePanel(ownerId, panel.id, {
      kind: own,
      title: OWN_DATA_TITLES[own],
      question: "",
      blocks: [],
      sources: [],
      refreshMinutes: defaultPanelRefresh(own),
    });
    repaired.push(next ?? panel);
  }
  return repaired;
}

// Dashboard panels. A "web" panel is something the user asked Vox to keep an
// eye on: adding or refreshing one looks its question up on the web and stores
// a few key facts. A "note" holds content Vox wrote, and a "countdown" a date;
// those are stored as sent (after cleaning) and edited, never refreshed.
const noStore = { "Cache-Control": "no-store" };
const LIMIT_MESSAGE = "Remove a panel before adding another.";
const LOOKUP_MESSAGE = "Couldn’t look that up right now.";
const SAVE_MESSAGE = "Couldn’t save that panel right now.";
const REFRESH_MESSAGE = "Only panels looked up on the web can be refreshed.";

type PanelBody = { id?: unknown; kind?: unknown; question?: unknown; title?: unknown; blocks?: unknown; date?: unknown; refreshMinutes?: unknown; url?: unknown };
const REFRESH_CHOICE_MESSAGE = "Choose one of the listed refresh times.";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function validId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/u.test(id);
}

/** The response for a failed lookup or save. */
function failure(action: string, error: unknown, message = LOOKUP_MESSAGE) {
  if (error instanceof PanelLimitError) return Response.json({ error: LIMIT_MESSAGE }, { status: 409, headers: noStore });
  if (error instanceof PanelBuildError) {
    console.error(`${action} failed`, error.message);
    return Response.json({ error: error.budget ? API_BUDGET_MESSAGE : LOOKUP_MESSAGE }, { status: 503, headers: noStore });
  }
  console.error(`${action} failed`, error instanceof Error ? error.message : "unknown");
  return Response.json({ error: message }, { status: 503, headers: noStore });
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    const panels = await listPanels(auth.user.id);
    const repaired = await repairOwnDataPanels(auth.user.id, panels).catch(() => panels);
    return Response.json({ panels: repaired }, { headers: noStore });
  } catch (error) {
    console.error("Listing panels failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Couldn’t load your panels right now." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });

  const body = ((await request.json().catch(() => null)) ?? {}) as PanelBody;
  if (body.kind === "note" || body.kind === "countdown" || body.kind === "page" || isOwnDataPanel(body.kind)) {
    const input = newPanelContent(body);
    if (!input.ok) return Response.json({ error: input.error }, { status: 400, headers: noStore });
    try {
      const pace =
        body.kind === "page" || isOwnDataPanel(body.kind)
          ? { refreshMinutes: panelRefreshChoice(body.refreshMinutes) ?? defaultPanelRefresh(body.kind) }
          : {};
      const panel = await createPanel(auth.user.id, { question: "", sources: [], ...input.panel, ...pace });
      return Response.json({ panel }, { status: 201, headers: noStore });
    } catch (error) {
      return failure("Adding a panel", error, SAVE_MESSAGE);
    }
  }
  if (body.kind !== undefined && body.kind !== "web") {
    return Response.json({ error: "Unknown kind of panel." }, { status: 400, headers: noStore });
  }

  const question = typeof body.question === "string" ? body.question.replace(/\s+/gu, " ").trim() : "";
  // "My schedule", "to-do list", "messages": the user's own data, never a web look-up.
  const own = ownDataKindFor(question);
  if (own) {
    try {
      const existing = (await listPanels(auth.user.id)).find((panel) => panel.kind === own);
      if (existing) return Response.json({ panel: existing }, { status: 200, headers: noStore });
      const panel = await createPanel(auth.user.id, {
        kind: own,
        title: OWN_DATA_TITLES[own],
        question: "",
        blocks: [],
        sources: [],
        refreshMinutes: defaultPanelRefresh(own),
      });
      return Response.json({ panel }, { status: 201, headers: noStore });
    } catch (error) {
      return failure("Adding a panel", error, SAVE_MESSAGE);
    }
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Not configured." }, { status: 503, headers: noStore });
  if (question.length < 3 || question.length > 200) {
    return Response.json({ error: "Say what to keep an eye on, in 3 to 200 characters." }, { status: 400, headers: noStore });
  }
  try {
    // Checked before the lookup so a full dashboard doesn't cost a web search.
    if ((await countPanels(auth.user.id)) >= MAX_DASHBOARD_PANELS) throw new PanelLimitError(LIMIT_MESSAGE);
    const built = await buildPanel(question, apiKey);
    const refreshMinutes = panelRefreshChoice(body.refreshMinutes) ?? defaultPanelRefresh("web");
    const panel = await createPanel(auth.user.id, { kind: "web", question, ...built, refreshMinutes });
    return Response.json({ panel }, { status: 201, headers: noStore });
  } catch (error) {
    return failure("Adding a panel", error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });

  const body = ((await request.json().catch(() => null)) ?? {}) as PanelBody;
  if (!validId(body.id)) return Response.json({ error: "Unknown panel." }, { status: 400, headers: noStore });
  const editing = isPanelEdit(body);
  try {
    const existing = await getPanel(auth.user.id, body.id);
    if (!existing) return Response.json({ error: "Unknown panel." }, { status: 404, headers: noStore });
    if (!editing && body.refreshMinutes !== undefined) {
      // Only how often it refreshes changes; what it shows and its age stay.
      if (existing.kind !== "web" && existing.kind !== "page" && !isOwnDataPanel(existing.kind)) {
        return Response.json({ error: REFRESH_MESSAGE }, { status: 400, headers: noStore });
      }
      const refreshMinutes = panelRefreshChoice(body.refreshMinutes);
      if (refreshMinutes === null) return Response.json({ error: REFRESH_CHOICE_MESSAGE }, { status: 400, headers: noStore });
      const { id, refreshedAt, ...content } = existing;
      const saved = await updatePanel(auth.user.id, id, { ...content, refreshMinutes }, refreshedAt);
      if (!saved) return Response.json({ error: "Unknown panel." }, { status: 404, headers: noStore });
      return Response.json({ panel: saved }, { headers: noStore });
    }
    if (editing) {
      // Notes, countdowns and messages panels: the title, the blocks, or the date, as sent.
      const input = editedPanelContent(existing, body);
      if (!input.ok) return Response.json({ error: input.error }, { status: 400, headers: noStore });
      const pace = existing.kind === "page" || isOwnDataPanel(existing.kind) ? { refreshMinutes: existing.refreshMinutes } : {};
      const edited = await updatePanel(auth.user.id, body.id, { question: "", sources: [], ...input.panel, ...pace });
      if (!edited) return Response.json({ error: "Unknown panel." }, { status: 404, headers: noStore });
      return Response.json({ panel: edited }, { headers: noStore });
    }
    if (existing.kind !== "web") return Response.json({ error: REFRESH_MESSAGE }, { status: 400, headers: noStore });
    if (!existing.question) return Response.json({ error: "Unknown panel." }, { status: 404, headers: noStore });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "Not configured." }, { status: 503, headers: noStore });
    const built = await buildPanel(existing.question, apiKey);
    const panel = await updatePanel(auth.user.id, body.id, { kind: "web", question: existing.question, ...built, refreshMinutes: existing.refreshMinutes });
    if (!panel) return Response.json({ error: "Unknown panel." }, { status: 404, headers: noStore });
    return Response.json({ panel }, { headers: noStore });
  } catch (error) {
    return failure(editing ? "Editing a panel" : "Refreshing a panel", error, editing ? SAVE_MESSAGE : LOOKUP_MESSAGE);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!validId(id)) return Response.json({ error: "Unknown panel." }, { status: 400, headers: noStore });
  const removed = await removePanel(auth.user.id, id);
  return Response.json({ removed }, { status: removed ? 200 : 404, headers: noStore });
}
