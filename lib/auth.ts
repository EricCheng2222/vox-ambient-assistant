const COOKIE_NAME = "vox_session";

function authConfig() {
  const accessCode = process.env.VOX_ACCESS_CODE?.trim();
  const sessionSecret = process.env.VOX_SESSION_SECRET?.trim();
  return accessCode && sessionSecret ? { accessCode, sessionSecret } : null;
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function isAuthConfigured() {
  return Boolean(authConfig());
}

export async function createSessionToken() {
  const config = authConfig();
  if (!config) throw new Error("Vox access control is not configured.");
  return digest(`vox:${config.accessCode}:${config.sessionSecret}`);
}

export async function verifyAccessCode(code: string) {
  const config = authConfig();
  if (!config) return process.env.NODE_ENV !== "production";
  const expected = await digest(`code:${config.accessCode}:${config.sessionSecret}`);
  const received = await digest(`code:${code}:${config.sessionSecret}`);
  return constantTimeEqual(received, expected);
}

export async function isRequestAuthorized(request: Request) {
  const config = authConfig();
  if (!config) return process.env.NODE_ENV !== "production";
  const received = cookieValue(request, COOKIE_NAME);
  if (!received) return false;
  return constantTimeEqual(received, await createSessionToken());
}

export async function requireAuthorized(request: Request) {
  if (await isRequestAuthorized(request)) return null;
  return Response.json({ error: "Authentication required." }, { status: 401 });
}

export function sessionCookie(token: string) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`;
}

export function expiredSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
