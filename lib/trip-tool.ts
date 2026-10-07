import type { StageContent } from "@/lib/stage";

// The live voice model's way to plan a drive: how long it takes from where
// the user is, when to leave to arrive by a time, and the two ends on a map.

export const PLAN_TRIP_TOOL = {
  type: "function",
  name: "plan_trip",
  description:
    "Work out the drive from where the user is now (their phone's last position) to a place: how long it takes and, with an arrival time, when to leave. Shows both ends on a map on the user's screen. Use for 'how long to get to…', 'when should I leave for…', or to show the route to a calendar event. An estimate from open map data without live traffic; driving only.",
  parameters: {
    type: "object",
    properties: {
      destination: { type: "string", description: "The place: a name or address, as specific as you have it (include the city when you know it)." },
      arrive_by: { type: "string", description: "Optional: when they need to be there, as an ISO 8601 date-time with offset." },
    },
    required: ["destination"],
  },
} as const;

export const TRIP_VOICE_INSTRUCTIONS =
  "You can plan a drive with plan_trip: the travel time from where the user is and, given an arrival time, when to leave; it puts a map on the screen. For a calendar event that is somewhere, Vox already sets a 'time to leave' reminder; when the user asks you to remind them when to go somewhere else, use plan_trip and then create the reminder for the leave time. Say that times are estimates without live traffic. If the user is going another way (MRT, scooter, walking), say the estimate is for a car and adjust by judgment only if they ask.";

export type TripPlan = {
  found: boolean;
  reason?: "no_position" | "no_route";
  from?: { label: string; lat: number; lon: number };
  to?: { label: string; lat: number; lon: number };
  driveMinutes?: number;
  paddedMinutes?: number | null;
  arriveAt?: string | null;
  leaveAt?: string | null;
};

export function tripArguments(rawArguments: string | undefined): { destination: string; arriveBy: string | null } | null {
  try {
    const args = JSON.parse(rawArguments ?? "") as { destination?: unknown; arrive_by?: unknown };
    const destination = typeof args.destination === "string" ? args.destination.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    if (destination.length < 3) return null;
    const arrive = typeof args.arrive_by === "string" && Number.isFinite(Date.parse(args.arrive_by)) ? new Date(Date.parse(args.arrive_by)).toISOString() : null;
    return { destination, arriveBy: arrive };
  } catch {
    return null;
  }
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** What the model is told about the trip. */
export function tripToolOutput(plan: TripPlan | null, destination: string) {
  if (!plan) return "The trip couldn't be worked out right now.";
  if (!plan.found) {
    return plan.reason === "no_position"
      ? "Vox doesn't know where the user is: no device has shared its location recently. Ask where they're starting from, or tell them to turn on location sharing in the Vox iPhone app (Settings, Location sharing)."
      : `No drivable route to ${JSON.stringify(destination)} was found from ${plan.from?.label ?? "where the user is"}. The place may be too far to drive, or its name wasn't recognized; ask for a more exact address.`;
  }
  return [
    `Drive from ${plan.from?.label ?? "the user's position"} to ${plan.to?.label ?? destination}: about ${plan.driveMinutes} minutes on clear roads.`,
    plan.leaveAt && plan.arriveAt
      ? `To arrive by ${clock(plan.arriveAt)}, leave by ${clock(plan.leaveAt)} (that allows about ${plan.paddedMinutes} minutes for the drive with traffic, plus 10 to park and walk in).`
      : "",
    "This is an estimate without live traffic. The map is on the user's screen.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The trip on the stage: the times, and both ends on a map. */
export function tripStage(plan: TripPlan, destination: string, now = Date.now()): StageContent | null {
  if (!plan.found || !plan.from || !plan.to) return null;
  const rows = [
    { label: "From", value: plan.from.label },
    { label: "To", value: plan.to.label || destination },
    { label: "Drive", value: `About ${plan.driveMinutes} min on clear roads` },
    ...(plan.leaveAt && plan.arriveAt ? [{ label: "Leave by", value: `${clock(plan.leaveAt)} to arrive by ${clock(plan.arriveAt)}` }] : []),
  ];
  return {
    id: crypto.randomUUID(),
    title: `Getting to ${plan.to.label || destination}`,
    sources: [],
    blocks: [
      { kind: "facts", title: "Estimate without live traffic", rows },
      {
        kind: "map",
        title: "Route ends",
        points: [
          { id: "from", label: "You", detail: plan.from.label, lat: plan.from.lat, lon: plan.from.lon },
          { id: "to", label: plan.to.label || destination, lat: plan.to.lat, lon: plan.to.lon },
        ],
      },
    ],
    createdAt: now,
  };
}
