import { requireUser } from "@/lib/auth";
import { cleanDeviceName, parseDeviceKind } from "@/lib/location";
import { LocationLimitError, registerLocationDevice, removeLocationDevice } from "@/lib/location-store";

// Adding a device that will share its location (it gets its own ping token,
// returned once), and removing one (its token stops working, its positions
// are deleted).
const noStore = { "Cache-Control": "no-store" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; kind?: unknown };
  try {
    const device = await registerLocationDevice(auth.user.id, cleanDeviceName(body.name), parseDeviceKind(body.kind));
    return Response.json(device, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof LocationLimitError) return Response.json({ error: error.message }, { status: 409, headers: noStore });
    console.error("Adding a location device failed", error);
    return Response.json({ error: "Couldn’t add this device right now." }, { status: 503, headers: noStore });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(id)) return Response.json({ error: "Unknown device." }, { status: 400, headers: noStore });
  const removed = await removeLocationDevice(auth.user.id, id);
  return Response.json({ removed }, { status: removed ? 200 : 404, headers: noStore });
}
