import { requireUser } from "@/lib/auth";

// A signed-in app reporting that something in its live session went wrong
// (a tool server that wouldn't list its tools, a refused tool call). Written
// to the Worker's log so the cause can be read; nothing is stored.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown; detail?: unknown };
  const kind = typeof body.kind === "string" ? body.kind.slice(0, 60) : "unknown";
  const detail = typeof body.detail === "string" ? body.detail.replace(/vv_[a-z]+_[A-Za-z0-9_-]+|Bearer\s+\S+/gu, "[token]").slice(0, 900) : "";
  console.warn("Vox client report", kind, detail);
  return new Response(null, { status: 204 });
}
