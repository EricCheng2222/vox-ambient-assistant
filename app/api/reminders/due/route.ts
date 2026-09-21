import { requireUser } from "@/lib/auth";
import { claimDueReminders } from "@/lib/reminder-store";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return Response.json(
      { reminders: await claimDueReminders(auth.user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Due reminder check failed", error);
    return Response.json({ error: "Reminders are temporarily unavailable." }, { status: 503 });
  }
}
