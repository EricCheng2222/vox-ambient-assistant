// A verification code a website just emailed the user, carried from their
// inbox into that same website's code field. The app does this itself: the
// live model never sees the code, and a code is only ever given to the site
// that sent it (the sender's domain must be the page's own), so a page cannot
// talk Vox into fetching some other service's code.

export const EMAIL_CODE_MAX_AGE_MS = 15 * 60_000;

export const EMAIL_CODE_TOOL = {
  type: "function",
  name: "fill_code_from_email",
  description:
    "The web page on the stage is asking for a verification code that the site just emailed to the user. This finds that email in the user's connected inbox (only one sent by this same site, in the last 15 minutes) and writes the code into the page's code field. You are never shown the code. Give the code field's number from the latest browser_look. Use this instead of reading the user's email for a code yourself.",
  parameters: {
    type: "object",
    properties: { ref: { type: "number", description: "The code field's number from the latest browser_look." } },
    required: ["ref"],
  },
} as const;

const TWO_PART_SUFFIXES = new Set([
  "com.tw", "org.tw", "net.tw", "edu.tw", "gov.tw", "idv.tw", "co.jp", "ne.jp", "or.jp", "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au",
  "com.hk", "com.cn", "com.sg", "co.kr", "co.nz", "com.br", "com.mx", "co.in", "com.my", "co.th", "com.ph", "com.vn", "co.id",
]);

/** The part of a host that names the organisation: "mail.starlux-airlines.com" → "starlux-airlines.com". */
export function registrableDomain(host: string) {
  const labels = host.trim().toLowerCase().replace(/\.$/u, "").split(".").filter(Boolean);
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9-]+$/u.test(label))) return "";
  const lastTwo = labels.slice(-2).join(".");
  return TWO_PART_SUFFIXES.has(lastTwo) ? (labels.length >= 3 ? labels.slice(-3).join(".") : "") : lastTwo;
}

/** The domain an email claims to be from: `STARLUX <no-reply@mail.starlux-airlines.com>` → "mail.starlux-airlines.com". */
export function senderDomain(from: string) {
  const address = /<([^<>\s]+@[^<>\s]+)>/u.exec(from)?.[1] ?? /([^\s<>"]+@[^\s<>"]+)/u.exec(from)?.[1] ?? "";
  return address.includes("@") ? address.slice(address.lastIndexOf("@") + 1).toLowerCase().replace(/[^a-z0-9.-]/gu, "") : "";
}

/** Whether an email's sender belongs to the site the page is on. */
export function sentBySite(from: string, pageHost: string) {
  const site = registrableDomain(pageHost);
  return Boolean(site) && registrableDomain(senderDomain(from)) === site;
}

export type MailSummary = { id: string; from: string; date: string; subject: string; snippet: string };

/** The mail search tool's text, as messages (see mail-site/src/mcp.ts, summaryLines). */
export function parseMailSearch(text: string): MailSummary[] {
  const messages: MailSummary[] = [];
  for (const block of text.split(/\n(?=\d+\. id=)/u)) {
    const id = /^\d+\. id=(\S+)/u.exec(block.trim())?.[1];
    if (!id) continue;
    const line = (name: string) => new RegExp(`^\\s*${name}: (.*)$`, "mu").exec(block)?.[1]?.trim() ?? "";
    messages.push({ id, from: line("From").split(" | To: ")[0].trim(), date: line("Date"), subject: line("Subject"), snippet: line("Snippet") });
  }
  return messages;
}

const CODE_WORDS = /驗證碼|认证码|確認碼|验证码|認證碼|安全碼|動態密碼|一次性密碼|verification code|security code|confirmation code|one[- ]time (?:pass)?code|passcode|otp|\bcode\b|\bpin\b/iu;
const CODE = /(?<![\d.,/:-])(\d(?:[ -]?\d){3,7})(?![\d.,/:-]?\d)/gu;

/**
 * The verification code in an email's text: a run of 4 to 8 digits close
 * after a word like "code" or 驗證碼. Returns "" when there is none, or when
 * there are several candidates and nothing says which is the code.
 */
export function extractCode(text: string) {
  const plain = text.replace(/\s+/gu, " ");
  const digits = (value: string) => value.replace(/[ -]/gu, "");
  const word = CODE_WORDS.exec(plain);
  if (word) {
    // The number that follows the word, within a sentence's reach; else the one just before it.
    const after = plain.slice(word.index, word.index + word[0].length + 90);
    for (const match of after.matchAll(CODE)) return digits(match[1]);
    const before = [...plain.slice(Math.max(0, word.index - 40), word.index).matchAll(CODE)].at(-1);
    if (before) return digits(before[1]);
  }
  const all = [...new Set([...plain.matchAll(CODE)].map((match) => digits(match[1])).filter((value) => value.length === 6))];
  return all.length === 1 ? all[0] : "";
}

/** Among recent search results, the newest email this site sent within the time limit. Oldest-first input is fine. */
export function recentFromSite(messages: MailSummary[], pageHost: string, now: number, maxAgeMs = EMAIL_CODE_MAX_AGE_MS) {
  return messages
    .map((message) => ({ message, at: Date.parse(message.date) }))
    .filter(({ message, at }) => Number.isFinite(at) && now - at <= maxAgeMs && at - now <= 2 * 60_000 && sentBySite(message.from, pageHost))
    .sort((a, b) => b.at - a.at)
    .map(({ message }) => message);
}

/** What the model is told. Never the code. */
export function emailCodeOutcome(result: "filled" | "no_email" | "no_code" | "not_connected" | "not_a_field" | "failed", host: string) {
  switch (result) {
    case "filled":
      return `The code ${host} emailed the user was found and written into the page's code field. You were not shown it. Press the page's continue or verify button and carry on.`;
    case "no_email":
      return `No email from ${host} has arrived in the user's connected inboxes in the last 15 minutes. It may still be on its way: tell the user, wait a moment, and try once more; or call ask_user_to_fill so they can type the code.`;
    case "no_code":
      return `An email from ${host} arrived but no verification code could be read from it. Call ask_user_to_fill so the user can type the code.`;
    case "not_connected":
      return "The user's email isn't connected, so the code can't be fetched. Call ask_user_to_fill so they can type it.";
    case "not_a_field":
      return "No code was filled: look at the page with browser_look first and give the number of the code's text field.";
    default:
      return `The code couldn't be written into the page on ${host}. Look at the page again; if the field is still there, call ask_user_to_fill.`;
  }
}
