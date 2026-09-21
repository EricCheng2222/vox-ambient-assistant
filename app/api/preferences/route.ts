import { requireUser } from "@/lib/auth";
import {
  getUserPreferencesState,
  updateUserPreferences,
} from "@/lib/preference-store";
import {
  isInitiative,
  isRealtimeVoice,
  isReplyLength,
  type UserPreferences,
} from "@/lib/preferences";
import { isVisualTheme } from "@/lib/visual-theme";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return Response.json(
      await getUserPreferencesState(auth.user.id),
      { headers: noStore },
    );
  } catch (error) {
    console.error("Preference load failed", error);
    return Response.json(
      { error: "Account preferences are temporarily unavailable." },
      { status: 503, headers: noStore },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return Response.json(
      { error: "A preference update is required." },
      { status: 400, headers: noStore },
    );
  }

  const patch: Partial<UserPreferences> = {};
  if ("replyLength" in body) {
    if (!isReplyLength(body.replyLength)) {
      return Response.json(
        { error: "Reply length is not valid." },
        { status: 400, headers: noStore },
      );
    }
    patch.replyLength = body.replyLength;
  }
  if ("voice" in body) {
    if (!isRealtimeVoice(body.voice)) {
      return Response.json(
        { error: "Voice is not valid." },
        { status: 400, headers: noStore },
      );
    }
    patch.voice = body.voice;
  }
  if ("initiative" in body) {
    if (!isInitiative(body.initiative)) {
      return Response.json(
        { error: "Initiative is not valid." },
        { status: 400, headers: noStore },
      );
    }
    patch.initiative = body.initiative;
  }
  if ("theme" in body) {
    if (!isVisualTheme(body.theme)) {
      return Response.json(
        { error: "Theme is not valid." },
        { status: 400, headers: noStore },
      );
    }
    patch.theme = body.theme;
  }
  if (Object.keys(patch).length === 0) {
    return Response.json(
      { error: "Choose at least one preference to update." },
      { status: 400, headers: noStore },
    );
  }

  try {
    return Response.json(
      { preferences: await updateUserPreferences(auth.user.id, patch) },
      { headers: noStore },
    );
  } catch (error) {
    console.error("Preference update failed", error);
    return Response.json(
      { error: "Vox could not save that account preference." },
      { status: 503, headers: noStore },
    );
  }
}
