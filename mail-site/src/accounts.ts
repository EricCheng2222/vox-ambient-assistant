import { type Env, MailError, base64UrlToBytes, bytesToBase64Url, now, randomSecret, sha256 } from "./util.ts";

// A Vox user's email accounts. Each has a short random id that is part of
// every message id handed to MCP clients, so a message always routes back to
// its own account. The account's secret (an OAuth refresh token or an IMAP
// app password) is AES-GCM encrypted, bound to the user and the account id.

export type ProviderKind = "gmail" | "microsoft" | "imap";

export type Security = "tls" | "starttls";

export type ImapConfig = {
  preset: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  // Some servers (iCloud, Gmail) file sent mail themselves; others need an APPEND.
  saveSent: boolean;
};

export type MailAccount = {
  id: string;
  userId: string;
  provider: ProviderKind;
  email: string;
  secret: string;
  iv: string;
  scope: string;
  config: string;
  status: "connected" | "disconnected";
  isPrimary: number;
  accessToken: string | null;
  accessIv: string | null;
  accessExpiresAt: string | null;
  connectedAt: string;
};

export const ACCOUNT_ID = /^[a-z0-9]{8}$/u;
const RETURN_TTL_MS = 30 * 60_000;

export const PROVIDER_LABELS: Record<ProviderKind, string> = { gmail: "Gmail", microsoft: "Outlook", imap: "IMAP" };

async function secretKey(env: Env) {
  const secret = env.MAIL_TOKEN_SECRET?.trim();
  if (!secret) throw new MailError("Email isn't set up on this site yet (MAIL_TOKEN_SECRET is missing).");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vox-mail-account-secrets:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Binds a ciphertext to one user's one account, so rows can't be swapped. */
function binding(owner: { userId: string; id: string }) {
  return new TextEncoder().encode(`${owner.userId}\n${owner.id}`);
}

export async function sealSecret(env: Env, owner: { userId: string; id: string }, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: binding(owner) },
    await secretKey(env),
    new TextEncoder().encode(value),
  );
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

export async function openSecret(env: Env, owner: { userId: string; id: string }, ciphertext: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv), additionalData: binding(owner) },
    await secretKey(env),
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

const COLUMNS = `id, user_id AS userId, provider, email, secret, iv, scope, config, status, is_primary AS isPrimary,
  access_token AS accessToken, access_iv AS accessIv, access_expires_at AS accessExpiresAt, connected_at AS connectedAt`;

export async function listAccounts(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM mail_accounts WHERE user_id = ?1 ORDER BY is_primary DESC, connected_at, id`)
    .bind(userId)
    .all<MailAccount>();
  return results;
}

export function getAccount(db: D1Database, userId: string, id: string) {
  return db.prepare(`SELECT ${COLUMNS} FROM mail_accounts WHERE user_id = ?1 AND id = ?2`).bind(userId, id).first<MailAccount>();
}

function newAccountId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => alphabet[byte % 36]).join("");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Adds an account, or replaces the one with the same address (keeping its
 * id and primary flag, so earlier message ids still work).
 */
export async function saveAccount(
  env: Env,
  input: {
    userId: string;
    provider: ProviderKind;
    email: string;
    secret: string;
    scope?: string;
    config?: ImapConfig | Record<string, never>;
    access?: { token: string; expiresIn?: number };
  },
) {
  const email = normalizeEmail(input.email);
  const existing = await env.DB
    .prepare("SELECT id, is_primary AS isPrimary FROM mail_accounts WHERE user_id = ?1 AND email = ?2")
    .bind(input.userId, email)
    .first<{ id: string; isPrimary: number }>();
  const others = await env.DB
    .prepare("SELECT count(*) AS count FROM mail_accounts WHERE user_id = ?1 AND email != ?2")
    .bind(input.userId, email)
    .first<{ count: number }>();
  const owner = { userId: input.userId, id: existing?.id ?? newAccountId() };
  const secret = await sealSecret(env, owner, input.secret);
  const access = input.access ? await sealSecret(env, owner, input.access.token) : null;
  const stamp = now();
  await env.DB
    .prepare(
      `INSERT INTO mail_accounts (id, user_id, provider, email, secret, iv, scope, config, status, is_primary, access_token, access_iv, access_expires_at, connected_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'connected', ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT (id) DO UPDATE SET provider = excluded.provider, secret = excluded.secret, iv = excluded.iv, scope = excluded.scope,
         config = excluded.config, status = 'connected', access_token = excluded.access_token, access_iv = excluded.access_iv,
         access_expires_at = excluded.access_expires_at, connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
    )
    .bind(
      owner.id,
      input.userId,
      input.provider,
      email,
      secret.ciphertext,
      secret.iv,
      input.scope ?? "",
      JSON.stringify(input.config ?? {}),
      existing ? existing.isPrimary : Number(!others?.count),
      access?.ciphertext ?? null,
      access?.iv ?? null,
      input.access ? new Date(Date.now() + Math.max(60, input.access.expiresIn ?? 3600) * 1000).toISOString() : null,
      stamp,
    )
    .run();
  return owner.id;
}

