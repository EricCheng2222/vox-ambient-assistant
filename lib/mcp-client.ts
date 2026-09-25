import { and, eq, gt, lte } from "drizzle-orm";

import { getDb } from "@/db";
import { mcpAuthStates, mcpClientRegistrations, mcpConnections } from "@/db/schema";

// Vox as an MCP client. A user connects Vox to a remote MCP server (such as
// Vox Flash Cards) once through the server's OAuth sign-in; Vox keeps the
// resulting tokens encrypted and refreshes them so voice sessions can use the
// server's tools.

const DEFAULT_FLASHCARDS_MCP_URL = "https://vox-flashcards.ericcheng306.workers.dev/mcp";
const AUTH_STATE_TTL_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 2 * 60_000;

export function flashcardsServerUrl() {
  return process.env.FLASHCARDS_MCP_URL?.trim() || DEFAULT_FLASHCARDS_MCP_URL;
}

export class McpConnectionError extends Error {}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function randomSecret() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function encryptionKey() {
  const secret =
    process.env.VOX_CONTACT_SECRET?.trim() ||
    process.env.VOX_SESSION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "vox-local-mcp-secret" : "");
  if (!secret) throw new Error("Vox connection security is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mcp-connections:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

async function decrypt(ciphertext: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    await encryptionKey(),
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

type ServerMetadata = {
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
};

/** Finds the server's OAuth details (RFC 9728 and RFC 8414). */
async function discover(serverUrl: string): Promise<ServerMetadata> {
  const url = new URL(serverUrl);
  const candidates = [
    `${url.origin}/.well-known/oauth-protected-resource${url.pathname.replace(/\/+$/u, "")}`,
    `${url.origin}/.well-known/oauth-protected-resource`,
  ];
  let resource: { resource?: string; authorization_servers?: string[] } | null = null;
  for (const candidate of candidates) {
    resource = await fetchJson(candidate);
    if (resource?.authorization_servers?.length) break;
  }
  const issuer = (resource?.authorization_servers?.[0] ?? url.origin).replace(/\/+$/u, "");
  const issuerUrl = new URL(issuer);
  const metadata = await fetchJson<{
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    registration_endpoint?: string;
  }>(`${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === "/" ? "" : issuerUrl.pathname}`);
  if (!metadata?.authorization_endpoint || !metadata.token_endpoint || !metadata.registration_endpoint) {
    throw new McpConnectionError("That server does not support signing in.");
  }
  return {
    resource: resource?.resource ?? serverUrl,
    issuer,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    registrationEndpoint: metadata.registration_endpoint,
  };
}

async function clientRegistration(metadata: ServerMetadata, redirectUri: string) {
  const [existing] = await getDb()
    .select()
    .from(mcpClientRegistrations)
    .where(eq(mcpClientRegistrations.issuer, metadata.issuer))
    .limit(1);
  if (existing && existing.redirectUri === redirectUri) return existing;
  const registered = await fetchJson<{ client_id?: string }>(metadata.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Vox", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"] }),
  });
  if (!registered?.client_id) throw new McpConnectionError("Vox could not register with that server.");
  const record = {
    issuer: metadata.issuer,
    clientId: registered.client_id,
    redirectUri,
    authorizationEndpoint: metadata.authorizationEndpoint,
    tokenEndpoint: metadata.tokenEndpoint,
    createdAt: new Date().toISOString(),
  };
  await getDb()
    .insert(mcpClientRegistrations)
    .values(record)
    .onConflictDoUpdate({ target: mcpClientRegistrations.issuer, set: record });
  return record;
}

/** Starts connecting; returns the server's sign-in URL to open in a browser. */
export async function beginConnection(ownerId: string, serverUrl: string, voxOrigin: string) {
  const metadata = await discover(serverUrl);
  const registration = await clientRegistration(metadata, `${voxOrigin}/api/connections/callback`);
  const state = randomSecret();
  const verifier = randomSecret();
  const now = new Date();
  const db = getDb();
  await db.delete(mcpAuthStates).where(lte(mcpAuthStates.expiresAt, now.toISOString()));
  const sealedVerifier = await encrypt(verifier);
  await db.insert(mcpAuthStates).values({
    stateHash: await sha256(state),
    ownerId,
    serverUrl,
    issuer: metadata.issuer,
    codeVerifier: `${sealedVerifier.iv}.${sealedVerifier.ciphertext}`,
    expiresAt: new Date(now.getTime() + AUTH_STATE_TTL_MS).toISOString(),
  });
  const url = new URL(registration.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: registration.clientId,
    redirect_uri: registration.redirectUri,
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
    resource: metadata.resource,
    scope: "flashcards",
  }).toString();
  return url.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number };

