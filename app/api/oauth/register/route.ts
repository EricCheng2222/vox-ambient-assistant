import { registerClient } from "@/lib/oauth-provider-store";
import { isAllowedRedirectUri } from "@/lib/oauth";

// Dynamic client registration (RFC 7591) for sites using "Sign in with Vox".
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
  const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every(isAllowedRedirectUri)) {
    return Response.json(
      { error: "invalid_redirect_uri", error_description: "Provide HTTPS, loopback, or app-scheme redirect URIs." },
      { status: 400, headers: cors },
    );
  }
  const name = typeof body?.client_name === "string" ? body.client_name.trim().slice(0, 80) || "App" : "App";
  const clientId = await registerClient(name, redirectUris as string[]);
  return Response.json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      scope: "identity",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201, headers: cors },
  );
}
