import { getApnsConfig, isDeviceToken } from "@/lib/apns";
import { requireUser } from "@/lib/auth";
import { countPushDevices, forgetPushDevice, registerPushDevice } from "@/lib/push-store";

// The signed-in user's own iPhone or iPad telling Vox it shows notifications
// for this account. The device is known by an id the app made up (or, with
// Apple push, by Apple's token), stored against the account signed in there.

const noStore = { "Cache-Control": "no-store" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  return Response.json({ devices: await countPushDevices(auth.user.id), configured: getApnsConfig() !== null }, { headers: noStore });
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  const body = (await request.json().catch(() => ({}))) as { token?: unknown; environment?: unknown; platform?: unknown };
  if (!isDeviceToken(body.token)) return Response.json({ error: "Not a device token." }, { status: 400, headers: noStore });
  await registerPushDevice(auth.user.id, { token: body.token, environment: String(body.environment ?? ""), platform: String(body.platform ?? "") }, new Date().toISOString());
  return Response.json({ registered: true, configured: getApnsConfig() !== null }, { headers: noStore });
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  const token = new URL(request.url).searchParams.get("token");
  if (!isDeviceToken(token)) return Response.json({ error: "Not a device token." }, { status: 400, headers: noStore });
  await forgetPushDevice(token, auth.user.id);
  return Response.json({ removed: true }, { headers: noStore });
}
