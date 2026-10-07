import {
  getAccount,
  type ImapConfig,
  listAccounts,
  normalizeEmail,
  recallReturn,
  rememberReturn,
  removeAccount,
  saveAccount,
  setPrimary,
} from "./accounts.ts";
import { beginOAuthConnect, cancelOAuthConnect, clearConnectCookie, finishOAuthConnect, type OAuthKind, oauthConfigured, revokeAccount } from "./connect.ts";
import { AuthError } from "./imap.ts";
import { accountLabel, handleMcpMessage, type JsonRpcMessage, Mailboxes } from "./mcp.ts";
import { requireAddresses } from "./mime.ts";
import {
  authorizationServerMetadata,
  isAllowedRedirectUri,
  isFirstParty,
  isOurResource,
  mcpResourceUrl,
  OAuthServer,
  protectedResourceMetadata,
} from "./oauth.ts";
import { addAccountPage, consentPage, homePage, type ImapFormValues, imapPage, messagePage, signedOutPage } from "./pages.ts";
import { IMAP_PRESETS, isOutlookAddress, presetForEmail, verifyImapAccount } from "./providers/imap.ts";
import { currentUser, endSession, type SiteUser, startSession } from "./session.ts";
import { isPublicHost } from "./socket.ts";
import { html, json, MailError, redirect, safeReturnTo, sha256, type Env } from "./util.ts";
import { beginVoxLogin, clearLoginCookie, finishVoxLogin } from "./vox-login.ts";

// Vox Mail: an independent site. People sign in with their Vox account,
// connect their email accounts (Google, Microsoft, or IMAP), and let MCP
// clients (Vox, Claude, …) use them.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

const MAX_BODY_BYTES = 256 * 1024;

function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status, corsHeaders);
}

function withQuery(uri: string, values: Record<string, string | null>) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(values)) if (value !== null) url.searchParams.set(key, value);
  return url.toString();
}

/** State-changing requests must come from this site's own pages. */
function isSameOrigin(request: Request, origin: string) {
  const sent = request.headers.get("origin");
  if (sent) return sent === origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

async function validateAuthorize(oauth: OAuthServer, params: URLSearchParams, origin: string) {
  const client = await oauth.getClient(params.get("client_id") ?? "");
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return { kind: "fatal", message: "This app’s sign-in request is not valid. Try connecting again from the app." } as const;
  }
  const state = params.get("state");
  const fail = (error: string, description: string) =>
    ({ kind: "redirect", url: withQuery(redirectUri, { error, error_description: description, state, iss: origin }) }) as const;
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Use response_type=code.");
  const codeChallenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/u.test(codeChallenge)) {
    return fail("invalid_request", "PKCE with S256 is required.");
  }
  if (!isOurResource(params.get("resource"), origin)) return fail("invalid_target", "Unknown resource.");
  return { kind: "ok", client, redirectUri, state, codeChallenge } as const;
}

