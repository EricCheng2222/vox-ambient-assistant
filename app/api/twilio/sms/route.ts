import { appendIncomingText } from "@/lib/conversation-store";
import { twiml, validateTwilioRequest } from "@/lib/twilio";

// Twilio calls this when someone texts the Vox phone number. The text goes into
// the owner's conversation stream as an incoming text. Vox never replies on
// its own; texts come from anyone, so they are only ever shown and read out.

/** The Vox account that owns the phone number. */
const PHONE_OWNER_ID = "owner";
const MAX_BODY = 1600;

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  if (!(await validateTwilioRequest(request, form))) {
    return new Response("Forbidden", { status: 403 });
  }

  const messageSid = form.get("MessageSid")?.trim() ?? "";
  if (!/^(SM|MM)[a-f0-9]{32}$/iu.test(messageSid)) return new Response("Invalid message", { status: 400 });
  const from = (form.get("From") ?? "").trim().slice(0, 40) || "Unknown sender";
  const media = Number(form.get("NumMedia") ?? "0");
  const body = [
    (form.get("Body") ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim().slice(0, MAX_BODY),
    Number.isSafeInteger(media) && media > 0 ? `[${media === 1 ? "1 photo or file" : `${media} photos or files`} attached]` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await appendIncomingText(PHONE_OWNER_ID, { id: `sms-${messageSid.toLowerCase()}`, from, body: body || "(empty message)" });
  } catch (error) {
    console.error("Saving a text message failed", error);
    // A 5xx makes Twilio retry; the id keeps the retry from adding a duplicate.
    return new Response("Try again", { status: 503 });
  }
  // No reply is sent.
  return twiml("");
}
