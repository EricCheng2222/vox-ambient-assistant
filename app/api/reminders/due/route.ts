import { requireAuthorized } from "@/lib/auth";
import { claimDueReminders } from "@/lib/reminder-store";

export async function POST(request: Request) {
  const unauthorized = await requireAuthorized(request);
  if (unauthorized) return unauthorized;

  try {
    return Response.json(
      { reminders: await claimDueReminders() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Due reminder check failed", error);
    return Response.json({ error: "Reminders are temporarily unavailable." }, { status: 503 });
  }
}
