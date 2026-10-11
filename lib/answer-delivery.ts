// What the server's timer does with answers whose app stopped waiting: finish
// them and leave them in the conversation, once each. The pieces it uses are
// passed in, so this can be tested without a database or a model.

export type AbandonedJob = { id: string; ownerId: string; responseId: string; createdAt: string };

export type DeliveryDeps = {
  jobs(now: number): Promise<AbandonedJob[]>;
  /** The background answer as it stands: still working, failed, or done with its text. */
  check(responseId: string): Promise<{ state: "working" | "done" | "failed"; answer: string }>;
  /** Takes the job for one outcome; false when someone else (the app) already took it. */
  settle(id: string, status: "delivered" | "failed"): Promise<boolean>;
  /** Puts the answer in the conversation under the job's own id; false when the app had already put it there. */
  append(ownerId: string, messageId: string, text: string): Promise<boolean>;
  notify(ownerId: string, text: string): Promise<void>;
  forget(responseId: string): Promise<void>;
  giveUpAfterMs: number;
};

/**
 * The conversation message a job's result becomes. It is the id the app made
 * up for the job, so whoever writes the result (the app that showed it, the
 * server's timer, the user's Mac) writes the same message, and it exists once.
 */
export function jobMessageId(job: { id: string; ownerId: string }) {
  return job.id.startsWith(`${job.ownerId}:`) ? job.id.slice(job.ownerId.length + 1) : job.id;
}

export async function deliverAbandonedAnswers(deps: DeliveryDeps, now: number) {
  let delivered = 0;
  let failed = 0;
  for (const job of await deps.jobs(now)) {
    const { state, answer } = await deps.check(job.responseId).catch(() => ({ state: "working" as const, answer: "" }));
    if (state === "working") {
      // Not ready: left for the next minute, unless it has been far too long.
      if (now - Date.parse(job.createdAt) > deps.giveUpAfterMs && (await deps.settle(job.id, "failed"))) failed += 1;
      continue;
    }
    if (state === "failed" || !answer.trim()) {
      if (await deps.settle(job.id, "failed")) failed += 1;
      continue;
    }
    // Only one of the app and this timer takes the answer.
    if (!(await deps.settle(job.id, "delivered"))) continue;
    // A notice only when this is news: if the app had already shown it, it has nothing to add.
    const wasNew = await deps.append(job.ownerId, jobMessageId(job), answer);
    if (wasNew) await deps.notify(job.ownerId, answer).catch(() => undefined);
    await deps.forget(job.responseId).catch(() => undefined);
    delivered += 1;
  }
  return { delivered, failed };
}
