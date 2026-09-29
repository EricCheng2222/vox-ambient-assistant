export type Env = {
  DB: D1Database;
  VOX_URL: string;
  // Service binding to the Vox Worker when both run on one Cloudflare account
  // (Workers there cannot reach each other through workers.dev URLs).
  VOX?: Fetcher;
  // Google OAuth client for Gmail (wrangler secrets).
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Microsoft Entra app for Outlook.com and Microsoft 365 (wrangler secrets).
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  // Encrypts refresh tokens and IMAP passwords at rest in D1.
  MAIL_TOKEN_SECRET?: string;
};

/** A failure whose message is safe to show the user (and the voice model). */
export class MailError extends Error {}

export function now() {
  return new Date().toISOString();
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  // Chunked so large attachments don't overflow the argument list.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string) {
  const normal = value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  return Uint8Array.from(atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
}

/** A 256-bit random secret with a readable prefix. */
export function randomSecret(prefix = "") {
  return `${prefix}${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

/** Only same-site paths may be returned to after signing in or connecting. */
export function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

const pageSecurityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // same-origin (not no-referrer) so browsers still send Origin on this site's own form posts.
  "Referrer-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000",
  "Cache-Control": "no-store",
};

export function html(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...pageSecurityHeaders, ...headers },
  });
}

export function redirect(location: string, headers: Record<string, string> = {}, status = 302) {
  return new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store", ...headers } });
}
