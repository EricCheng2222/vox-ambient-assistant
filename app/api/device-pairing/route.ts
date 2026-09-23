import { requireUser } from "@/lib/auth";
import {
  activateRemoteDevice,
  claimRemoteDevice,
  createRemoteDevice,
  getRemoteDevice,
  revokeRemoteDevice,
  touchRemoteDevice,
} from "@/lib/remote-device-store";

const noStore = { "Cache-Control": "no-store" };
const idPattern = /^[a-f0-9-]{36}$/u;
const tokenPattern = /^[A-Za-z0-9_-]{20,512}$/u;

function publicDevice(device: Awaited<ReturnType<typeof getRemoteDevice>>) {
  if (!device) return null;
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    claimId: device.claimId,
    claimLabel: device.claimLabel,
    claimProof: device.claimProof,
    expiresAt: device.expiresAt,
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
  };
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("deviceId") ?? "";
  if (!idPattern.test(id)) return Response.json({ error: "Invalid device." }, { status: 400, headers: noStore });
  const device = await getRemoteDevice(auth.user.id, id);
  if (!device) return Response.json({ error: "Device not found." }, { status: 404, headers: noStore });
  return Response.json({ device: publicDevice(device) }, { headers: noStore });
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const id = typeof body?.deviceId === "string" ? body.deviceId : "";
  if (!idPattern.test(id)) return Response.json({ error: "Invalid device." }, { status: 400, headers: noStore });

  if (action === "create") {
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "Mac";
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    try {
      const device = await createRemoteDevice(auth.user.id, { id, name: name || "Mac", expiresAt });
      return Response.json({ device: publicDevice(device) }, { headers: noStore });
    } catch {
      return Response.json({ error: "Could not create pairing." }, { status: 409, headers: noStore });
    }
  }

  if (action === "claim") {
    const claimId = typeof body?.claimId === "string" ? body.claimId : "";
    const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) : "Phone browser";
    const proof = typeof body?.proof === "string" ? body.proof : "";
    if (!idPattern.test(claimId) || !tokenPattern.test(proof)) {
      return Response.json({ error: "Invalid pairing proof." }, { status: 400, headers: noStore });
    }
    const device = await claimRemoteDevice(auth.user.id, { id, claimId, label: label || "Phone browser", proof });
    if (!device?.claimId) return Response.json({ error: "Pairing expired or unavailable." }, { status: 409, headers: noStore });
    return Response.json({ device: publicDevice(device) }, { headers: noStore });
  }

  if (action === "activate") {
    const device = await activateRemoteDevice(auth.user.id, id);
    if (!device || device.status !== "active") return Response.json({ error: "Pairing could not be activated." }, { status: 409, headers: noStore });
    return Response.json({ device: publicDevice(device) }, { headers: noStore });
  }

  if (action === "heartbeat") {
    const device = await getRemoteDevice(auth.user.id, id);
    if (!device || device.status !== "active") {
      return Response.json({ error: "Device is not active." }, { status: 409, headers: noStore });
    }
    await touchRemoteDevice(auth.user.id, id);
    return Response.json({ alive: true }, { headers: noStore });
  }

  return Response.json({ error: "Unsupported pairing action." }, { status: 400, headers: noStore });
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("deviceId") ?? "";
  if (!idPattern.test(id)) return Response.json({ error: "Invalid device." }, { status: 400, headers: noStore });
  await revokeRemoteDevice(auth.user.id, id);
  return Response.json({ revoked: true }, { headers: noStore });
}
