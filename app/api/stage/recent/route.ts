import { requireUser } from "@/lib/auth";
import { stageForHistory } from "@/lib/stage-history";
import { forgetStage, recentStages, rememberStage } from "@/lib/stage-history-store";

// What Vox recently put on the stage for the signed-in user, so it can be
// opened again after closing and on their other devices.

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  return Response.json({ stages: await recentStages(auth.user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const text = await request.text();
  if (text.length > 60_000) return Response.json({ error: "Too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Not JSON." }, { status: 400 });
  }
  const stage = stageForHistory((body as { stage?: unknown })?.stage);
  if (!stage) return Response.json({ saved: false });
  await rememberStage(auth.user.id, stage, new Date().toISOString());
  return Response.json({ saved: true });
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const id = (new URL(request.url).searchParams.get("id") ?? "").replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 64);
  if (!id) return Response.json({ error: "Which one?" }, { status: 400 });
  await forgetStage(auth.user.id, id);
  return Response.json({ removed: true });
}
