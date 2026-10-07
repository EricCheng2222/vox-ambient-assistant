import { runNightlyProfileUpdates } from "@/lib/profile-consolidate";
import { listProfileOwnerIds, profileJobStore } from "@/lib/profile-store";
import { schedulerAuthorized } from "@/lib/scheduler-auth";

// The hourly check behind the overnight profile update. Reached only
// in-process from the Worker's cron handler; to anyone else it does not exist.
export async function POST(request: Request) {
  if (!schedulerAuthorized(request)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const summary = await runNightlyProfileUpdates({
      store: profileJobStore,
      ownerIds: await listProfileOwnerIds(),
      apiKey: process.env.OPENAI_API_KEY,
    });
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Nightly profile update failed", error instanceof Error ? error.message : "");
    return Response.json({ error: "Profile updates are unavailable." }, { status: 503 });
  }
}
