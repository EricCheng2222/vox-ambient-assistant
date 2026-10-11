import type { PageElement, PageLook } from "@/lib/browser-agent";

// The private box: when a site needs a password, a card, or a code, Vox puts
// a small form in the chat. The user types there, and the Mac app writes the
// values straight into the page's own fields. They never reach the voice
// model, Vox's servers, the conversation, or any storage.

export type SecureFieldKind = "email" | "username" | "password" | "code" | "card_number" | "card_expiry" | "card_code" | "name" | "phone" | "text";

export type SecureField = {
  /** The page element's number from the latest look. */
  ref: number;
  label: string;
  kind: SecureFieldKind;
};

export type SecureForm = {
  id: string;
  /** The site the values go to, shown to the user before they type. */
  host: string;
  secure: boolean;
  fields: SecureField[];
};

export const MAX_SECURE_FIELDS = 6;

export const SECURE_FILL_TOOL = {
  type: "function",
  name: "ask_user_to_fill",
  description:
    "Ask the user to type private details for the web page on the stage (a sign-in name and password, a verification code, card details, an address). A private box appears in the chat with one input per field; what they type is written straight into the page and is never shown to you. Give the numbers of the fields from the latest browser_look. Use this for every password, code, and card field; never ask the user to say such things aloud.",
  parameters: {
    type: "object",
    properties: {
      refs: { type: "array", items: { type: "number" }, description: "The fields' numbers from the latest browser_look, in page order (at most 6)." },
    },
    required: ["refs"],
  },
} as const;

/** What kind of thing a page field asks for, from its label and hints. */
export function secureFieldKind(element: Pick<PageElement, "label" | "hint">): SecureFieldKind {
  const text = `${element.hint ?? ""} ${element.label}`.toLowerCase();
  if (/password|passcode|current-password|new-password|密碼/u.test(text)) return "password";
  if (/one-time-code|otp|verification|verify|2fa|two-factor|security code(?! \(cvv)|驗證碼|簡訊碼/u.test(text) && !/cvc|cvv|csc/u.test(text)) return "code";
  if (/cc-number|card ?number|cardnumber|卡號/u.test(text)) return "card_number";
  if (/cc-exp|expir|mm ?\/ ?yy|有效期限|到期/u.test(text)) return "card_expiry";
  if (/cc-csc|cvc|cvv|csc|安全碼/u.test(text)) return "card_code";
  if (/e-?mail|電子郵件|信箱/u.test(text)) return "email";
  if (/\btel\b|phone|mobile|手機|電話/u.test(text)) return "phone";
  if (/user ?name|login|account|帳號|使用者/u.test(text)) return "username";
  if (/cc-name|name on card|full ?name|姓名|持卡人/u.test(text)) return "name";
  return "text";
}

function hostOf(url: string) {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname.replace(/^www\./u, ""), secure: parsed.protocol === "https:" };
  } catch {
    return { host: "", secure: false };
  }
}

/** Builds the box from the model's request and the page as last seen. Null when nothing asked for is a text field. */
export function secureFormFromArguments(rawArguments: string | undefined, look: PageLook | null): SecureForm | null {
  if (!look) return null;
  let refs: unknown;
  try {
    refs = (JSON.parse(rawArguments ?? "{}") as { refs?: unknown }).refs;
  } catch {
    return null;
  }
  const wanted = [...new Set((Array.isArray(refs) ? refs : []).filter((ref): ref is number => Number.isInteger(ref) && ref >= 0))].slice(0, MAX_SECURE_FIELDS);
  const fields: SecureField[] = [];
  for (const ref of wanted) {
    const element = look.elements.find((item) => item.ref === ref);
    if (!element || element.kind !== "text field") continue;
    const kind = secureFieldKind(element);
    const label = element.label.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    fields.push({ ref, kind, label: label || FALLBACK_LABELS[kind] });
  }
  const { host, secure } = hostOf(look.url);
  if (!fields.length || !host) return null;
  return { id: crypto.randomUUID(), host, secure, fields };
}

const FALLBACK_LABELS: Record<SecureFieldKind, string> = {
  email: "Email",
  username: "Username",
  password: "Password",
  code: "Verification code",
  card_number: "Card number",
  card_expiry: "Expiry date",
  card_code: "Security code",
  name: "Name",
  phone: "Phone number",
  text: "Details",
};

