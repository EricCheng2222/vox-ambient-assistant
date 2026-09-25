import { getUserDisplayName } from "@/lib/auth";
import { getClient, pairwiseSubject, resolveIdentityToken } from "@/lib/oauth-provider-store";

// Tells an approved site who the user is: a per-site account id and their
// display name. Nothing else about the Vox account is shared.
const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const token = /^Bearer\s+(\S+)$/iu.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const identity = token ? await resolveIdentityToken(token) : null;
  const client = identity ? await getClient(identity.clientId) : null;
  const name = identity ? await getUserDisplayName(identity.ownerId) : null;
  if (!identity || !client || name === null) {
    return Response.json({ error: "invalid_token" }, { status: 401, headers: { ...cors, "WWW-Authenticate": 'Bearer error="invalid_token"' } });
  }
  return Response.json(
    {
      sub: await pairwiseSubject(identity.ownerId, client.redirectUris),
      name,
    },
    { headers: cors },
  );
}
