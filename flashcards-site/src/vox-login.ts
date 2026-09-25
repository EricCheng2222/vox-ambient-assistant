import { type Env, now, randomSecret, sha256 } from "./util.ts";

// "Sign in with Vox": this site is an OAuth client of the user's Vox
// deployment, which confirms who they are. Vox issues a pairwise account id
// for this site and never shares the user's Vox data.
const LOGIN_TTL_MS = 10 * 60_000;

type VoxClient = { clientId: string; redirectUri: string; issuer: string };

async function voxMetadata(env: Env) {
  const issuer = env.VOX_URL.replace(/\/+$/u, "");
  const response = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
  if (!response.ok) throw new Error("Vox sign-in is unavailable.");
  const metadata = (await response.json()) as {
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    userinfo_endpoint: string;
  };
  return { issuer, ...metadata };
}

async function voxClient(env: Env, origin: string, metadata: Awaited<ReturnType<typeof voxMetadata>>): Promise<VoxClient> {
  const redirectUri = `${origin}/auth/callback`;
  const existing = await env.DB
    .prepare("SELECT client_id AS clientId, redirect_uri AS redirectUri, issuer FROM vox_client WHERE issuer = ?1")
    .bind(metadata.issuer)
    .first<VoxClient>();
  if (existing && existing.redirectUri === redirectUri) return existing;
  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Vox Flash Cards", redirect_uris: [redirectUri], scope: "identity" }),
  });
  const registered = (await response.json().catch(() => ({}))) as { client_id?: string };
  if (!response.ok || !registered.client_id) throw new Error("This site could not register with Vox.");
  await env.DB
    .prepare(
      `INSERT INTO vox_client (issuer, client_id, redirect_uri, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (issuer) DO UPDATE SET client_id = excluded.client_id, redirect_uri = excluded.redirect_uri`,
    )
    .bind(metadata.issuer, registered.client_id, redirectUri, now())
    .run();
  return { clientId: registered.client_id, redirectUri, issuer: metadata.issuer };
}

/** Only same-site paths may be returned to after signing in. */
export function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

const LOGIN_COOKIE = "fc_login";

function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

/** Starts a sign-in; returns Vox's authorization URL and a browser-binding cookie. */
export async function beginVoxLogin(env: Env, origin: string, returnTo: string) {
  const metadata = await voxMetadata(env);
  const client = await voxClient(env, origin, metadata);
  const state = randomSecret();
  const verifier = randomSecret();
  // Ties the sign-in to this browser, so a finished sign-in link sent by
  // someone else cannot log this browser into their account.
  const browser = randomSecret();
  const stamp = new Date();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_states WHERE expires_at <= ?1").bind(stamp.toISOString()),
    env.DB.prepare(
      "INSERT INTO login_states (state_hash, browser_hash, code_verifier, return_to, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(await sha256(state), await sha256(browser), verifier, safeReturnTo(returnTo), new Date(stamp.getTime() + LOGIN_TTL_MS).toISOString()),
  ]);
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: "identity",
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
  }).toString();
  return {
    location: url.toString(),
    cookie: `${LOGIN_COOKIE}=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=${LOGIN_TTL_MS / 1000}`,
  };
}

export const clearLoginCookie = `${LOGIN_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0`;

export async function finishVoxLogin(env: Env, request: Request, origin: string, code: string, state: string) {
  const browser = readCookie(request, LOGIN_COOKIE);
  const login = browser
    ? await env.DB
        .prepare(
          `DELETE FROM login_states WHERE state_hash = ?1 AND browser_hash = ?2 AND expires_at > ?3
           RETURNING code_verifier AS verifier, return_to AS returnTo`,
        )
        .bind(await sha256(state), await sha256(browser), now())
        .first<{ verifier: string; returnTo: string }>()
    : null;
  if (!login) throw new Error("This sign-in link expired. Please try again.");
  const metadata = await voxMetadata(env);
  const client = await voxClient(env, origin, metadata);
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: client.redirectUri,
      client_id: client.clientId,
      code_verifier: login.verifier,
    }),
  });
  const tokens = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenResponse.ok || !tokens.access_token) throw new Error("Vox did not confirm the sign-in.");
  const infoResponse = await fetch(metadata.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const info = (await infoResponse.json().catch(() => ({}))) as { sub?: string; name?: string };
  if (!infoResponse.ok || !info.sub) throw new Error("Vox did not share your account.");
  return { user: { id: info.sub, name: (info.name ?? "Vox user").slice(0, 80) }, returnTo: login.returnTo };
}
