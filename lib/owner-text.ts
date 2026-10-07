import { getTwilioConfig, type TwilioConfig } from "./twilio.ts";

// Texting the owner from the Vox phone number. The only recipient there can
// be is the account's own callback number, looked up here by account id from
// where it is kept encrypted (lib/phone-assistant-store.ts). No caller passes
// a number in, and the number is never logged or returned.

export type OwnerTextResult = { ok: true } | { ok: false; error: string };

export type OwnerTextDeps = {
  /** The account's own stored number, or null when it may not be texted. */
  destinationFor(ownerId: string): Promise<string | null>;
  config?: () => TwilioConfig | null;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

const E164 = /^\+[1-9]\d{7,14}$/u;
/** Twilio's limit for one message body. */
const MAX_BODY = 1600;

/**
 * A function that texts an account's owner. It reports how the send went in
 * a short code ("not_configured", "no_number", "twilio_429", "unreachable")
 * and never throws.
 */
export function createOwnerTexter(deps: OwnerTextDeps) {
  return async function textOwner(ownerId: string, body: string): Promise<OwnerTextResult> {
    const text = body.trim();
    if (!text || text.length > MAX_BODY) return { ok: false, error: "invalid_body" };
    const config = (deps.config ?? getTwilioConfig)();
    if (!config) return { ok: false, error: "not_configured" };
    let destination: string | null;
    try {
      destination = await deps.destinationFor(ownerId);
    } catch {
      return { ok: false, error: "number_unreadable" };
    }
    // Never to the Vox number itself, and never to anything that is not a number.
    if (!destination || !E164.test(destination) || destination === config.phoneNumber) return { ok: false, error: "no_number" };
    try {
      const response = await (deps.fetcher ?? fetch)(
        `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
          body: new URLSearchParams({ To: destination, From: config.phoneNumber, Body: text }).toString(),
        },
      );
      // Twilio's error replies can repeat the number: read nothing from them.
      await response.body?.cancel();
      return response.ok ? { ok: true } : { ok: false, error: `twilio_${response.status}` };
    } catch {
      return { ok: false, error: "unreachable" };
    }
  };
}
