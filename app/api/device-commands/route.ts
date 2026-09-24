import { requireUser } from "@/lib/auth";
import {
  completeRemoteCommand,
  enqueueRemoteCommand,
  getRemoteCommand,
  listPendingRemoteCommands,
  startRemoteCommand,
} from "@/lib/remote-device-store";

const noStore = { "Cache-Control": "no-store" };
const idPattern = /^[a-f0-9-]{36}$/u;
const encodedPattern = /^[A-Za-z0-9_-]+$/u;

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  const deviceId = params.get("deviceId") ?? "";
  const commandId = params.get("commandId") ?? "";
  if (!idPattern.test(deviceId)) return Response.json({ error: "Invalid device." }, { status: 400, headers: noStore });
  if (commandId) {
    if (!idPattern.test(commandId)) return Response.json({ error: "Invalid command." }, { status: 400, headers: noStore });
    const command = await getRemoteCommand(auth.user.id, commandId);
    if (!command || command.deviceId !== deviceId) return Response.json({ error: "Command not found." }, { status: 404, headers: noStore });
    return Response.json({ command }, { headers: noStore });
  }
  return Response.json({ commands: await listPendingRemoteCommands(auth.user.id, deviceId) }, { headers: noStore });
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "";
  const ciphertext = typeof body?.ciphertext === "string" ? body.ciphertext : "";
  const iv = typeof body?.iv === "string" ? body.iv : "";
  if (!idPattern.test(id) || !idPattern.test(deviceId) || !encodedPattern.test(ciphertext) || !encodedPattern.test(iv) || ciphertext.length > 32_000 || iv.length > 128) {
    return Response.json({ error: "Invalid encrypted command." }, { status: 400, headers: noStore });
  }
  const queued = await enqueueRemoteCommand(auth.user.id, {
    id,
    deviceId,
    ciphertext,
    iv,
    expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
  });
  if (!queued) return Response.json({ error: "The Mac is unavailable or its queue is full." }, { status: 409, headers: noStore });
  return Response.json({ queued: true, id }, { status: 202, headers: noStore });
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "";
  if (body?.action === "start") {
    // The Mac acknowledges pickup before running; only a command still inside
    // its pickup window may start, and starting extends it for a long task.
    if (!idPattern.test(id) || !idPattern.test(deviceId)) {
      return Response.json({ error: "Invalid command." }, { status: 400, headers: noStore });
    }
    const started = await startRemoteCommand(auth.user.id, { id, deviceId });
    if (!started) return Response.json({ error: "Command is unavailable." }, { status: 409, headers: noStore });
    return Response.json({ started: true }, { headers: noStore });
  }
  const resultCiphertext = typeof body?.resultCiphertext === "string" ? body.resultCiphertext : "";
  const resultIv = typeof body?.resultIv === "string" ? body.resultIv : "";
  if (!idPattern.test(id) || !idPattern.test(deviceId) || !encodedPattern.test(resultCiphertext) || !encodedPattern.test(resultIv) || resultCiphertext.length > 32_000 || resultIv.length > 128) {
    return Response.json({ error: "Invalid encrypted result." }, { status: 400, headers: noStore });
  }
  const completed = await completeRemoteCommand(auth.user.id, { id, deviceId, resultCiphertext, resultIv });
  if (!completed) return Response.json({ error: "Command is unavailable." }, { status: 409, headers: noStore });
  return Response.json({ completed: true }, { headers: noStore });
}
