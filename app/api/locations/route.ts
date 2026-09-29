import { requireUser } from "@/lib/auth";
import { listLocationDevices } from "@/lib/location-store";

// The signed-in owner's devices, each with its last known position.
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    return Response.json({ devices: await listLocationDevices(auth.user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Listing device locations failed", error);
    return Response.json({ error: "Locations are unavailable right now." }, { status: 503 });
  }
}
