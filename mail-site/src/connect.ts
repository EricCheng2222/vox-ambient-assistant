import { type MailAccount, markDisconnected, openSecret, saveAccount, storeAccess } from "./accounts.ts";
import { type Env, MailError, base64UrlToBytes, now, randomSecret, readCookie, safeReturnTo, sha256 } from "./util.ts";

// Connecting Google and Microsoft accounts with OAuth 2.0 (authorization
// code + PKCE, offline access), and keeping their access tokens fresh.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const GRAPH_API = "https://graph.microsoft.com/v1.0";
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CONNECT_TTL_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 2 * 60_000;
const CONNECT_COOKIE = "vm_connect";

export type OAuthKind = "gmail" | "microsoft";

const OAUTH = {
  gmail: {
    name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: GOOGLE_TOKEN_URL,
    scope: `openid email ${GMAIL_SCOPE}`,
    required: [GMAIL_SCOPE],
    // A refresh token on every consent, so reconnecting always works.
    params: { access_type: "offline", prompt: "consent" },
    callback: "/google/callback",
  },
  microsoft: {
    name: "Microsoft",
    // "common": personal Outlook.com accounts and work or school accounts.
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: MICROSOFT_TOKEN_URL,
    scope: "offline_access Mail.ReadWrite Mail.Send User.Read",
    required: ["Mail.ReadWrite", "Mail.Send"],
    params: { prompt: "select_account", response_mode: "query" },
    callback: "/microsoft/callback",
  },
} as const;

function credentials(env: Env, kind: OAuthKind) {
  const id = (kind === "gmail" ? env.GOOGLE_CLIENT_ID : env.MS_CLIENT_ID)?.trim();
  const secret = (kind === "gmail" ? env.GOOGLE_CLIENT_SECRET : env.MS_CLIENT_SECRET)?.trim();
  return id && secret ? { id, secret } : null;
}

export function oauthConfigured(env: Env, kind: OAuthKind) {
  return Boolean(credentials(env, kind) && env.MAIL_TOKEN_SECRET?.trim());
}

/** Starts connecting; returns the provider's consent URL and a browser-binding cookie. */
export async function beginOAuthConnect(env: Env, kind: OAuthKind, origin: string, userId: string, returnTo: string) {
  const client = credentials(env, kind);
  if (!client || !oauthConfigured(env, kind)) throw new MailError(`${OAUTH[kind].name} accounts can't be connected on this site yet.`);
  const provider = OAUTH[kind];
  const state = randomSecret();
  const verifier = randomSecret();
  const browser = randomSecret();
  const stamp = new Date();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM connect_states WHERE expires_at <= ?1").bind(stamp.toISOString()),
    env.DB.prepare(
      "INSERT INTO connect_states (state_hash, provider, user_id, browser_hash, code_verifier, return_to, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    ).bind(await sha256(state), kind, userId, await sha256(browser), verifier, safeReturnTo(returnTo), new Date(stamp.getTime() + CONNECT_TTL_MS).toISOString()),
  ]);
  const url = new URL(provider.authUrl);
  url.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: `${origin}${provider.callback}`,
    response_type: "code",
    scope: provider.scope,
    ...provider.params,
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
  }).toString();
  return {
    location: url.toString(),
    cookie: `${CONNECT_COOKIE}=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${CONNECT_TTL_MS / 1000}`,
  };
}

export const clearConnectCookie = `${CONNECT_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
};

/**
 * The address from Google's ID token. It came straight from Google's token
 * endpoint over TLS, so its signature needn't be checked (OIDC Core 3.1.3.7).
 */
function emailFromIdToken(idToken: string | undefined) {
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(idToken?.split(".")[1] ?? ""))) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

async function revokeGoogleToken(token: string) {
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Best effort: the account is forgotten either way, and the user can
    // remove access at myaccount.google.com/permissions.
  }
}

/** The granted scopes include each required one (Microsoft may prefix them with the Graph URL). */
function hasScopes(granted: string, required: readonly string[]) {
  const scopes = granted.toLowerCase().split(/\s+/u);
  return required.every((scope) => scopes.some((item) => item === scope.toLowerCase() || item.endsWith(`/${scope.toLowerCase()}`)));
}

async function accountEmail(kind: OAuthKind, tokens: TokenResponse) {
  if (kind === "gmail") {
    const fromToken = emailFromIdToken(tokens.id_token);
    if (fromToken) return fromToken;
    const profile = await fetch(`${GMAIL_API}/profile`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    return ((await profile.json().catch(() => ({}))) as { emailAddress?: string }).emailAddress ?? "";
  }
  const me = await fetch(`${GRAPH_API}/me?$select=mail,userPrincipalName`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const profile = (await me.json().catch(() => ({}))) as { mail?: string | null; userPrincipalName?: string };
  return profile.mail || profile.userPrincipalName || "";
}

/** Completes connecting for the signed-in user who started it. */
export async function finishOAuthConnect(env: Env, kind: OAuthKind, request: Request, origin: string, userId: string, code: string, state: string) {
  const browser = readCookie(request, CONNECT_COOKIE);
  const pending = browser
    ? await env.DB
        .prepare(
          `DELETE FROM connect_states WHERE state_hash = ?1 AND provider = ?2 AND user_id = ?3 AND browser_hash = ?4 AND expires_at > ?5
           RETURNING code_verifier AS verifier, return_to AS returnTo`,
        )
        .bind(await sha256(state), kind, userId, await sha256(browser), now())
        .first<{ verifier: string; returnTo: string }>()
    : null;
  if (!pending) throw new MailError("This connection link expired. Please try again.");
  const client = credentials(env, kind);
  if (!client) throw new MailError(`${OAUTH[kind].name} accounts can't be connected on this site yet.`);
  const provider = OAUTH[kind];
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: `${origin}${provider.callback}`,
      code_verifier: pending.verifier,
      ...(kind === "microsoft" ? { scope: provider.scope } : {}),
    }),
  });
  const tokens = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !tokens.access_token) {
    console.error(`${provider.name} code exchange failed`, response.status, tokens.error);
    throw new MailError(`${provider.name} didn't confirm the connection. Please try again.`);
  }
  if (!hasScopes(tokens.scope ?? "", provider.required)) {
    // Google lets people untick individual permissions on the consent screen.
    if (kind === "gmail") await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
    throw new MailError("Email access wasn't allowed. Connect again and leave the mail permissions ticked.");
  }
  if (!tokens.refresh_token) {
    throw new MailError(`${provider.name} didn't grant lasting access. Remove Vox Mail from your account's app permissions, then connect again.`);
  }
  const email = await accountEmail(kind, tokens);
  if (!email) throw new MailError(`${provider.name} didn't share the account's email address. Please try again.`);
  await saveAccount(env, {
    userId,
    provider: kind,
    email,
    secret: tokens.refresh_token,
    scope: tokens.scope ?? "",
    access: { token: tokens.access_token, expiresIn: tokens.expires_in },
  });
  return { email, returnTo: pending.returnTo };
}

