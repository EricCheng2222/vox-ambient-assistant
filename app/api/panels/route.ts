import { requireUser } from "@/lib/auth";
import { MAX_DASHBOARD_PANELS } from "@/lib/dashboard";
import { buildPanel, PanelBuildError } from "@/lib/panel-builder";
import { countPanels, createPanel, getPanel, listPanels, PanelLimitError, removePanel, updatePanel } from "@/lib/panel-store";
import { API_BUDGET_MESSAGE } from "@/lib/provider-error";

// Dashboard panels: things the user asked Vox to keep an eye on. Adding or
// refreshing one looks its question up on the web and stores a few key facts.
const noStore = { "Cache-Control": "no-store" };
const LIMIT_MESSAGE = "Remove a panel before adding another.";
const LOOKUP_MESSAGE = "Couldn’t look that up right now.";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function validId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/u.test(id);
}

/** The response for a failed lookup or save. */
function failure(action: string, error: unknown) {
  if (error instanceof PanelLimitError) return Response.json({ error: LIMIT_MESSAGE }, { status: 409, headers: noStore });
  if (error instanceof PanelBuildError) {
    console.error(`${action} failed`, error.message);
    return Response.json({ error: error.budget ? API_BUDGET_MESSAGE : LOOKUP_MESSAGE }, { status: 503, headers: noStore });
  }
  console.error(`${action} failed`, error instanceof Error ? error.message : "unknown");
  return Response.json({ error: LOOKUP_MESSAGE }, { status: 503, headers: noStore });
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    return Response.json({ panels: await listPanels(auth.user.id) }, { headers: noStore });
  } catch (error) {
    console.error("Listing panels failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Couldn’t load your panels right now." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Not configured." }, { status: 503, headers: noStore });

  const body = (await request.json().catch(() => ({}))) as { question?: unknown };
  const question = typeof body.question === "string" ? body.question.replace(/\s+/gu, " ").trim() : "";
  if (question.length < 3 || question.length > 200) {
    return Response.json({ error: "Say what to keep an eye on, in 3 to 200 characters." }, { status: 400, headers: noStore });
  }
  try {
    // Checked before the lookup so a full dashboard doesn't cost a web search.
    if ((await countPanels(auth.user.id)) >= MAX_DASHBOARD_PANELS) throw new PanelLimitError(LIMIT_MESSAGE);
    const built = await buildPanel(question, apiKey);
    const panel = await createPanel(auth.user.id, { question, ...built });
    return Response.json({ panel }, { status: 201, headers: noStore });
  } catch (error) {
    return failure("Adding a panel", error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Not configured." }, { status: 503, headers: noStore });

  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (!validId(body.id)) return Response.json({ error: "Unknown panel." }, { status: 400, headers: noStore });
  try {
    const existing = await getPanel(auth.user.id, body.id);
    if (!existing?.question) return Response.json({ error: "Unknown panel." }, { status: 404, headers: noStore });
    const built = await buildPanel(existing.question, apiKey);
    const panel = await updatePanel(auth.user.id, body.id, { question: existing.question, ...built });
    if (!panel) return Response.json({ error: "Unknown panel." }, { status: 404, headers: noStore });
    return Response.json({ panel }, { headers: noStore });
  } catch (error) {
    return failure("Refreshing a panel", error);
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