export async function removeAccount(db: D1Database, userId: string, id: string) {
  await db.prepare("DELETE FROM mail_accounts WHERE user_id = ?1 AND id = ?2").bind(userId, id).run();
  // Keep exactly one primary account while any remain.
  await db
    .prepare(
      `UPDATE mail_accounts SET is_primary = 1 WHERE id = (
         SELECT id FROM mail_accounts WHERE user_id = ?1 ORDER BY connected_at, id LIMIT 1
       ) AND NOT EXISTS (SELECT 1 FROM mail_accounts WHERE user_id = ?1 AND is_primary = 1)`,
    )
    .bind(userId)
    .run();
}

export async function setPrimary(db: D1Database, userId: string, id: string) {
  if (!(await getAccount(db, userId, id))) return false;
  await db.batch([
    db.prepare("UPDATE mail_accounts SET is_primary = 0 WHERE user_id = ?1").bind(userId),
    db.prepare("UPDATE mail_accounts SET is_primary = 1 WHERE user_id = ?1 AND id = ?2").bind(userId, id),
  ]);
  return true;
}

export async function markDisconnected(db: D1Database, account: { userId: string; id: string }) {
  await db
    .prepare(
      `UPDATE mail_accounts SET status = 'disconnected', access_token = NULL, access_iv = NULL, access_expires_at = NULL, updated_at = ?3
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(account.userId, account.id, now())
    .run();
}

/** Caches a fresh OAuth access token (and a rotated refresh token, as Microsoft issues). */
export async function storeAccess(env: Env, account: MailAccount, token: string, expiresIn: number | undefined, refreshToken?: string) {
  const access = await sealSecret(env, account, token);
  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn ?? 3600) * 1000).toISOString();
  const refresh = refreshToken ? await sealSecret(env, account, refreshToken) : null;
  await env.DB
    .prepare(
      `UPDATE mail_accounts SET access_token = ?3, access_iv = ?4, access_expires_at = ?5, secret = coalesce(?6, secret), iv = coalesce(?7, iv), updated_at = ?8
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(account.userId, account.id, access.ciphertext, access.iv, expiresAt, refresh?.ciphertext ?? null, refresh?.iv ?? null, now())
    .run();
  return {
    ...account,
    accessToken: access.ciphertext,
    accessIv: access.iv,
    accessExpiresAt: expiresAt,
    ...(refresh ? { secret: refresh.ciphertext, iv: refresh.iv } : {}),
  };
}

/** Parks where to go back to (an app's authorization request) behind a nonce. */
export async function rememberReturn(db: D1Database, userId: string, returnTo: string) {
  const nonce = randomSecret();
  const stamp = new Date();
  await db.batch([
    db.prepare("DELETE FROM pending_returns WHERE expires_at <= ?1").bind(stamp.toISOString()),
    db.prepare("INSERT INTO pending_returns (nonce_hash, user_id, return_to, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(await sha256(nonce), userId, returnTo, new Date(stamp.getTime() + RETURN_TTL_MS).toISOString()),
  ]);
  return nonce;
}

export async function recallReturn(db: D1Database, userId: string, nonce: string | null) {
  if (!nonce) return null;
  const row = await db
    .prepare("SELECT return_to AS returnTo FROM pending_returns WHERE nonce_hash = ?1 AND user_id = ?2 AND expires_at > ?3")
    .bind(await sha256(nonce), userId, now())
    .first<{ returnTo: string }>();
  return row?.returnTo ?? null;
}
