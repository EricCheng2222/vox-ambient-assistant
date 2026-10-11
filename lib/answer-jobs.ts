import { and, eq, inArray, like, lt } from "drizzle-orm";

import { getDb } from "@/db";
import { answerJobs } from "@/db/schema";

// Answers that outlive the request that asked for them. The model works in
// the provider's background mode; whoever is there when it finishes gets the
// answer: the app if it is still waiting, otherwise the conversation, where it
// is found on return. See db/schema.ts (answer_jobs).

const OPENAI = "https://api.openai.com/v1/responses";
/** The app has stopped waiting when it has not touched the job for this long. */
export const ANSWER_ABANDONED_MS = 20_000;
/** An answer not finished by now is given up on. */
export const ANSWER_GIVE_UP_MS = 15 * 60_000;

export const isJobId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);

type Output = { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
export type BackgroundPayload = Output & { id?: string; status?: string; error?: unknown };

export function answerText(payload: Output) {
  const raw =
    payload.output_text ??
    (payload.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text ?? "")
      .join("\n");
  // Preserve citations for the conversation; speechText removes them only for speech.
  return raw.trim();
}

/** Whether the background answer has stopped, one way or another. */
export function backgroundState(payload: BackgroundPayload | null): "working" | "done" | "failed" {
  const status = payload?.status;
  if (status === "completed") return "done";
  if (status === "queued" || status === "in_progress") return "working";
  // Cut off at its length limit: what it wrote is still an answer.
  if (status === "incomplete" && payload && answerText(payload)) return "done";
  return "failed";
}

export async function fetchBackground(apiKey: string, responseId: string): Promise<BackgroundPayload | null> {
  const response = await fetch(`${OPENAI}/${encodeURIComponent(responseId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) {
    await response?.body?.cancel();
    return null;
  }
  return (await response.json().catch(() => null)) as BackgroundPayload | null;
}

/** The provider keeps a background answer until told otherwise; once collected, it is removed. */
export async function forgetBackground(apiKey: string, responseId: string) {
  const response = await fetch(`${OPENAI}/${encodeURIComponent(responseId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8_000) }).catch(() => null);
  await response?.body?.cancel();
}

const key = (ownerId: string, jobId: string) => `${ownerId}:${jobId}`;

export async function startAnswerJob(ownerId: string, jobId: string, responseId: string, nowIso: string) {
  await getDb().insert(answerJobs).values({ id: key(ownerId, jobId), ownerId, responseId, status: "running", createdAt: nowIso, updatedAt: nowIso }).onConflictDoNothing();
}

export async function getAnswerJob(ownerId: string, jobId: string) {
  const [job] = await getDb().select().from(answerJobs).where(and(eq(answerJobs.id, key(ownerId, jobId)), eq(answerJobs.ownerId, ownerId))).limit(1);
  return job ?? null;
}

/** The app is still waiting. */
export async function touchAnswerJob(id: string, nowIso: string) {
  await getDb().update(answerJobs).set({ updatedAt: nowIso }).where(and(eq(answerJobs.id, id), eq(answerJobs.status, "running")));
}

/**
 * Takes a running job for one outcome. Only one caller wins, so an answer is
 * handed to the app or left in the conversation, never both.
 */
export async function settleAnswerJob(id: string, status: "seen" | "delivered" | "failed", nowIso: string) {
  const rows = await getDb()
    .update(answerJobs)
    .set({ status, updatedAt: nowIso })
    .where(and(eq(answerJobs.id, id), eq(answerJobs.status, "running")))
    .returning({ id: answerJobs.id });
  return rows.length > 0;
}

/** The device that asked has the result on screen: no notice is needed. From "running" or "delivered". */
export async function markAnswerJobSeen(id: string, nowIso: string) {
  await getDb().update(answerJobs).set({ status: "seen", updatedAt: nowIso }).where(and(eq(answerJobs.id, id), inArray(answerJobs.status, ["running", "delivered"])));
}

/** Running jobs nobody is waiting on any more. */
export async function abandonedAnswerJobs(now: number) {
  return getDb()
    .select()
    .from(answerJobs)
    // Only answers being worked out by the model; a task on the user's Mac reports for itself.
    .where(and(eq(answerJobs.status, "running"), like(answerJobs.responseId, "resp_%"), lt(answerJobs.updatedAt, new Date(now - ANSWER_ABANDONED_MS).toISOString())))
    .limit(10);
}

export async function pruneAnswerJobs(now: number) {
  await getDb().delete(answerJobs).where(lt(answerJobs.createdAt, new Date(now - 2 * 24 * 60 * 60_000).toISOString()));
}
