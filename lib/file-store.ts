import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { agentFiles } from "@/db/schema";
import type { AgentFile } from "@/lib/agent-file";

function getBucket() {
  if (!env.BUCKET) {
    throw new Error(
      "Cloudflare R2 binding `BUCKET` is unavailable. Configure the Worker R2 binding before using files.",
    );
  }
  return env.BUCKET;
}

export async function listAgentFiles(limit = 40): Promise<AgentFile[]> {
  return getDb()
    .select()
    .from(agentFiles)
    .orderBy(desc(agentFiles.createdAt))
    .limit(limit) as Promise<AgentFile[]>;
}

export async function getAgentFile(id: string): Promise<AgentFile | null> {
  const [file] = await getDb()
    .select()
    .from(agentFiles)
    .where(eq(agentFiles.id, id))
    .limit(1);
  return (file ?? null) as AgentFile | null;
}

export async function saveAgentFile(input: {
  name: string;
  title: string;
  purpose: string;
  mimeType: string;
  content: string;
}) {
  const id = crypto.randomUUID();
  const objectKey = `agent-files/${id}/${input.name}`;
  const bytes = new TextEncoder().encode(input.content);
  await getBucket().put(objectKey, bytes, {
    httpMetadata: { contentType: `${input.mimeType}; charset=utf-8` },
  });

  try {
    const [file] = await getDb()
      .insert(agentFiles)
      .values({
        id,
        name: input.name,
        title: input.title,
        purpose: input.purpose,
        mimeType: input.mimeType,
        size: bytes.byteLength,
        objectKey,
        createdAt: new Date().toISOString(),
      })
      .returning();
    return file as AgentFile;
  } catch (error) {
    await getBucket().delete(objectKey).catch(() => undefined);
    throw error;
  }
}

export async function readAgentFile(file: AgentFile) {
  return getBucket().get(file.objectKey);
}

export async function deleteAgentFile(file: AgentFile) {
  await getBucket().delete(file.objectKey);
  const [deleted] = await getDb()
    .delete(agentFiles)
    .where(eq(agentFiles.id, file.id))
    .returning({ id: agentFiles.id });
  return deleted?.id ?? null;
}
