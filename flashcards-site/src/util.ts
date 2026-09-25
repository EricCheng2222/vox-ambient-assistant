export type Env = {
  DB: D1Database;
  VOX_URL: string;
  // Service binding to the Vox Worker when both run on one Cloudflare account
  // (Workers there cannot reach each other through workers.dev URLs).
  VOX?: Fetcher;
};

export function now() {
  return new Date().toISOString();
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

const pageSecurityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "Cache-Control": "no-store",
};

export function html(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...pageSecurityHeaders, ...headers },
  });
}

export function redirect(location: string, headers: Record<string, string> = {}) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", ...headers } });
}
