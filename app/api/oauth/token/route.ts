import {
  consumeAuthorizationCode,
  getClient,
  issueIdentityToken,
  sha256Base64Url,
} from "@/lib/oauth-provider-store";

// Token endpoint for "Sign in with Vox": authorization code + PKCE (S256).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function oauthError(error: string, description: string, status = 400) {
  return Response.json({ error, error_description: description }, { status, headers: cors });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  const params = type.includes("application/json")
    ? new URLSearchParams(Object.entries((await request.json().catch(() => ({}))) as Record<string, string>))
    : new URLSearchParams(await request.text());
  const client = await getClient(params.get("client_id") ?? "");
  if (!client) return oauthError("invalid_client", "Unknown client.", 401);
  if (params.get("grant_type") !== "authorization_code") {
    return oauthError("unsupported_grant_type", "Use authorization_code.");
  }
  const verifier = params.get("code_verifier") ?? "";
  const grant = await consumeAuthorizationCode(params.get("code") ?? "");
  if (
    !grant ||
    grant.clientId !== client.id ||
    grant.redirectUri !== params.get("redirect_uri") ||
    !/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier) ||
    (await sha256Base64Url(verifier)) !== grant.codeChallenge
  ) {
    return oauthError("invalid_grant", "The authorization code is invalid or expired.");
  }
  return Response.json(await issueIdentityToken(grant.ownerId, client.id), { headers: cors });
}
