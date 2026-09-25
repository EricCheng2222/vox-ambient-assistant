import { now, randomSecret, sha256 } from "./util.ts";

// Browser sessions for this site. Users sign in with their Vox account; the
// cookie is SameSite=Lax so returning from Vox's sign-in page keeps it.
const SESSION_COOKIE = "fc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export type SiteUser = { id: string; name: string };

function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export async function currentUser(db: D1Database, request: Request): Promise<SiteUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
    )
    .bind(await sha256(token), now())
    .first<SiteUser>();
}

export async function startSession(db: D1Database, user: SiteUser) {
  const stamp = now();
  const token = randomSecret();
  await db.batch([
    db.prepare(
      `INSERT INTO users (id, name, created_at, last_login_at) VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, last_login_at = excluded.last_login_at`,
    ).bind(user.id, user.name, stamp),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(stamp),
    db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(await sha256(token), user.id, stamp, new Date(Date.now() + SESSION_TTL_MS).toISOString()),
  ]);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export async function endSession(db: D1Database, request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256(token)).run();
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