/** How the box's input behaves for each kind: masking, keyboard, and the system's own autofill. */
export function secureInputProps(kind: SecureFieldKind): { type: string; autoComplete: string; inputMode?: "numeric" | "email" | "tel" } {
  switch (kind) {
    case "password":
      return { type: "password", autoComplete: "current-password" };
    case "code":
      return { type: "text", autoComplete: "one-time-code", inputMode: "numeric" };
    case "card_number":
      return { type: "text", autoComplete: "cc-number", inputMode: "numeric" };
    case "card_expiry":
      return { type: "text", autoComplete: "cc-exp", inputMode: "numeric" };
    case "card_code":
      return { type: "password", autoComplete: "cc-csc", inputMode: "numeric" };
    case "email":
      return { type: "email", autoComplete: "email", inputMode: "email" };
    case "phone":
      return { type: "tel", autoComplete: "tel", inputMode: "tel" };
    case "username":
      return { type: "text", autoComplete: "username" };
    case "name":
      return { type: "text", autoComplete: "name" };
    default:
      return { type: "text", autoComplete: "off" };
  }
}

/** What the model is told. Never anything the user typed. */
export function secureFillOutcome(form: SecureForm, result: "filled" | "cancelled" | "failed", filled = 0) {
  if (result === "cancelled") return `The user closed the private box for ${form.host} without filling it in. Don't ask again unless they bring it up; ask what they'd like to do instead.`;
  if (result === "failed") return `The private details couldn't be written into the page on ${form.host} (it may have changed). Look at the page again and, if the fields are still there, ask once more.`;
  return `The user typed their details in the private box and the app wrote them into ${filled} field${filled === 1 ? "" : "s"} on ${form.host}. You were not shown what they typed and must not ask. Look at the page with browser_look and continue (for a sign-in, press the sign-in button).`;
}

export type SecureFillEntry = { ref: number; value?: string; saved?: boolean };

/** What is remembered on this Mac, by name only. */
export type SavedDetails = { available: boolean; sites: Array<{ host: string; kinds: string[] }>; anywhere: string[] };

export type VaultBridge = { list: () => Promise<SavedDetails>; forget: (target: string) => Promise<boolean> };

export function vaultBridge(): VaultBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { voxLocalCodex?: { vault?: VaultBridge } }).voxLocalCodex?.vault ?? null;
}

/**
 * What the box sends to the page: what was typed, and for fields left empty,
 * the saved value (by reference; the box never holds it).
 */
export function secureFillEntries(form: SecureForm, typed: Record<number, string>, saved: Record<number, boolean>): SecureFillEntry[] {
  const entries: SecureFillEntry[] = [];
  for (const field of form.fields) {
    const value = typed[field.ref] ?? "";
    if (value) entries.push({ ref: field.ref, value });
    else if (saved[field.ref]) entries.push({ ref: field.ref, saved: true });
  }
  return entries;
}

const SAVED_KIND_NAMES: Record<string, string> = { email: "email", username: "username", password: "password", card_number: "card number", card_expiry: "card expiry", name: "name", phone: "phone number" };

export function savedKindNames(kinds: string[]) {
  return kinds.map((kind) => SAVED_KIND_NAMES[kind]).filter(Boolean).join(", ");
}

/**
 * The sign-in fields on a page, when it is showing a sign-in: the password
 * field and the name, email, or phone field just before it. The app raises
 * the private box for these by itself, so signing in never depends on the
 * model remembering to ask. Null when the page shows no password field.
 */
export function signInRefsFromLook(look: PageLook | null): number[] | null {
  if (!look) return null;
  const fields = look.elements.filter((element) => element.kind === "text field");
  const index = fields.findIndex((element) => secureFieldKind(element) === "password");
  if (index < 0) return null;
  const refs = [fields[index].ref];
  const before = fields[index - 1];
  // The field right before the password is who is signing in, unless it is another secret or a search box.
  if (before && fields[index].ref - before.ref <= 4) {
    const kind = secureFieldKind(before);
    if (kind !== "password" && kind !== "code" && !kind.startsWith("card_") && !/search|搜尋|查詢/iu.test(`${before.label} ${before.hint ?? ""}`)) refs.unshift(before.ref);
  }
  return refs;
}
