import { requireUser } from "@/lib/auth";
import { buildBriefing } from "@/lib/today-briefing";
import { validTimeZone } from "@/lib/today-time";

// GET /api/today: the Today briefing for the signed-in user. The assembly
// lives in lib/today-briefing.ts, shared with the background check.
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  // The user's own zone decides what "today" and "overdue" mean.
  const timeZone = validTimeZone(new URL(request.url).searchParams.get("tz"));
  const briefing = await buildBriefing(auth.user.id, timeZone, new Date());
  return Response.json(briefing, { headers: { "Cache-Control": "no-store" } });
}
