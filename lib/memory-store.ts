import { desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { memories } from "@/db/schema";
import type { MemoryCategory, MemoryRecord } from "@/lib/memory";

export async function listMemories(limit = 40): Promise<MemoryRecord[]> {
  const db = getDb();
  return db
    .select()
    .from(memories)
    .orderBy(desc(memories.updatedAt), desc(memories.createdAt))
    .limit(limit) as Promise<MemoryRecord[]>;
}

export async function createMemory(input: {
  category: MemoryCategory;
  content: string;
  source?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const [memory] = await db
    .insert(memories)
    .values({
      id: crypto.randomUUID(),
      category: input.category,
      content: input.content,
      source: input.source ?? "conversation",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return memory as MemoryRecord;
}

export async function updateMemory(id: string, content: string) {
  const db = getDb();
  const [memory] = await db
    .update(memories)
    .set({
      content,
      updatedAt: new Date().toISOString(),
      revision: sql`${memories.revision} + 1`,
    })
    .where(eq(memories.id, id))
    .returning();
  return (memory ?? null) as MemoryRecord | null;
}

export async function deleteMemory(id: string) {
  const db = getDb();
  const [memory] = await db
    .delete(memories)
    .where(eq(memories.id, id))
    .returning({ id: memories.id });
  return memory?.id ?? null;
}
