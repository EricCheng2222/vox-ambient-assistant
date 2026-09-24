const encoder = new TextEncoder();

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
};

export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER?.trim() ?? "";
  if (!/^AC[a-f0-9]{32}$/iu.test(accountSid) || !authToken || !/^\+[1-9]\d{7,14}$/u.test(phoneNumber)) {
    return null;
  }
  return { accountSid, authToken, phoneNumber };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function signatureUrl(requestUrl: string) {
  const configuredBase = process.env.TWILIO_WEBHOOK_BASE_URL?.trim();
  if (!configuredBase) return requestUrl;
  const incoming = new URL(requestUrl);
  return new URL(`${incoming.pathname}${incoming.search}`, configuredBase).toString();
}

export async function validateTwilioRequest(
  request: Request,
  form: URLSearchParams,
) {
  const config = getTwilioConfig();
  if (!config) return false;
  const received = request.headers.get("x-twilio-signature")?.trim() ?? "";
  if (!received) return false;
  const expected = await computeTwilioSignature(
    config.authToken,
    signatureUrl(request.url),
    form,
  );
  return constantTimeEqual(expected, received);
}

export async function computeTwilioSignature(
  authToken: string,
  url: string,
  form: URLSearchParams,
) {
  // Twilio signs form keys using bytewise/Unicode-code-point ordering. Locale-aware
  // collation can produce a different payload on an edge runtime and reject a
  // legitimate webhook even when the Auth Token is correct.
  const sorted = [...form.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const payload = url + sorted.map(([key, value]) => `${key}${value}`).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToBase64(new Uint8Array(signature));
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twiml(parts: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${parts}</Response>`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

export function say(text: string) {
  return `<Say language="zh-TW">${escapeXml(text)}</Say>`;
}

export function dialSip(uri: string) {
  return `<Dial answerOnBridge="true"><Sip>${escapeXml(uri)}</Sip></Dial>`;
}

export function gatherSpeech(
  action: string,
  prompt: string,
  options: { timeoutSeconds?: number; speechTimeoutSeconds?: number | "auto" } = {},
) {
  const timeoutSeconds = Math.min(30, Math.max(3, options.timeoutSeconds ?? 12));
  const speechTimeout = options.speechTimeoutSeconds === "auto"
    ? "auto"
    : String(Math.min(10, Math.max(1, options.speechTimeoutSeconds ?? 2)));
  const promptXml = prompt.trim() ? say(prompt) : "";
  return `<Gather input="speech" action="${escapeXml(action)}" method="POST" language="zh-TW" timeout="${timeoutSeconds}" speechTimeout="${speechTimeout}" actionOnEmptyResult="true">${promptXml}</Gather>`;
}

export async function placeTwilioCall(to: string, message: string) {
  const config = getTwilioConfig();
  if (!config) throw new Error("Twilio is not configured.");
  const form = new URLSearchParams({
    To: to,
    From: config.phoneNumber,
    Twiml: `<?xml version="1.0" encoding="UTF-8"?><Response>${say(message)}<Hangup/></Response>`,
  });
  const authorization = btoa(`${config.accountSid}:${config.authToken}`);
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );
  if (!response.ok) throw new Error(`Twilio returned ${response.status}.`);
  const payload = (await response.json()) as { sid?: string; status?: string };
  return { sid: payload.sid ?? null, status: payload.status ?? "queued" };
}
