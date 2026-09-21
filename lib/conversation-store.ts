import { asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { conversationMessages, conversationThreads } from "@/db/schema";
import type { ConversationMessage } from "@/lib/conversation";

const MAX_STORED_MESSAGES = 500;

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

async function conversationKey() {
  const secret =
    process.env.VOX_CONVERSATION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production"
      ? "vox-local-conversation-secret"
      : "");
  if (!secret) throw new Error("Vox conversation security is not configured.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptText(text: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await conversationKey(),
    new TextEncoder().encode(text),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptText(ciphertext: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    await conversationKey(),
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function ensureThread(ownerId: string) {
  const db = getDb();
  await db
    .insert(conversationThreads)
    .values({ ownerId })
    .onConflictDoNothing({ target: conversationThreads.ownerId });
  const [thread] = await db
    .select({ generation: conversationThreads.generation })
    .from(conversationThreads)
    .where(eq(conversationThreads.ownerId, ownerId))
    .limit(1);
  if (!thread) throw new Error("Conversation state is unavailable.");
  return thread.generation;
}

export async function getConversation(ownerId: string) {
  const generation = await ensureThread(ownerId);
  const records = await getDb()
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      ciphertext: conversationMessages.ciphertext,
      iv: conversationMessages.iv,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.ownerId, ownerId))
    .orderBy(asc(conversationMessages.sequence));

  const messages = await Promise.all(
    records.map(async (record) => ({
      id: record.id,
      role: record.role as ConversationMessage["role"],
      text: await decryptText(record.ciphertext, record.iv),
    })),
  );
  return { generation, messages };
}

export async function appendConversationMessage(
  ownerId: string,
  generation: number,
  message: ConversationMessage,
) {
  await ensureThread(ownerId);
  const encrypted = await encryptText(message.text);
  const result = await getDb().run(sql`
    INSERT INTO conversation_messages (id, owner_id, role, ciphertext, iv)
    SELECT ${message.id}, ${ownerId}, ${message.role}, ${encrypted.ciphertext}, ${encrypted.iv}
    WHERE EXISTS (
      SELECT 1 FROM conversation_threads
      WHERE owner_id = ${ownerId} AND generation = ${generation}
    )
    ON CONFLICT(id) DO NOTHING
  `);
  if (Number(result.meta.changes ?? 0) === 0) {
    const [existing] = await getDb()
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.id, message.id))
      .limit(1);
    if (!existing) return false;
  }

  await getDb().run(sql`
    DELETE FROM conversation_messages
    WHERE owner_id = ${ownerId}
      AND sequence NOT IN (
        SELECT sequence FROM conversation_messages
        WHERE owner_id = ${ownerId}
        ORDER BY sequence DESC
        LIMIT ${MAX_STORED_MESSAGES}
      )
  `);
  return true;
}

export async function clearConversation(ownerId: string) {
  const db = getDb();
  await ensureThread(ownerId);
  await db
    .update(conversationThreads)
    .set({
      generation: sql`${conversationThreads.generation} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(conversationThreads.ownerId, ownerId));
  await db
    .delete(conversationMessages)
    .where(eq(conversationMessages.ownerId, ownerId));
  return ensureThread(ownerId);
}