/** Forgets a connection the user cancelled at the provider; returns where they came from. */
export async function cancelOAuthConnect(env: Env, request: Request, userId: string, state: string) {
  const browser = readCookie(request, CONNECT_COOKIE);
  if (!browser || !state) return "/";
  const pending = await env.DB
    .prepare("DELETE FROM connect_states WHERE state_hash = ?1 AND user_id = ?2 AND browser_hash = ?3 RETURNING return_to AS returnTo")
    .bind(await sha256(state), userId, await sha256(browser))
    .first<{ returnTo: string }>();
  return pending?.returnTo ?? "/";
}

/** Revokes Google's grant when a Gmail account is removed (Microsoft has no per-app revoke). */
export async function revokeAccount(env: Env, account: MailAccount) {
  if (account.provider !== "gmail" || account.status !== "connected") return;
  const token = await openSecret(env, account, account.secret, account.iv).catch(() => "");
  if (token) await revokeGoogleToken(token);
}

export function reconnectError(account: { email: string }, siteUrl: string, reason: string) {
  return new MailError(`${reason} Ask the user to reconnect ${account.email} at ${siteUrl}`);
}

/** A current access token for an OAuth account, refreshed when it's about to expire. */
export class OAuthAccess {
  private account: MailAccount;
  private readonly env: Env;
  private readonly siteUrl: string;

  constructor(env: Env, account: MailAccount, siteUrl: string) {
    this.env = env;
    this.account = account;
    this.siteUrl = siteUrl;
  }

  /** True once the provider has said the grant is gone. */
  get disconnected() {
    return this.account.status !== "connected";
  }

  async token(forceRefresh = false) {
    const account = this.account;
    const kind = account.provider as OAuthKind;
    if (account.status !== "connected") throw reconnectError(account, this.siteUrl, "Access to this account expired or was revoked.");
    if (
      !forceRefresh &&
      account.accessToken &&
      account.accessIv &&
      account.accessExpiresAt &&
      Date.parse(account.accessExpiresAt) - Date.now() > REFRESH_MARGIN_MS
    ) {
      return openSecret(this.env, account, account.accessToken, account.accessIv);
    }
    const client = credentials(this.env, kind);
    if (!client) throw new MailError(`${OAUTH[kind].name} accounts aren't set up on this site anymore.`);
    let response: Response;
    try {
      response = await fetch(OAUTH[kind].tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: await openSecret(this.env, account, account.secret, account.iv),
          client_id: client.id,
          client_secret: client.secret,
          ...(kind === "microsoft" ? { scope: OAUTH.microsoft.scope } : {}),
        }),
      });
    } catch {
      throw new MailError(`${account.email} is unreachable right now. Try again in a moment.`);
    }
    const tokens = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !tokens.access_token) {
      if (tokens.error === "invalid_grant") {
        // The user revoked access, changed their password, or the grant expired.
        await markDisconnected(this.env.DB, account);
        this.account = { ...account, status: "disconnected" };
        throw reconnectError(account, this.siteUrl, `Access to ${account.email} expired or was revoked.`);
      }
      console.error(`${OAUTH[kind].name} token refresh failed`, response.status, tokens.error);
      throw new MailError(`${account.email} is unavailable right now. Try again in a moment.`);
    }
    // Microsoft rotates refresh tokens; keep the newest.
    this.account = await storeAccess(this.env, account, tokens.access_token, tokens.expires_in, kind === "microsoft" ? tokens.refresh_token : undefined);
    return tokens.access_token;
  }
}
