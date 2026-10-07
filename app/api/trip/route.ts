import { requireUser } from "@/lib/auth";
import { leaveTime } from "@/lib/event-prep";
import { listLocationDevices } from "@/lib/location-store";
import { currentPlace, planTravel } from "@/lib/trip";

// GET /api/trip?to=<place>&arrive=<ISO time>: the drive from where the user's
// phone last was to a named place, and when to leave to arrive by a time.
// An estimate from open map data, without live traffic.
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  const to = (params.get("to") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (to.length < 3) return Response.json({ error: "Say where to." }, { status: 400, headers: noStore });
  const arrive = params.get("arrive");
  const arriveAt = arrive && Number.isFinite(Date.parse(arrive)) ? new Date(Date.parse(arrive)).toISOString() : null;
  try {
    const from = currentPlace(await listLocationDevices(auth.user.id));
    if (!from) return Response.json({ found: false, reason: "no_position" }, { headers: noStore });
    const trip = await planTravel(from, to);
    if (!trip) return Response.json({ found: false, reason: "no_route", from }, { headers: noStore });
    const timing = arriveAt ? leaveTime(arriveAt, trip.minutes) : null;
    return Response.json(
      { found: true, from: trip.from, to: trip.to, driveMinutes: trip.minutes, paddedMinutes: timing?.paddedMinutes ?? null, arriveAt, leaveAt: timing?.leaveAt ?? null },
      { headers: noStore },
    );
  } catch (error) {
    console.error("Trip planning failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Couldn’t work out that trip right now." }, { status: 503, headers: noStore });
  }
}
