import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { memories } from "@/db/schema";
import type { MemoryCategory, MemoryRecord } from "@/lib/memory";

const publicMemory = {
  id: memories.id,
  category: memories.category,
  content: memories.content,
  source: memories.source,
  revision: memories.revision,
  createdAt: memories.createdAt,
  updatedAt: memories.updatedAt,
};

export async function listMemories(
  ownerId: string,
  limit = 40,
): Promise<MemoryRecord[]> {
  return getDb()
    .select(publicMemory)
    .from(memories)
    .where(eq(memories.ownerId, ownerId))
    .orderBy(desc(memories.updatedAt), desc(memories.createdAt))
    .limit(limit) as Promise<MemoryRecord[]>;
}

export async function createMemory(
  ownerId: string,
  input: {
    category: MemoryCategory;
    content: string;
    source?: string;
  },
) {
  const now = new Date().toISOString();
  const [memory] = await getDb()
    .insert(memories)
    .values({
      id: crypto.randomUUID(),
      ownerId,
      category: input.category,
      content: input.content,
      source: input.source ?? "conversation",
      createdAt: now,
      updatedAt: now,
    })
    .returning(publicMemory);
  return memory as MemoryRecord;
}

export async function updateMemory(ownerId: string, id: string, content: string) {
  const [memory] = await getDb()
    .update(memories)
    .set({
      content,
      updatedAt: new Date().toISOString(),
      revision: sql`${memories.revision} + 1`,
    })
    .where(and(eq(memories.ownerId, ownerId), eq(memories.id, id)))
    .returning(publicMemory);
  return (memory ?? null) as MemoryRecord | null;
}

export async function deleteMemory(ownerId: string, id: string) {
  const [memory] = await getDb()
    .delete(memories)
    .where(and(eq(memories.ownerId, ownerId), eq(memories.id, id)))
    .returning({ id: memories.id });
  return memory?.id ?? null;
}
