import { now, randomSecret, sha256 } from "./util.ts";

// OAuth 2.1 authorization server for MCP clients (Vox, Claude, ChatGPT, …):
// dynamic client registration, PKCE (S256), short-lived access tokens, and
// rotating refresh tokens. Every secret is stored only as a SHA-256 hash.
export const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60_000;
const AUTH_CODE_TTL_MS = 5 * 60_000;
const MAX_GRANTS_PER_OWNER = 20;

const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:"]);

/** HTTPS, loopback HTTP (RFC 8252), or an app's private-use scheme. */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/u.test(url.protocol);
}

export function mcpResourceUrl(origin: string) {
  return `${origin}/mcp`;
}

export function isOurResource(resource: string | null, origin: string) {
  if (!resource) return true;
  const trimmed = resource.replace(/\/+$/u, "");
  return trimmed === origin || trimmed === mcpResourceUrl(origin);
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: ["flashcards"],
    bearer_methods_supported: ["header"],
    resource_name: "Vox Flash Cards",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["flashcards"],
    authorization_response_iss_parameter_supported: true,
  };
}

export class OAuthServer {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  private async removeExpired() {
    const stamp = now();
    await this.db.batch([
      this.db.prepare("DELETE FROM oauth_tokens WHERE expires_at <= ?1").bind(stamp),
      this.db.prepare("DELETE FROM oauth_codes WHERE expires_at <= ?1").bind(stamp),
    ]);
  }

  async registerClient(name: string, redirectUris: string[]) {
    const id = crypto.randomUUID();
    await this.db
      .prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(id, name.trim().slice(0, 80) || "MCP client", JSON.stringify(redirectUris), now())
      .run();
    return id;
  }

  async getClient(id: string) {
    const row = await this.db
      .prepare("SELECT id, name, redirect_uris AS redirectUris FROM oauth_clients WHERE id = ?1")
      .bind(id)
      .first<{ id: string; name: string; redirectUris: string }>();
    return row ? { id: row.id, name: row.name, redirectUris: JSON.parse(row.redirectUris) as string[] } : null;
  }

  async createCode(input: { clientId: string; ownerId: string; redirectUri: string; codeChallenge: string }) {
    await this.removeExpired();
    const code = randomSecret("fc_code_");
    await this.db
      .prepare(
        "INSERT INTO oauth_codes (code_hash, client_id, owner_id, redirect_uri, code_challenge, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      )
      .bind(await sha256(code), input.clientId, input.ownerId, input.redirectUri, input.codeChallenge, new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString())
      .run();
    return code;
  }

  /** Returns and deletes the code, so each code works once. */
  async consumeCode(code: string) {
    return this.db
      .prepare(
        `DELETE FROM oauth_codes WHERE code_hash = ?1 AND expires_at > ?2
         RETURNING client_id AS clientId, owner_id AS ownerId, redirect_uri AS redirectUri, code_challenge AS codeChallenge`,
      )
      .bind(await sha256(code), now())
      .first<{ clientId: string; ownerId: string; redirectUri: string; codeChallenge: string }>();
  }

  async issueTokens(ownerId: string, client: { id: string; name: string }, grantId?: string) {
    await this.removeExpired();
    if (!grantId && (await this.listGrants(ownerId)).length >= MAX_GRANTS_PER_OWNER) {
      throw new Error("Too many connected apps. Disconnect one first.");
    }
    const grant = grantId ?? crypto.randomUUID();
    const access = randomSecret("fc_at_");
    const refresh = randomSecret("fc_rt_");
    const stamp = now();
    const insert = (token: string, kind: string, ttl: number) =>
      sha256(token).then((hash) =>
        this.db
          .prepare(
            "INSERT INTO oauth_tokens (id, owner_id, token_hash, kind, grant_id, client_id, label, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
          )
          .bind(crypto.randomUUID(), ownerId, hash, kind, grant, client.id, client.name, stamp, new Date(Date.now() + ttl).toISOString()),
      );
    await this.db.batch([
      await insert(access, "access", ACCESS_TOKEN_TTL_MS),
      await insert(refresh, "refresh", REFRESH_TOKEN_TTL_MS),
    ]);
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refresh,
      scope: "flashcards",
    };
  }

  /** Rotates a refresh token: the old one stops working; a new pair is issued. */
  async refresh(refreshToken: string, clientId: string) {
    const record = await this.db
      .prepare(
        `DELETE FROM oauth_tokens WHERE token_hash = ?1 AND kind = 'refresh' AND client_id = ?2 AND expires_at > ?3
         RETURNING owner_id AS ownerId, grant_id AS grantId`,
      )
      .bind(await sha256(refreshToken), clientId, now())
      .first<{ ownerId: string; grantId: string }>();
    const client = record ? await this.getClient(clientId) : null;
    return record && client ? this.issueTokens(record.ownerId, client, record.grantId) : null;
  }

  async authenticate(accessToken: string) {
    if (!accessToken.startsWith("fc_at_") || accessToken.length > 120) return null;
    const stamp = now();
    const record = await this.db
      .prepare(
        "SELECT id, owner_id AS ownerId, last_used_at AS lastUsedAt FROM oauth_tokens WHERE token_hash = ?1 AND kind = 'access' AND expires_at > ?2",
      )
      .bind(await sha256(accessToken), stamp)
      .first<{ id: string; ownerId: string; lastUsedAt: string | null }>();
    if (!record) return null;
    if (!record.lastUsedAt || Date.parse(record.lastUsedAt) < Date.now() - 60_000) {
      await this.db.prepare("UPDATE oauth_tokens SET last_used_at = ?1 WHERE id = ?2").bind(stamp, record.id).run();
    }
    return record.ownerId;
  }

  async listGrants(ownerId: string) {
    const { results } = await this.db
      .prepare(
        `SELECT grant_id AS grantId, max(label) AS name, min(created_at) AS connectedAt, max(last_used_at) AS lastUsedAt
         FROM oauth_tokens WHERE owner_id = ?1 AND expires_at > ?2 GROUP BY grant_id ORDER BY min(created_at) DESC`,
      )
      .bind(ownerId, now())
      .all<{ grantId: string; name: string; connectedAt: string; lastUsedAt: string | null }>();
    return results;
  }

  async revokeGrant(ownerId: string, grantId: string) {
    const result = await this.db
      .prepare("DELETE FROM oauth_tokens WHERE owner_id = ?1 AND grant_id = ?2")
      .bind(ownerId, grantId)
      .run();
    return Number(result.meta.changes ?? 0) > 0;
  }
}
