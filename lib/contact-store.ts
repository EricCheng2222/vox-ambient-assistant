import { eq } from "drizzle-orm";

import { getDb } from "../db/index.ts";
import { userContacts } from "../db/schema.ts";

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function isValidEmail(value: string) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function contactKey() {
  const secret =
    process.env.VOX_CONTACT_SECRET?.trim() ||
    process.env.VOX_SESSION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "vox-local-contact-secret" : "");
  if (!secret) throw new Error("Vox contact security is not configured.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function emailHash(email: string) {
  const secret =
    process.env.VOX_SESSION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "vox-local-development-secret" : "");
  if (!secret) throw new Error("Vox session security is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`email:${normalizeEmail(email)}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function encryptEmail(email: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await contactKey(),
    new TextEncoder().encode(normalizeEmail(email)),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

export async function bindUserEmail(userId: string, email: string) {
  const hash = await emailHash(email);
  const [existing] = await getDb()
    .select({ emailHash: userContacts.emailHash })
    .from(userContacts)
    .where(eq(userContacts.userId, userId))
    .limit(1);

  if (existing) return existing.emailHash === hash ? "matched" : "mismatch";

  const encrypted = await encryptEmail(email);
  try {
    await getDb().insert(userContacts).values({
      userId,
      emailHash: hash,
      emailCiphertext: encrypted.ciphertext,
      emailIv: encrypted.iv,
      updatedAt: new Date().toISOString(),
    });
    return "created";
  } catch {
    return "mismatch";
  }
}

export async function readUserEmail(userId: string) {
  const [record] = await getDb()
    .select({
      emailCiphertext: userContacts.emailCiphertext,
      emailIv: userContacts.emailIv,
    })
    .from(userContacts)
    .where(eq(userContacts.userId, userId))
    .limit(1);
  if (!record) return null;

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(record.emailIv) },
    await contactKey(),
    base64UrlToBytes(record.emailCiphertext),
  );
  return new TextDecoder().decode(plaintext);
}
