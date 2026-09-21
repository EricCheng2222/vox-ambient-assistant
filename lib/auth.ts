const COOKIE_NAME = "vox_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const LOCAL_USER = { id: "owner", displayName: "Local user" } as const;

export type AuthenticatedUser = {
  id: string;
  displayName: string;
};

type ConfiguredUser = AuthenticatedUser & {
  accessCode: string;
};

type AuthConfig = {
  sessionSecret: string;
  users: ConfiguredUser[];
};

function configuredUsers(): ConfiguredUser[] {
  const raw = process.env.VOX_USERS_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      const users = parsed.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const value = candidate as Record<string, unknown>;
        const id = typeof value.id === "string" ? value.id.trim() : "";
        const name = typeof value.name === "string" ? value.name.trim() : "";
        const accessCode =
          typeof value.accessCode === "string" ? value.accessCode.trim() : "";
        if (
          !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(id) ||
          accessCode.length < 12
        ) {
          return [];
        }
        return [{ id, displayName: name.slice(0, 80) || "Vox user", accessCode }];
      });

      const uniqueIds = new Set(users.map((user) => user.id));
      const uniqueCodes = new Set(users.map((user) => user.accessCode));
      return uniqueIds.size === users.length && uniqueCodes.size === users.length
        ? users
        : [];
    } catch {
      return [];
    }
  }

  const legacyCode = process.env.VOX_ACCESS_CODE?.trim();
  return legacyCode
    ? [{ id: "owner", displayName: "Owner", accessCode: legacyCode }]
    : [];
}

function authConfig(): AuthConfig | null {
  const sessionSecret = process.env.VOX_SESSION_SECRET?.trim();
  const users = configuredUsers();
  return sessionSecret && users.length > 0 ? { sessionSecret, users } : null;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToText(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function isAuthConfigured() {
  return Boolean(authConfig());
}

export async function createSessionToken(userId: string) {
  const config = authConfig();
  if (!config || !config.users.some((user) => user.id === userId)) {
    throw new Error("Vox access control is not configured for this user.");
  }

  const payload = textToBase64Url(
    JSON.stringify({
      v: 1,
      sub: userId,
      exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    }),
  );
  return `${payload}.${await hmac(payload, config.sessionSecret)}`;
}

export async function verifyAccessCode(code: string): Promise<AuthenticatedUser | null> {
  const config = authConfig();
  if (!config) return process.env.NODE_ENV !== "production" ? LOCAL_USER : null;

  const received = await hmac(`code:${code}`, config.sessionSecret);
  let matched: ConfiguredUser | null = null;
  for (const user of config.users) {
    const expected = await hmac(`code:${user.accessCode}`, config.sessionSecret);
    if (constantTimeEqual(received, expected)) matched = user;
  }
  return matched ? { id: matched.id, displayName: matched.displayName } : null;
}

export async function getAuthorizedUser(
  request: Request,
): Promise<AuthenticatedUser | null> {
  const config = authConfig();
  if (!config) return process.env.NODE_ENV !== "production" ? LOCAL_USER : null;

  const token = cookieValue(request, COOKIE_NAME);
  const [payload, receivedSignature, ...extra] = token.split(".");
  if (!payload || !receivedSignature || extra.length > 0) return null;

  const expectedSignature = await hmac(payload, config.sessionSecret);
  if (!constantTimeEqual(receivedSignature, expectedSignature)) return null;

  try {
    const claims = JSON.parse(base64UrlToText(payload)) as {
      v?: number;
      sub?: string;
      exp?: number;
    };
    if (claims.v !== 1 || typeof claims.sub !== "string") return null;
    if (typeof claims.exp !== "number" || claims.exp <= Date.now()) return null;
    const user = config.users.find((candidate) => candidate.id === claims.sub);
    return user ? { id: user.id, displayName: user.displayName } : null;
  } catch {
    return null;
  }
}

export async function isRequestAuthorized(request: Request) {
  return Boolean(await getAuthorizedUser(request));
}

export async function requireUser(request: Request) {
  const user = await getAuthorizedUser(request);
  if (user) return { user } as const;
  return {
    response: Response.json({ error: "Authentication required." }, { status: 401 }),
  } as const;
}

export function sessionCookie(token: string) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function expiredSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