async function handleMcp(request: Request, env: Env, oauth: OAuthServer, origin: string) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...corsHeaders, Allow: "POST, OPTIONS" } });
  const token = /^Bearer\s+(\S+)$/iu.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const ownerId = token ? await oauth.authenticate(token) : null;
  if (!ownerId) {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in with your Vox account to use Vox Mail." } },
      401,
      {
        ...corsHeaders,
        "WWW-Authenticate": `Bearer realm="vox-mail", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      },
    );
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request is too large." } }, 413, corsHeaders);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, 400, corsHeaders);
  }
  const mail = new Mailboxes(env, ownerId, `${origin}/`);
  const messages = Array.isArray(payload) ? payload.slice(0, 20) : [payload];
  const responses = [];
  try {
    for (const message of messages) {
      const response = await handleMcpMessage(mail, (message ?? {}) as JsonRpcMessage);
      if (response) responses.push(response);
    }
  } finally {
    // Sign out of any IMAP servers this request used.
    await mail.close();
  }
  if (!responses.length) return new Response(null, { status: 202, headers: corsHeaders });
  return json(Array.isArray(payload) ? responses : responses[0], 200, corsHeaders);
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname;
  const oauth = new OAuthServer(env.DB);

  if (path === "/mcp") return handleMcp(request, env, oauth, origin);

  // ---- Discovery ----
  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    return json(protectedResourceMetadata(origin), 200, { ...corsHeaders, "Cache-Control": "max-age=300" });
  }
  if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) {
    return json(authorizationServerMetadata(origin), 200, { ...corsHeaders, "Cache-Control": "max-age=300" });
  }

  // ---- OAuth for MCP clients ----
  if (path === "/oauth/register") {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const body = (await request.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
    const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
    if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every(isAllowedRedirectUri)) {
      return oauthError("invalid_redirect_uri", "Provide HTTPS, loopback, or app-scheme redirect URIs.");
    }
    const name = typeof body?.client_name === "string" ? body.client_name.trim().slice(0, 80) || "MCP client" : "MCP client";
    const clientId = await oauth.registerClient(name, redirectUris as string[]);
    return json(
      {
        client_id: clientId,
        client_name: name,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      201,
      corsHeaders,
    );
  }

  if (path === "/oauth/authorize") {
    const result = await validateAuthorize(oauth, url.searchParams, origin);
    if (request.method === "GET") {
      if (result.kind === "fatal") return html(messagePage("Can’t connect", result.message), 400);
      if (result.kind === "redirect") return redirect(result.url);
      const user = await currentUser(env.DB, request);
      if (!user) return redirect(`/auth/login?return_to=${encodeURIComponent(path + url.search)}`);
      const usable = await usableAccounts(env, user, origin);
      // One flow from the app: without a working email account (or when the
      // app asks to add another), connect one first. The pending request
      // waits in D1 and comes back here afterwards.
      if (!usable.length || url.searchParams.get("add") === "1") {
        return connectFirst(env, user, origin, url);
      }
      // Vox itself asking, for the person signed in with Vox: nothing to
      // approve, so the code goes straight back.
      if (isFirstParty(env.VOX_URL, result.redirectUri)) {
        const code = await oauth.createCode({ clientId: result.client.id, ownerId: user.id, redirectUri: result.redirectUri, codeChallenge: result.codeChallenge });
        return redirect(withQuery(result.redirectUri, { code, state: result.state, iss: origin }));
      }
      let returnHost = result.redirectUri;
      try {
        const target = new URL(result.redirectUri);
        // An app's custom scheme has no meaningful host.
        returnHost = target.protocol === "https:" || target.protocol === "http:" ? target.host : "the app";
      } catch {
        // Keep the raw value.
      }
      return html(
        consentPage({
          clientName: result.client.name,
          userName: user.name,
          accounts: usable,
          returnHost,
          query: url.searchParams.toString(),
        }),
      );
    }
    if (request.method === "POST") {
      // Only this site's own approval page may submit a decision.
      if (!isSameOrigin(request, origin)) return json({ error: "Request not allowed." }, 403);
      const user = await currentUser(env.DB, request);
      if (!user) return json({ error: "Sign in first." }, 401);
      if (result.kind === "fatal") return json({ error: result.message }, 400);
      if (result.kind === "redirect") return json({ redirect: result.url });
      const body = (await request.json().catch(() => ({}))) as { approve?: unknown };
      if (body.approve !== true) {
        return json({ redirect: withQuery(result.redirectUri, { error: "access_denied", error_description: "The user declined.", state: result.state, iss: origin }) });
      }
      const code = await oauth.createCode({ clientId: result.client.id, ownerId: user.id, redirectUri: result.redirectUri, codeChallenge: result.codeChallenge });
      return json({ redirect: withQuery(result.redirectUri, { code, state: result.state, iss: origin }) });
    }
    return new Response(null, { status: 405 });
  }

  if (path === "/oauth/token") {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const type = request.headers.get("content-type") ?? "";
    const params = type.includes("application/json")
      ? new URLSearchParams(Object.entries((await request.json().catch(() => ({}))) as Record<string, string>))
      : new URLSearchParams(await request.text());
    const client = await oauth.getClient(params.get("client_id") ?? "");
    if (!client) return oauthError("invalid_client", "Unknown client.", 401);
    if (params.get("grant_type") === "authorization_code") {
      const verifier = params.get("code_verifier") ?? "";
      const grant = await oauth.consumeCode(params.get("code") ?? "");
      if (
        !grant ||
        grant.clientId !== client.id ||
        grant.redirectUri !== params.get("redirect_uri") ||
        !/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier) ||
        (await sha256(verifier)) !== grant.codeChallenge
      ) {
        return oauthError("invalid_grant", "The authorization code is invalid or expired.");
      }
      try {
        return json(await oauth.issueTokens(grant.ownerId, client), 200, corsHeaders);
      } catch (error) {
        return oauthError("access_denied", error instanceof Error ? error.message : "Access denied.");
      }
    }
    if (params.get("grant_type") === "refresh_token") {
      const tokens = await oauth.refresh(params.get("refresh_token") ?? "", client.id);
      return tokens ? json(tokens, 200, corsHeaders) : oauthError("invalid_grant", "The refresh token is invalid, expired, or revoked.");
    }
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }

  // ---- Sign in with Vox ----
  if (path === "/auth/login") {
    try {
      const login = await beginVoxLogin(env, origin, url.searchParams.get("return_to") ?? "/");
      return redirect(login.location, { "Set-Cookie": login.cookie });
    } catch (failure) {
      console.error("Starting Sign in with Vox failed", failure);
      return html(messagePage("Vox sign-in is unavailable", "Please try again in a moment.", { href: "/auth/login", label: "Try again" }), 503);
    }
  }
  if (path === "/auth/callback") {
    const error = url.searchParams.get("error");
    if (error) {
      return html(messagePage("Sign-in cancelled", "You didn’t sign in with Vox.", { href: "/", label: "Back" }), 400);
    }
    try {
      const { user, returnTo } = await finishVoxLogin(env, request, origin, url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "");
      const headers = new Headers({ Location: returnTo, "Cache-Control": "no-store" });
      headers.append("Set-Cookie", await startSession(env.DB, user));
      headers.append("Set-Cookie", clearLoginCookie);
      return new Response(null, { status: 302, headers });
    } catch (failure) {
      return html(messagePage("Couldn’t sign in", failure instanceof Error ? failure.message : "Please try again.", { href: "/auth/login", label: "Try again" }), 400);
    }
  }
  if (path === "/auth/logout" && request.method === "POST") {
    if (!isSameOrigin(request, origin)) return json({ error: "Request not allowed." }, 403);
    return redirect("/", { "Set-Cookie": await endSession(env.DB, request) }, 303);
  }

  // ---- Adding email accounts (session cookie) ----
  const connectKind: OAuthKind | null = path.startsWith("/google/") ? "gmail" : path.startsWith("/microsoft/") ? "microsoft" : null;
  if (connectKind && path.endsWith("/connect") && request.method === "GET") {
    const user = await currentUser(env.DB, request);
    if (!user) return redirect(`/auth/login?return_to=${encodeURIComponent(path + url.search)}`);
    try {
      const returnTo = (await recallReturn(env.DB, user.id, url.searchParams.get("r"))) ?? "/";
      const connect = await beginOAuthConnect(env, connectKind, origin, user.id, returnTo);
      return redirect(connect.location, { "Set-Cookie": connect.cookie });
    } catch (failure) {
      const message = failure instanceof MailError ? failure.message : "Please try again in a moment.";
      if (!(failure instanceof MailError)) console.error("Starting a connection failed", failure);
      return html(messagePage("Can’t connect that account", message, { href: "/", label: "Back" }), 503);
    }
  }
  if (connectKind && path.endsWith("/callback")) {
    const user = await currentUser(env.DB, request);
    if (!user) return html(messagePage("Sign in first", "Your Vox sign-in here ended. Sign in, then connect the account again.", { href: "/auth/login", label: "Sign in with Vox" }), 401);
    const state = url.searchParams.get("state") ?? "";
    if (url.searchParams.get("error")) {
      const returnTo = await cancelOAuthConnect(env, request, user.id, state);
      return html(
        messagePage("The account wasn’t connected", "You didn’t allow access to your email. Vox Mail needs it to work with your email.", { href: returnTo, label: "Try again" }),
        400,
        { "Set-Cookie": clearConnectCookie },
      );
    }
    try {
      const { returnTo } = await finishOAuthConnect(env, connectKind, request, origin, user.id, url.searchParams.get("code") ?? "", state);
      return redirect(returnTo, { "Set-Cookie": clearConnectCookie });
    } catch (failure) {
      const message = failure instanceof MailError ? failure.message : "Please try again.";
      if (!(failure instanceof MailError)) console.error("Connecting an account failed", failure);
      return html(messagePage("Couldn’t connect the account", message, { href: "/accounts/add", label: "Try again" }), 400, { "Set-Cookie": clearConnectCookie });
    }
  }
  if (path === "/accounts/add" && request.method === "GET") {
    const user = await currentUser(env.DB, request);
    if (!user) return redirect(`/auth/login?return_to=${encodeURIComponent(path + url.search)}`);
    const nonce = url.searchParams.get("r");
    return html(
      addAccountPage({
        google: oauthConfigured(env, "gmail"),
        microsoft: oauthConfigured(env, "microsoft"),
        imap: Boolean(env.MAIL_TOKEN_SECRET?.trim()),
        nonce: (await recallReturn(env.DB, user.id, nonce)) ? nonce : null,
      }),
    );
  }
  if (path === "/imap/connect") return handleImapConnect(request, env, url);

  // ---- This site's own forms (session cookie) ----
  if (["/accounts/remove", "/accounts/primary", "/apps/disconnect"].includes(path) && request.method === "POST") {
    if (!isSameOrigin(request, origin)) return json({ error: "Request not allowed." }, 403);
    const user = await currentUser(env.DB, request);
    if (!user) return redirect("/", {}, 303);
    const form = await request.formData().catch(() => null);
    const field = (name: string) => {
      const value = form?.get(name);
      return typeof value === "string" ? value : "";
    };
    if (path === "/apps/disconnect") {
      await oauth.revokeGrant(user.id, field("grant_id"));
    } else {
      const account = await getAccount(env.DB, user.id, field("account_id"));
      if (account && path === "/accounts/remove") {
        await revokeAccount(env, account);
        await removeAccount(env.DB, user.id, account.id);
      }
      if (account && path === "/accounts/primary") await setPrimary(env.DB, user.id, account.id);
    }
    return redirect("/", {}, 303);
  }

  if (path === "/" && request.method === "GET") {
    const user = await currentUser(env.DB, request);
    if (!user) return html(signedOutPage());
    const [accounts, apps] = await Promise.all([listAccounts(env.DB, user.id), oauth.listGrants(user.id)]);
    return html(
      homePage({
        userName: user.name,
        accounts: accounts.map((account) => ({
          id: account.id,
          email: account.email,
          provider: account.provider,
          label: accountLabel(account),
          status: account.status,
          isPrimary: Boolean(account.isPrimary),
          connectedAt: account.connectedAt,
          reconnectHref:
            account.provider === "gmail" ? "/google/connect" : account.provider === "microsoft" ? "/microsoft/connect" : `/imap/connect?email=${encodeURIComponent(account.email)}`,
        })),
        canAdd: Boolean(env.MAIL_TOKEN_SECRET?.trim()),
        apps,
        mcpUrl: mcpResourceUrl(origin),
      }),
    );
  }
  return html(messagePage("Not found", "There’s nothing here.", { href: "/", label: "Go to Vox Mail" }), 404);
}

const PROVIDER_HINTS: Record<string, OAuthKind | "imap"> = { google: "gmail", microsoft: "microsoft", imap: "imap" };
const LOGIN_HINT = /^[^\s@<>"'&]{1,64}@[^\s@<>"'&]{1,189}\.[^\s@<>"'&]{2,63}$/u;

/**
 * Sends the user to connect an account before an app's request continues.
 * `provider` (google, microsoft, imap) skips the chooser; `login_hint`
 * preselects the address; `add=1` is dropped from the parked request so the
 * user comes back to continue rather than to add again.
 */
async function connectFirst(env: Env, user: SiteUser, origin: string, url: URL) {
  const params = new URLSearchParams(url.searchParams);
  params.delete("add");
  const returnTo = `${url.pathname}?${params}`;
  const hint = PROVIDER_HINTS[url.searchParams.get("provider") ?? ""];
  const email = url.searchParams.get("login_hint")?.trim() ?? "";
  const loginHint = LOGIN_HINT.test(email) && email.length <= 254 ? email : "";
  const nonce = await rememberReturn(env.DB, user.id, returnTo);
  const withNonce = (page: string, extra = "") => `${page}?r=${encodeURIComponent(nonce)}${extra}`;
  if (hint === "imap") return redirect(withNonce("/imap/connect", loginHint ? `&email=${encodeURIComponent(loginHint)}` : ""));
  if (hint && oauthConfigured(env, hint)) {
    const connect = await beginOAuthConnect(env, hint, origin, user.id, returnTo, loginHint);
    return redirect(connect.location, { "Set-Cookie": connect.cookie });
  }
  if (hint) {
    // The app asked for a provider this site can't sign in to: say so, with a way forward.
    const name = hint === "gmail" ? "Gmail" : "Outlook";
    return html(
      messagePage(
        `${name} sign-in isn’t set up yet`,
        `This Vox Mail site can’t sign in with ${hint === "gmail" ? "Google" : "Microsoft"} yet. ${
          hint === "gmail" ? "You can still connect Gmail with an app password." : "You can connect another kind of account for now."
        }`,
        hint === "gmail"
          ? { href: withNonce("/imap/connect", `&preset=gmail${loginHint ? `&email=${encodeURIComponent(loginHint)}` : ""}`), label: "Connect with an app password instead" }
          : { href: withNonce("/accounts/add"), label: "Choose another account" },
      ),
      503,
    );
  }
  return redirect(withNonce("/accounts/add"));
}

/**
 * Connected accounts the user can use now. OAuth accounts are checked with
 * one cheap call (which notices a revoked grant); IMAP accounts are trusted
 * until their password fails, to keep this page fast.
 */
async function usableAccounts(env: Env, user: SiteUser, origin: string) {
  const mail = new Mailboxes(env, user.id, `${origin}/`);
  const accounts = (await mail.accounts()).filter((account) => account.status === "connected");
  const checks = await Promise.all(accounts.map(async (account) => ((await mail.provider(account).check?.()) ?? true) && account.email));
  return checks.filter((email): email is string => Boolean(email));
}

const IMAP_PORTS = { imap: { 993: "tls", 143: "starttls" }, smtp: { 465: "tls", 587: "starttls" } } as const;

/** "Other (IMAP)": the form, then a live check of both servers before saving. */
async function handleImapConnect(request: Request, env: Env, url: URL) {
  const user = await currentUser(env.DB, request);
  if (!user) return redirect(`/auth/login?return_to=${encodeURIComponent(url.pathname + url.search)}`);
  const presets = IMAP_PRESETS;
  const render = (values: ImapFormValues, nonce: string | null, error?: string, status = 200) =>
    html(imapPage({ presets, values, error, nonce, microsoft: oauthConfigured(env, "microsoft") }), status);
  if (request.method === "GET") {
    const email = url.searchParams.get("email") ?? "";
    const nonce = url.searchParams.get("r");
    const wanted = url.searchParams.get("preset") ?? "";
    const preset = presets[wanted] ? wanted : email ? presetForEmail(email) : "icloud";
    return render({ email, preset }, (await recallReturn(env.DB, user.id, nonce)) ? nonce : null);
  }
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!isSameOrigin(request, url.origin)) return json({ error: "Request not allowed." }, 403);
  const form = await request.formData().catch(() => null);
  const field = (name: string) => {
    const value = form?.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const nonce = field("r") || null;
  const returnTo = (await recallReturn(env.DB, user.id, nonce)) ?? "/";
  const presetKey = field("preset") === "custom" || presets[field("preset")] ? field("preset") : "custom";
  const values: ImapFormValues = {
    email: field("email"),
    preset: presetKey,
    username: field("username"),
    imapHost: field("imap_host"),
    imapPort: field("imap_port"),
    smtpHost: field("smtp_host"),
    smtpPort: field("smtp_port"),
    saveSent: field("save_sent") === "1",
  };
  const password = typeof form?.get("password") === "string" ? String(form.get("password")) : "";
  const fail = (message: string) => render(values, nonce, message, 400);
  let email: string;
  try {
    const [address, ...rest] = requireAddresses(values.email, "the email address");
    if (!address || rest.length) return fail("Enter one email address.");
    email = normalizeEmail(address.email);
  } catch {
    return fail("Enter a valid email address.");
  }
  if (isOutlookAddress(email)) {
    return fail(
      oauthConfigured(env, "microsoft")
        ? "Microsoft turned off app passwords for Outlook.com. Use Sign in with Microsoft instead."
        : "Microsoft turned off app passwords for Outlook.com, and Microsoft sign-in isn’t set up on this site.",
    );
  }
  if (!password || password.length > 200 || /[\r\n\0]/u.test(password)) return fail("Enter the app password.");
  const preset = presets[presetKey];
  const imapPort = preset ? preset.imapPort : Number(values.imapPort);
  const smtpPort = preset ? preset.smtpPort : Number(values.smtpPort);
  const imapSecurity = IMAP_PORTS.imap[imapPort as 993 | 143];
  const smtpSecurity = IMAP_PORTS.smtp[smtpPort as 465 | 587];
  const config: ImapConfig = {
    preset: presetKey,
    username: values.username || email,
    imapHost: (preset?.imapHost ?? values.imapHost ?? "").toLowerCase(),
    imapPort,
    imapSecurity,
    smtpHost: (preset?.smtpHost ?? values.smtpHost ?? "").toLowerCase(),
    smtpPort,
    smtpSecurity,
    saveSent: preset ? preset.saveSent : Boolean(values.saveSent),
  };
  if (!imapSecurity || !smtpSecurity) return fail("Use IMAP port 993 or 143 and SMTP port 465 or 587.");
  if (!isPublicHost(config.imapHost) || !isPublicHost(config.smtpHost)) return fail("Enter the IMAP and SMTP server names, like imap.example.com.");
  if (config.username.length > 254 || /[\r\n\0]/u.test(config.username)) return fail("Enter a valid user name.");
  try {
    await verifyImapAccount(config, password);
  } catch (failure) {
    if (failure instanceof AuthError) return fail(`${failure.message} Check that it’s an app password for ${email}.`);
    if (failure instanceof MailError) return fail(failure.message);
    console.error("Checking an IMAP account failed", failure instanceof Error ? failure.name : "unknown");
    return fail("Couldn’t reach the mail servers. Check the settings and try again.");
  }
  await saveAccount(env, { userId: user.id, provider: "imap", email, secret: password, config });
  return redirect(safeReturnTo(returnTo), {}, 303);
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error("Unhandled mail request", error);
      return json({ error: "Something went wrong." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
