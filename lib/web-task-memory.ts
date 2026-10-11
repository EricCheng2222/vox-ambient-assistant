// The last website task Vox carried out (or tried to) from this device, kept
// for a while so that "search again", "try another date", or a plain "yes"
// to Vox's own offer is understood as that task and not as something new.

export type WebTaskOutcome = "running" | "done" | "stopped" | "need_user" | "need_sign_in" | "need_approval" | "failed";

export type RecentWebTask = {
  /** What the user asked for, in their words. */
  goal: string;
  outcome: WebTaskOutcome;
  /** What came back, shortened. */
  answer?: string;
  /** When it was last touched (started, or its result arrived). */
  at: number;
};

export const WEB_TASK_STORAGE_KEY = "vox:last-web-task";
/** How long a task stays something a short reply can refer to. */
export const WEB_TASK_FOLLOW_UP_MS = 30 * 60_000;

const OUTCOMES: readonly WebTaskOutcome[] = ["running", "done", "stopped", "need_user", "need_sign_in", "need_approval", "failed"];

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "");

/** The task as it will be stored. */
export function webTaskRecord(goal: string, outcome: WebTaskOutcome, at: number, answer?: string): RecentWebTask {
  const text = clean(answer, 400);
  return { goal: clean(goal, 600), outcome, at, ...(text ? { answer: text } : {}) };
}

/** Reads a stored task back; null when there is none, it is malformed, or it is too old to refer to. */
export function recentWebTask(stored: string | null | undefined, now: number): RecentWebTask | null {
  if (!stored) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const goal = clean(record.goal, 600);
  const at = typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0;
  if (goal.length < 4 || !OUTCOMES.includes(record.outcome as WebTaskOutcome)) return null;
  if (at > now + 60_000 || now - at > WEB_TASK_FOLLOW_UP_MS) return null;
  const answer = clean(record.answer, 400);
  return { goal, outcome: record.outcome as WebTaskOutcome, at, ...(answer ? { answer } : {}) };
}

const OUTCOME_WORDS: Record<WebTaskOutcome, string> = {
  running: "it was still running",
  done: "it finished",
  stopped: "it stopped without finishing",
  need_user: "it stopped to ask the user something",
  need_sign_in: "it stopped at a sign-in page",
  need_approval: "it stopped before a step that needed the user's yes",
  failed: "it could not be carried out",
};

/** What the routing decision is told about the task. */
export function webTaskForDecision(task: RecentWebTask, now: number) {
  return { request: task.goal, outcome: OUTCOME_WORDS[task.outcome], minutes_ago: Math.max(0, Math.round((now - task.at) / 60_000)) };
}

/**
 * The goal handed to the browser when the user follows up on a task: their
 * new words first, then what they refer to. A short "search again" carries
 * nothing by itself; the earlier request is where the place and the dates are.
 */
export function followUpGoal(text: string, previous: RecentWebTask) {
  const said = clean(text, 500);
  const last = previous.answer ? ` Last time ${OUTCOME_WORDS[previous.outcome]}: “${previous.answer.slice(0, 240)}”.` : ` Last time ${OUTCOME_WORDS[previous.outcome]}.`;
  return `${said}\n\nThis follows up on an earlier request of the user's: “${previous.goal}”.${last} Carry out the earlier request again, with whatever the new words change.`.slice(0, 1_200);
}

const RETRY_WORDS =
  /\b(again|retry|re-?do|re-?run|once more|one more time|another (?:try|go)|try (?:it|that|this)? ?again|keep (?:going|trying)|continue|resume|go on|carry on)\b|再(?:試|找|查|搜|搜尋|來|做|跑)(?:一次|一遍|看看)?|再一次|重(?:試|新|來|做|找|查|搜)|繼續|接著(?:做|找|查)/iu;

/** Whether the words alone ask for a repeat. The safety net when the routing decision could not be asked. */
export function asksToRetry(text: string) {
  return RETRY_WORDS.test(text);
}
