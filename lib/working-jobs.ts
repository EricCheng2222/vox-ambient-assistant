// Work that is still going after the app was put away (an answer being worked
// out on the server, a task running on the Mac). Only its label and start
// time are remembered, on this device, so that on return the app can say what
// is still running and collect the result.

export type WorkingJob = { id: string; label: string; kind: "answer" | "mac"; startedAt: number };

const KEY = "vox:working-jobs";
/** Nothing runs longer than this; an older entry is a leftover. */
export const WORKING_JOB_MAX_MS = 20 * 60_000;

export function cleanWorkingJobs(value: unknown, now: number): WorkingJob[] {
  const jobs: WorkingJob[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (typeof item.id !== "string" || !/^[0-9a-f-]{36}$/u.test(item.id)) continue;
    if (typeof item.startedAt !== "number" || now - item.startedAt > WORKING_JOB_MAX_MS || item.startedAt > now + 60_000) continue;
    const label = typeof item.label === "string" ? item.label.replace(/\s+/gu, " ").trim().slice(0, 90) : "";
    jobs.push({ id: item.id, label, kind: item.kind === "mac" ? "mac" : "answer", startedAt: item.startedAt });
  }
  return jobs.slice(-6);
}

export function loadWorkingJobs(now = Date.now()): WorkingJob[] {
  try {
    return cleanWorkingJobs(JSON.parse(window.localStorage.getItem(KEY) ?? "[]"), now);
  } catch {
    return [];
  }
}

export function saveWorkingJobs(jobs: WorkingJob[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(jobs.slice(-6)));
  } catch {
    // Not remembered across a restart; it still shows while the app is open.
  }
}

/** "12s", "1m 05s". */
export function elapsedLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
