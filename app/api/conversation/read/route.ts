import { requireUser } from "@/lib/auth";
import { markConversationRead } from "@/lib/conversation-store";

// Marks incoming texts and answered-call lines as read, for every device.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (!ids.length) return Response.json({ error: "Nothing to mark." }, { status: 400 });
  try {
    const marked = await markConversationRead(auth.user.id, ids);
    return Response.json({ marked }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Marking messages read failed", error);
    return Response.json({ error: "Couldn’t mark that as read right now." }, { status: 503 });
  }
}
