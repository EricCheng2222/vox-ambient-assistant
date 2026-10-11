import { isDeviceToken } from "@/lib/apns";
import { requireUser } from "@/lib/auth";
import { pendingNotices, registerPushDevice } from "@/lib/push-store";

// The Vox app on the signed-in user's iPhone or iPad collecting what Vox set
// out to tell them, when iOS wakes it in the background. Read-only apart from
// noting that the device checked in.

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  const device = params.get("device");
  if (!isDeviceToken(device)) return Response.json({ error: "Which device?" }, { status: 400, headers: noStore });
  const platform = params.get("platform") === "ipados" ? "ipados" : "ios";
  const since = params.get("since");
  const now = new Date();
  await registerPushDevice(auth.user.id, { token: device, environment: "pull", platform }, now.toISOString());
  const notices = await pendingNotices(auth.user.id, {
    since: since && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u.test(since) ? since : null,
    // The phone that receives Vox's texts has already been told.
    skipDelivered: platform === "ios",
  });
  return Response.json({ notices, now: now.toISOString() }, { headers: noStore });
}
