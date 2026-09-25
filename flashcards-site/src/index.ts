import { callTool, FLASHCARD_TOOLS, handleMcpMessage, type JsonRpcMessage } from "./mcp.ts";
import {
  authorizationServerMetadata,
  isAllowedRedirectUri,
  isOurResource,
  mcpResourceUrl,
  OAuthServer,
  protectedResourceMetadata,
} from "./oauth.ts";
import { appPage, consentPage, messagePage } from "./pages.ts";
import { currentUser, endSession, startSession } from "./session.ts";
import { FlashcardError, FlashcardStore } from "./store.ts";
import { html, json, redirect, sha256, type Env } from "./util.ts";
import { beginVoxLogin, clearLoginCookie, finishVoxLogin } from "./vox-login.ts";

// Vox Flash Cards: an independent site. People sign in with their Vox account,
// manage their cards here, and connect MCP clients (Vox, Claude, ChatGPT, …).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

const toolNames = new Set<string>(FLASHCARD_TOOLS.map((tool) => tool.name));
const MAX_BODY_BYTES = 256 * 1024;

function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status, corsHeaders);
}

function withQuery(uri: string, values: Record<string, string | null>) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(values)) if (value !== null) url.searchParams.set(key, value);
  return url.toString();
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
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in with your Vox account to use these flash cards." } },
      401,
      {
        ...corsHeaders,
        "WWW-Authenticate": `Bearer realm="vox-flashcards", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
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
  const store = new FlashcardStore(env.DB, ownerId);
  const messages = Array.isArray(payload) ? payload.slice(0, 20) : [payload];
  const responses = [];
  for (const message of messages) {
    const response = await handleMcpMessage(store, (message ?? {}) as JsonRpcMessage);
    if (response) responses.push(response);
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
      let returnHost = result.redirectUri;
      try {
        returnHost = new URL(result.redirectUri).host || result.redirectUri;
      } catch {
        // Keep the raw value.
      }
      return html(consentPage({ clientName: result.client.name, userName: user.name, returnHost, query: url.searchParams.toString() }));
    }
    if (request.method === "POST") {
      // Only this site's own approval page may submit a decision.
      if (request.headers.get("origin") !== origin) return json({ error: "Request not allowed." }, 403);
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
    if (request.headers.get("origin") !== origin) return json({ error: "Request not allowed." }, 403);
    return new Response(null, { status: 204, headers: { "Set-Cookie": await endSession(env.DB, request) } });
  }

  // ---- The editor's API (session cookie) ----
  if (path.startsWith("/api/")) {
    const user = await currentUser(env.DB, request);
    if (!user) return json({ error: "Sign in with Vox first." }, 401);
    // State-changing requests must come from this site's own pages.
    if (request.method !== "GET" && request.headers.get("origin") !== origin) {
      return json({ error: "Request not allowed." }, 403);
    }
    if (path === "/api/me") return json({ user: { name: user.name } });
    if (path === "/api/tool" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { tool?: unknown; arguments?: unknown } | null;
      const tool = typeof body?.tool === "string" ? body.tool : "";
      if (!toolNames.has(tool)) return json({ error: "Unknown action." }, 400);
      const args = body?.arguments && typeof body.arguments === "object" ? (body.arguments as Record<string, unknown>) : {};
      try {
        return json({ result: await callTool(new FlashcardStore(env.DB, user.id), tool, args) });
      } catch (error) {
        if (error instanceof FlashcardError) return json({ error: error.message }, 400);
        console.error("Flash-card action failed", tool, error);
        return json({ error: "That action could not be completed." }, 500);
      }
    }
    if (path === "/api/connections") {
      if (request.method === "GET") return json({ apps: await oauth.listGrants(user.id) });
      if (request.method === "DELETE") {
        const body = (await request.json().catch(() => ({}))) as { grantId?: unknown };
        const grantId = typeof body.grantId === "string" ? body.grantId : "";
        return (await oauth.revokeGrant(user.id, grantId)) ? json({ revoked: grantId }) : json({ error: "Not found." }, 404);
      }
    }
    return json({ error: "Not found." }, 404);
  }

  if (path === "/" && request.method === "GET") return html(appPage(mcpResourceUrl(origin)));
  return html(messagePage("Not found", "There’s nothing here.", { href: "/", label: "Go to your flash cards" }), 404);
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error("Unhandled flash-card request", error);
      return json({ error: "Something went wrong." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
