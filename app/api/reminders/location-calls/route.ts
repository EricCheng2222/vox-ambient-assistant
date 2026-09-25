import { requireUser } from "@/lib/auth";
import { callForLocationReminder, locationCallToken } from "@/lib/reminder-location-calls";
import { listLocationCallReminders } from "@/lib/reminder-store";

// GET: the signed-in web app fetches a call token for each pending place
// reminder set to call, and hands them to the iPhone app when arming.
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    const tokens: Record<string, string> = {};
    for (const { id } of await listLocationCallReminders(auth.user.id)) {
      tokens[id] = await locationCallToken(id);
    }
    return Response.json({ tokens }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Place reminder tokens failed", error);
    return Response.json({ error: "Place reminder calls are unavailable." }, { status: 503 });
  }
}

// POST: the iPhone reports that the user arrived at or left a reminder's place,
// often from the background with no web session. The token authorizes exactly
// one reminder's call; the call itself only ever goes to the owner's number.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; token?: unknown };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || !token || token.length > 128) {
    return Response.json({ error: "A valid reminder is required." }, { status: 400 });
  }
  try {
    const result = await callForLocationReminder(id, token);
    if (result === "forbidden") return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ result }, { status: result === "failed" ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Place reminder call failed", error);
    return Response.json({ error: "The call couldn’t be placed." }, { status: 503 });
  }
}
