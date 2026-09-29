import { requireUser } from "@/lib/auth";
import { getTwilioConfig } from "@/lib/twilio";

// Whether texts to the Vox phone number reach Vox, and a switch that points
// the number's "A message comes in" webhook at Vox. Owner only.

const noStore = { "Cache-Control": "no-store" };

type TwilioNumber = { sid: string; sms_url?: string | null; capabilities?: { sms?: boolean } };

async function twilioNumber() {
  const config = getTwilioConfig();
  if (!config) return null;
  const auth = `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`;
  const base = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}`;
  const response = await fetch(
    `${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(config.phoneNumber)}`,
    { headers: { Authorization: auth } },
  );
  if (!response.ok) throw new Error(`Twilio returned ${response.status}`);
  const payload = (await response.json()) as { incoming_phone_numbers?: TwilioNumber[] };
  const number = payload.incoming_phone_numbers?.[0];
  return number ? { number, auth, base } : null;
}

function webhookUrl(request: Request) {
  const base = process.env.TWILIO_WEBHOOK_BASE_URL?.trim() || new URL(request.url).origin;
  return new URL("/api/twilio/sms", base).toString();
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (auth.user.role !== "master") return Response.json({ error: "Only the owner can do this." }, { status: 403, headers: noStore });
  try {
    const found = await twilioNumber();
    if (!found) return Response.json({ available: false }, { headers: noStore });
    return Response.json(
      {
        available: true,
        smsCapable: found.number.capabilities?.sms !== false,
        enabled: found.number.sms_url === webhookUrl(request),
        otherWebhook: Boolean(found.number.sms_url) && found.number.sms_url !== webhookUrl(request),
      },
      { headers: noStore },
    );
  } catch (error) {
    console.error("Checking the Twilio number failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Twilio couldn't be reached." }, { status: 502, headers: noStore });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (auth.user.role !== "master") return Response.json({ error: "Only the owner can do this." }, { status: 403, headers: noStore });
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  }
  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
  const enabled = body.enabled !== false;
  try {
    const found = await twilioNumber();
    if (!found) return Response.json({ error: "Vox's phone number isn't set up." }, { status: 409, headers: noStore });
    const response = await fetch(`${found.base}/IncomingPhoneNumbers/${found.number.sid}.json`, {
      method: "POST",
      headers: { Authorization: found.auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(enabled ? { SmsUrl: webhookUrl(request), SmsMethod: "POST" } : { SmsUrl: "" }),
    });
    if (!response.ok) throw new Error(`Twilio returned ${response.status}`);
    return Response.json({ available: true, smsCapable: true, enabled, otherWebhook: false }, { headers: noStore });
  } catch (error) {
    console.error("Updating the Twilio number failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Twilio couldn't be updated." }, { status: 502, headers: noStore });
  }
}
