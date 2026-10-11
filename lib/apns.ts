// Sending a notification to an iPhone or iPad through Apple (APNs), from the
// Worker: a short-lived token signed with the account's push key, and one
// request per device. Nothing here knows who the device belongs to.

export type ApnsConfig = { keyId: string; teamId: string; privateKey: string; bundleId: string };
export type ApnsDevice = { token: string; environment: "development" | "production" };
export type ApnsNote = { title: string; body: string };
export type ApnsResult = { ok: true } | { ok: false; error: string; gone: boolean };

type Env = Record<string, string | undefined>;

/** The push key as configured, or null when notifications are not set up. */
export function getApnsConfig(env: Env = process.env): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID?.trim() ?? "";
  const teamId = env.APNS_TEAM_ID?.trim() ?? "";
  const privateKey = env.APNS_PRIVATE_KEY?.trim() ?? "";
  const bundleId = env.APNS_BUNDLE_ID?.trim() || "com.ericcheng.vox";
  if (!/^[A-Z0-9]{10}$/u.test(keyId) || !/^[A-Z0-9]{10}$/u.test(teamId) || !privateKey.includes("PRIVATE KEY")) return null;
  return { keyId, teamId, privateKey, bundleId };
}

export const isDeviceToken = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64,200}$/u.test(value);

const base64url = (bytes: Uint8Array | string) => {
  const binary = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
};

/** The signed token Apple asks for (ES256). Good for up to an hour. */
export async function apnsToken(config: ApnsConfig, nowSeconds: number) {
  const der = Uint8Array.from(atob(config.privateKey.replace(/-----[A-Z ]+-----/gu, "").replace(/\s+/gu, "")), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const unsigned = `${base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }))}.${base64url(JSON.stringify({ iss: config.teamId, iat: nowSeconds }))}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

// Apple wants the token reused, not minted per request.
let cached: { token: string; at: number; keyId: string } | null = null;
const TOKEN_REUSE_SECONDS = 40 * 60;

/** Text cut to a number of UTF-8 bytes, on a character boundary. */
export function cutToBytes(text: string, maxBytes: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let out = "";
  let used = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (used + size > maxBytes - 3) break;
    out += char;
    used += size;
  }
  return `${out.trimEnd()}…`;
}

export function createApnsSender(deps: { config?: () => ApnsConfig | null; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number } = {}) {
  return async function sendToDevice(device: ApnsDevice, note: ApnsNote): Promise<ApnsResult> {
    const config = (deps.config ?? getApnsConfig)();
    if (!config) return { ok: false, error: "not_configured", gone: false };
    if (!isDeviceToken(device.token)) return { ok: false, error: "bad_token", gone: true };
    const nowSeconds = Math.floor((deps.now ?? Date.now)() / 1000);
    try {
      if (!cached || cached.keyId !== config.keyId || nowSeconds - cached.at > TOKEN_REUSE_SECONDS) {
        cached = { token: await apnsToken(config, nowSeconds), at: nowSeconds, keyId: config.keyId };
      }
    } catch {
      return { ok: false, error: "bad_key", gone: false };
    }
    const host = device.environment === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
    try {
      const response = await (deps.fetcher ?? fetch)(`https://${host}/3/device/${device.token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${cached.token}`,
          "apns-topic": config.bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(nowSeconds + 6 * 60 * 60),
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
        // Apple allows 4 KB for the whole payload.
        body: JSON.stringify({ aps: { alert: { title: cutToBytes(note.title, 120), body: cutToBytes(note.body, 3_000) }, sound: "default", "thread-id": "vox" } }),
      });
      if (response.ok) {
        await response.body?.cancel();
        return { ok: true };
      }
      const reason = ((await response.json().catch(() => ({}))) as { reason?: string }).reason ?? "";
      // Apple says this install is gone (app removed, or a token from the other environment).
      const gone = response.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic";
      return { ok: false, error: `apns_${response.status}${/^[A-Za-z]{1,40}$/u.test(reason) ? `_${reason}` : ""}`, gone };
    } catch {
      return { ok: false, error: "unreachable", gone: false };
    }
  };
}