async function storeTokens(ownerId: string, serverUrl: string, issuer: string, tokens: TokenResponse) {
  if (!tokens.access_token) throw new McpConnectionError("The server did not issue access.");
  const access = await encrypt(tokens.access_token);
  const refresh = tokens.refresh_token ? await encrypt(tokens.refresh_token) : null;
  const now = new Date();
  const values = {
    accessCiphertext: access.ciphertext,
    accessIv: access.iv,
    accessExpiresAt: new Date(now.getTime() + Math.max(60, tokens.expires_in ?? 3600) * 1000).toISOString(),
    refreshCiphertext: refresh?.ciphertext ?? null,
    refreshIv: refresh?.iv ?? null,
    issuer,
    updatedAt: now.toISOString(),
  };
  await getDb()
    .insert(mcpConnections)
    .values({ id: crypto.randomUUID(), ownerId, serverUrl, createdAt: now.toISOString(), ...values })
    .onConflictDoUpdate({ target: [mcpConnections.ownerId, mcpConnections.serverUrl], set: values });
}

/** Completes a connection for the Vox user who started it. */
export async function finishConnection(ownerId: string, state: string, code: string) {
  const [pending] = await getDb()
    .delete(mcpAuthStates)
    .where(
      and(
        eq(mcpAuthStates.stateHash, await sha256(state)),
        eq(mcpAuthStates.ownerId, ownerId),
        gt(mcpAuthStates.expiresAt, new Date().toISOString()),
      ),
    )
    .returning();
  if (!pending) throw new McpConnectionError("This connection link expired or belongs to another Vox account.");
  const [registration] = await getDb()
    .select()
    .from(mcpClientRegistrations)
    .where(eq(mcpClientRegistrations.issuer, pending.issuer))
    .limit(1);
  if (!registration) throw new McpConnectionError("Start connecting again.");
  const [iv, ciphertext] = pending.codeVerifier.split(".");
  const tokens = await fetchJson<TokenResponse>(registration.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: registration.redirectUri,
      client_id: registration.clientId,
      code_verifier: await decrypt(ciphertext, iv),
    }),
  });
  if (!tokens) throw new McpConnectionError("The server did not accept the sign-in.");
  await storeTokens(ownerId, pending.serverUrl, pending.issuer, tokens);
  return pending.serverUrl;
}

export async function connectionStatus(ownerId: string, serverUrl: string) {
  const [connection] = await getDb()
    .select({ createdAt: mcpConnections.createdAt })
    .from(mcpConnections)
    .where(and(eq(mcpConnections.ownerId, ownerId), eq(mcpConnections.serverUrl, serverUrl)))
    .limit(1);
  return { connected: Boolean(connection), connectedAt: connection?.createdAt ?? null };
}

export async function disconnect(ownerId: string, serverUrl: string) {
  await getDb()
    .delete(mcpConnections)
    .where(and(eq(mcpConnections.ownerId, ownerId), eq(mcpConnections.serverUrl, serverUrl)));
}

/** True unless the server rejects the token (for example after the user revoked Vox there). */
export async function isTokenAccepted(serverUrl: string, token: string) {
  try {
    const response = await fetch(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: "vox-check", method: "ping" }),
    });
    return response.status !== 401 && response.status !== 403;
  } catch {
    // A network blip is not a revocation; let the voice session try.
    return true;
  }
}

/**
 * A current access token for the server, refreshing it when it is about to
 * expire. Returns null when the user must connect (again).
 */
export async function getAccessToken(ownerId: string, serverUrl: string, options: { forceRefresh?: boolean } = {}) {
  const [connection] = await getDb()
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.ownerId, ownerId), eq(mcpConnections.serverUrl, serverUrl)))
    .limit(1);
  if (!connection) return null;
  if (!options.forceRefresh && Date.parse(connection.accessExpiresAt) - Date.now() > REFRESH_MARGIN_MS) {
    return decrypt(connection.accessCiphertext, connection.accessIv);
  }
  const [registration] = await getDb()
    .select()
    .from(mcpClientRegistrations)
    .where(eq(mcpClientRegistrations.issuer, connection.issuer))
    .limit(1);
  if (!registration || !connection.refreshCiphertext || !connection.refreshIv) {
    await disconnect(ownerId, serverUrl);
    return null;
  }
  const tokens = await fetchJson<TokenResponse>(registration.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: await decrypt(connection.refreshCiphertext, connection.refreshIv),
      client_id: registration.clientId,
    }),
  });
  if (!tokens?.access_token) {
    // Revoked or expired on the server: the user needs to connect again.
    await disconnect(ownerId, serverUrl);
    return null;
  }
  await storeTokens(ownerId, serverUrl, connection.issuer, tokens);
  return tokens.access_token;
}
