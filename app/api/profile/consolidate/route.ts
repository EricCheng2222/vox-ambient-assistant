import { requireUser } from "@/lib/auth";
import { MANUAL_RUN_INTERVAL_MS, runProfileUpdate } from "@/lib/profile-consolidate";
import { claimManualRun, getProfileOverview, profileJobStore } from "@/lib/profile-store";
import { profileResponse, profileStorageError } from "@/lib/profile-response";

const noStore = { "Cache-Control": "no-store" };

/** "Update now": folds the conversation so far into the profile. */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Vox can’t update this right now." }, { status: 503, headers: noStore });
  }

  try {
    const now = new Date();
    if (!(await claimManualRun(auth.user.id, now, MANUAL_RUN_INTERVAL_MS))) {
      const overview = await getProfileOverview(auth.user.id, now);
      const waitMs = overview.manualRunAt
        ? Math.max(0, Date.parse(overview.manualRunAt) + MANUAL_RUN_INTERVAL_MS - now.getTime())
        : MANUAL_RUN_INTERVAL_MS;
      const retryAfter = Math.max(1, Math.ceil(waitMs / 1000));
      return Response.json(
        { error: "Vox updated this a moment ago. Try again in a few minutes.", retryAfter },
        { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } },
      );
    }

    const outcome = await runProfileUpdate({
      store: profileJobStore,
      ownerId: auth.user.id,
      trigger: "manual",
      apiKey: process.env.OPENAI_API_KEY,
      now,
    });
    if (!outcome.ran) {
      return Response.json(
        { error: "Vox is already updating this. Check back in a minute." },
        { status: 409, headers: noStore },
      );
    }
    if (outcome.status === "error") {
      console.error("Profile update failed", outcome.error);
      return Response.json({ error: "Vox couldn’t update this. Try again later." }, { status: 502, headers: noStore });
    }
    return Response.json(
      { ...profileResponse(await getProfileOverview(auth.user.id)), messages: outcome.messages },
      { headers: noStore },
    );
  } catch (error) {
    console.error("Profile update failed", error instanceof Error ? error.message : "");
    return Response.json({ error: profileStorageError(error) }, { status: 503, headers: noStore });
  }
}
