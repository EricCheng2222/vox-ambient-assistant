// "Sign in with Vox": pure helpers for Vox's OAuth provider.

const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:"]);

/**
 * Redirect URIs a public client may register: HTTPS, loopback HTTP for local
 * apps (RFC 8252), or an app's private-use scheme.
 */
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

export const IDENTITY_SCOPE = "identity";

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    userinfo_endpoint: `${origin}/api/oauth/userinfo`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [IDENTITY_SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

/** The site a client's pairwise account id is scoped to. */
export function clientSector(redirectUris: string[]) {
  try {
    return new URL(redirectUris[0] ?? "").host || "unknown";
  } catch {
    return "unknown";
  }
}
