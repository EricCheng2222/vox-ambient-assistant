import { ACCOUNT_ID } from "./accounts.ts";
import { base64UrlToBytes, bytesToBase64Url, MailError } from "./util.ts";

// Ids handed to MCP clients carry their account: "<kind>.<account id>.<the
// provider's own id, base64url>", where kind is m (message), t (thread), or
// d (draft). They are opaque to the model and checked strictly on the way in.

export type IdKind = "m" | "t" | "d";
const NAMES: Record<IdKind, string> = { m: "message id", t: "thread id", d: "draft id" };
const QUALIFIED = /^([mtd])\.([a-z0-9]{8})\.([A-Za-z0-9_-]{1,1200})$/u;

export function qualify(kind: IdKind, accountId: string, native: string) {
  return `${kind}.${accountId}.${bytesToBase64Url(new TextEncoder().encode(native))}`;
}

export function unqualify(value: unknown, kind: IdKind) {
  const match = typeof value === "string" ? QUALIFIED.exec(value.trim()) : null;
  if (!match || match[1] !== kind || !ACCOUNT_ID.test(match[2])) throw new MailError(`Give a valid ${NAMES[kind]} from an earlier result.`);
  let native: string;
  try {
    native = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(base64UrlToBytes(match[3]));
  } catch {
    throw new MailError(`Give a valid ${NAMES[kind]} from an earlier result.`);
  }
  // Only the one canonical spelling of each id.
  if (!native || bytesToBase64Url(new TextEncoder().encode(native)) !== match[3]) throw new MailError(`Give a valid ${NAMES[kind]} from an earlier result.`);
  return { accountId: match[2], native };
}
