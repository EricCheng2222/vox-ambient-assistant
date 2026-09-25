import { and, eq, gt, lte } from "drizzle-orm";

import { getDb } from "@/db";
import { oauthClients, oauthCodes, oauthTokens } from "@/db/schema";
import { clientSector } from "@/lib/oauth";

// Storage for "Sign in with Vox". Codes and tokens are 256-bit random values
// stored only as SHA-256 hashes. Tokens are short-lived and only reveal who
// the user is (a per-site account id and display name) — never Vox data.
const AUTH_CODE_TTL_MS = 5 * 60_000;
const IDENTITY_TOKEN_TTL_MS = 10 * 60_000;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomSecret(prefix: string) {
  return `${prefix}${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function removeExpired() {
  const now = new Date().toISOString();
  await getDb().delete(oauthCodes).where(lte(oauthCodes.expiresAt, now));
  await getDb().delete(oauthTokens).where(lte(oauthTokens.expiresAt, now));
}

export async function registerClient(name: string, redirectUris: string[]) {
  const id = crypto.randomUUID();
  await getDb().insert(oauthClients).values({
    id,
    name: name.trim().slice(0, 80) || "App",
    redirectUris: JSON.stringify(redirectUris),
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function getClient(id: string) {
  const [client] = await getDb().select().from(oauthClients).where(eq(oauthClients.id, id)).limit(1);
  if (!client) return null;
  return { id: client.id, name: client.name, redirectUris: JSON.parse(client.redirectUris) as string[] };
}

export async function createAuthorizationCode(input: {
  clientId: string;
  ownerId: string;
  redirectUri: string;
  codeChallenge: string;
}) {
  await removeExpired();
  const code = randomSecret("vox_code_");
  await getDb().insert(oauthCodes).values({
    codeHash: await sha256Base64Url(code),
    ...input,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  });
  return code;
}

/** Returns the code's grant and deletes it, so each code works only once. */
export async function consumeAuthorizationCode(code: string) {
  const [record] = await getDb()
    .delete(oauthCodes)
    .where(and(eq(oauthCodes.codeHash, await sha256Base64Url(code)), gt(oauthCodes.expiresAt, new Date().toISOString())))
    .returning();
  return record ?? null;
}

export async function issueIdentityToken(ownerId: string, clientId: string) {
  const token = randomSecret("vox_id_");
  await getDb().insert(oauthTokens).values({
    tokenHash: await sha256Base64Url(token),
    ownerId,
    clientId,
    expiresAt: new Date(Date.now() + IDENTITY_TOKEN_TTL_MS).toISOString(),
  });
  return { access_token: token, token_type: "Bearer", expires_in: IDENTITY_TOKEN_TTL_MS / 1000, scope: "identity" };
}

export async function resolveIdentityToken(token: string) {
  if (!token.startsWith("vox_id_") || token.length > 120) return null;
  const [record] = await getDb()
    .select({ ownerId: oauthTokens.ownerId, clientId: oauthTokens.clientId })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.tokenHash, await sha256Base64Url(token)), gt(oauthTokens.expiresAt, new Date().toISOString())))
    .limit(1);
  return record ?? null;
}

/**
 * A stable account id for one site: different sites get unrelated ids for the
 * same Vox user, so they cannot correlate accounts with each other.
 */
export async function pairwiseSubject(ownerId: string, redirectUris: string[]) {
  const secret =
    process.env.VOX_CONTACT_SECRET?.trim() ||
    process.env.VOX_SESSION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "vox-local-subject-secret" : "");
  if (!secret) throw new Error("Vox sign-in is not configured.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`subject:${clientSector(redirectUris)}:${ownerId}`));
  return bytesToBase64Url(new Uint8Array(signature));
}
