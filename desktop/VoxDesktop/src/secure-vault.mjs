import fs from "node:fs";
import path from "node:path";

// Details the user chose to remember on this Mac (a site's sign-in, their
// card), so the private box can fill them in again with one press. The file
// is encrypted with a key held in the macOS Keychain (Electron safeStorage).
// Saved values are only ever written into a web page's own fields: they are
// never sent to Vox's window, its servers, or the voice model.

/** A sign-in belongs to one site; a card or phone number is the same everywhere. */
export const SITE_KINDS = ["email", "username", "password"];
export const ANYWHERE_KINDS = ["card_number", "card_expiry", "name", "phone"];
// Never kept: one-time codes and a card's security code.

/** What a page field asks for. The same rules as lib/secure-fill.ts. */
export function fieldKind(about) {
  const text = String(about ?? "").toLowerCase();
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

/** The site a page belongs to, for https pages only. */
export function vaultHost(url) {
  try {
    const parsed = new URL(String(url ?? ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    return parsed.hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return "";
  }
}

const cleanHost = (value) => (typeof value === "string" && /^[a-z0-9-]+(\.[a-z0-9-]+){1,5}$/u.test(value) && value.length <= 120 ? value : "");
const MAX_SITES = 200;

export function createVault({ file, safeStorage }) {
  const available = () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };

  function read() {
    const empty = { sites: {}, anywhere: {} };
    if (!available()) return empty;
    try {
      const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      return {
        sites: data && typeof data.sites === "object" && data.sites ? data.sites : {},
        anywhere: data && typeof data.anywhere === "object" && data.anywhere ? data.anywhere : {},
      };
    } catch {
      return empty;
    }
  }

  function write(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  return {
    available,
    /** The saved value for a field on a site, or "". */
    get(host, kind) {
      if (!cleanHost(host)) return "";
      const data = read();
      const value = SITE_KINDS.includes(kind) ? data.sites[host]?.[kind] : ANYWHERE_KINDS.includes(kind) ? data.anywhere[kind] : "";
      return typeof value === "string" ? value : "";
    },
    /** Keeps one value. Returns whether it was kept. */
    remember(host, kind, value) {
      if (!available() || !cleanHost(host) || typeof value !== "string" || !value || value.length > 200) return false;
      const data = read();
      if (SITE_KINDS.includes(kind)) {
        if (!data.sites[host] && Object.keys(data.sites).length >= MAX_SITES) return false;
        data.sites[host] = { ...data.sites[host], [kind]: value };
      } else if (ANYWHERE_KINDS.includes(kind)) {
        data.anywhere[kind] = value;
      } else {
        return false;
      }
      write(data);
      return true;
    },
    /** What is saved, by name only: never the values. */
    list() {
      const data = read();
      return {
        available: available(),
        sites: Object.keys(data.sites)
          .filter(cleanHost)
          .sort()
          .map((host) => ({ host, kinds: SITE_KINDS.filter((kind) => typeof data.sites[host]?.[kind] === "string") })),
        anywhere: ANYWHERE_KINDS.filter((kind) => typeof data.anywhere[kind] === "string"),
      };
    },
    /** Forgets one site's sign-in, or ("anywhere") the card and personal details. */
    forget(target) {
      const data = read();
      if (target === "anywhere") data.anywhere = {};
      else if (cleanHost(target)) delete data.sites[target];
      else return false;
      if (available()) write(data);
      return true;
    },
  };
}
