import { reminderCallScript } from "@/lib/reminder";
import {
  claimLocationReminderCall,
  markLocationReminderCallUnavailable,
  recordReminderCall,
} from "@/lib/reminder-store";
import {
  getPhoneAssistantDestination,
  PHONE_ASSISTANT_OWNER_ID,
} from "@/lib/phone-assistant-store";
import { getTwilioConfig, placeTwilioCall } from "@/lib/twilio";

// When a place reminder is set to call, the iPhone watches the place itself and
// reports the arrival or departure, possibly from the background with no web
// session. Each such reminder gets a token, bound to its id, that lets the
// phone ask for that one reminder's call and nothing else.

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signingKey() {
  const secret =
    process.env.VOX_SESSION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "vox-local-reminder-secret" : "");
  if (!secret) throw new Error("Reminder call security is not configured.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`reminder-location-call:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function locationCallToken(reminderId: string) {
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(reminderId));
  return base64Url(new Uint8Array(signature));
}

async function tokenMatches(reminderId: string, token: string) {
  const expected = await locationCallToken(reminderId);
  let difference = expected.length ^ token.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ (token.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export type LocationCallResult = "called" | "failed" | "unavailable" | "not_callable" | "forbidden";

export async function callForLocationReminder(reminderId: string, token: string): Promise<LocationCallResult> {
  if (!(await tokenMatches(reminderId, token))) return "forbidden";
  const reminder = await claimLocationReminderCall(reminderId);
  if (!reminder) return "not_callable";
  // Phone calls are an owner-only capability, dialled only to the owner's own
  // callback number while calls from Vox are on.
  const destination =
    reminder.ownerId === PHONE_ASSISTANT_OWNER_ID && getTwilioConfig()
      ? await getPhoneAssistantDestination(reminder.ownerId)
      : null;
  if (!destination) {
    await markLocationReminderCallUnavailable(reminder.id);
    return "unavailable";
  }
  const script = reminderCallScript(reminder);
  try {
    await placeTwilioCall(destination, script.text, { language: script.language, repeat: true });
    await recordReminderCall(reminder.id, true);
    return "called";
  } catch (error) {
    console.error("Place reminder call failed", error);
    await recordReminderCall(reminder.id, false);
    return "failed";
  }
}
