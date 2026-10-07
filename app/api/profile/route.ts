import { requireUser } from "@/lib/auth";
import { listMemories } from "@/lib/memory-store";
import { editFact, forgetFact } from "@/lib/profile";
import { profileResponse, profileStorageError } from "@/lib/profile-response";
import { localClock, resolveTimeZone } from "@/lib/profile-schedule";
import { changeProfile, eraseProfile, getProfileOverview, noteTimeZone } from "@/lib/profile-store";

const noStore = { "Cache-Control": "no-store" };

async function view(ownerId: string) {
  const [overview, memories] = await Promise.all([
    getProfileOverview(ownerId),
    listMemories(ownerId, 24).catch(() => []),
  ]);
  return profileResponse(overview, { alreadyKnown: memories.map((memory) => memory.content) });
}

/** What Vox knows about the owner, when it was last updated, and how that went. */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    return Response.json(await view(auth.user.id), { headers: noStore });
  } catch (error) {
    console.error("Profile load failed", error instanceof Error ? error.message : "");
    return Response.json({ error: profileStorageError(error) }, { status: 503, headers: noStore });
  }
}

/**
 * One change at a time: `{ remove: factId }` forgets a fact for good,
 * `{ factId, text }` corrects one, and `{ timeZone }` records the device's
 * time zone so the nightly update runs while the owner sleeps.
 */
export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "A change is required." }, { status: 400, headers: noStore });

  try {
    if ("timeZone" in body) {
      if (!(await noteTimeZone(auth.user.id, body.timeZone, "device"))) {
        return Response.json({ error: "That time zone is not valid." }, { status: 400, headers: noStore });
      }
    } else if (typeof body.remove === "string") {
      const removed = await changeProfile(auth.user.id, (profile) =>
        forgetFact(profile, body.remove as string, new Date().toISOString()),
      );
      if (!removed) return Response.json({ error: "That is already gone." }, { status: 404, headers: noStore });
    } else if (typeof body.factId === "string" && typeof body.text === "string") {
      const overview = await getProfileOverview(auth.user.id);
      const today = localClock(new Date(), resolveTimeZone(overview.timeZone)).day;
      const outcome: { refusal: "missing" | "empty" | "secret" | null } = { refusal: null };
      await changeProfile(auth.user.id, (profile) => {
        const result = editFact(profile, body.factId as string, body.text as string, today);
        if ("error" in result) {
          outcome.refusal = result.error;
          return null;
        }
        return result.profile;
      });
      const { refusal } = outcome;
      if (refusal === "missing") {
        return Response.json({ error: "That is already gone." }, { status: 404, headers: noStore });
      }
      if (refusal) {
        return Response.json(
          {
            error: refusal === "secret"
              ? "Vox doesn’t keep passwords, codes, or card and ID numbers here."
              : "Write what Vox should know.",
          },
          { status: 400, headers: noStore },
        );
      }
    } else {
      return Response.json({ error: "That change is not supported." }, { status: 400, headers: noStore });
    }
    return Response.json(await view(auth.user.id), { headers: noStore });
  } catch (error) {
    console.error("Profile change failed", error instanceof Error ? error.message : "");
    return Response.json({ error: profileStorageError(error) }, { status: 503, headers: noStore });
  }
}

/** Erases everything Vox has learned about the owner. */
export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    await eraseProfile(auth.user.id);
    return Response.json(await view(auth.user.id), { headers: noStore });
  } catch (error) {
    console.error("Profile erase failed", error instanceof Error ? error.message : "");
    return Response.json({ error: profileStorageError(error) }, { status: 503, headers: noStore });
  }
}
