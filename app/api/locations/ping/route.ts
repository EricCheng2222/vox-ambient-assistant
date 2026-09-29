import { parsePing } from "@/lib/location";
import { recordLocationPing } from "@/lib/location-store";

// A device reports where it is. It proves which device it is with its own
// ping token (from when location sharing was turned on), not a Vox session,
// so it works from the background.
export async function POST(request: Request) {
  const token = /^Bearer\s+(\S+)$/iu.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!token) return new Response(null, { status: 401 });
  const raw = await request.text();
  if (raw.length > 4_000) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const position = parsePing(body);
  if (!position) return new Response(null, { status: 400 });
  try {
    return new Response(null, { status: (await recordLocationPing(token, position)) ? 204 : 401 });
  } catch (error) {
    console.error("Recording a location failed", error);
    return new Response(null, { status: 503 });
  }
}
