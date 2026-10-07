import { dispatchDueReminderCalls } from "@/lib/reminder-calls";
import { rollDueRepeatingReminders } from "@/lib/reminder-store";

// Reached only in-process from the Worker's cron handler (cloudflare/worker-entry.mjs),
// which mints this token inside the running isolate. It is never sent over the
// network, so outside requests cannot trigger reminder calls.
function schedulerAuthorized(request: Request) {
  const expected = (globalThis as { __voxSchedulerToken?: unknown }).__voxSchedulerToken;
  const received = request.headers.get("x-vox-scheduler") ?? "";
  if (typeof expected !== "string" || expected.length < 32) return false;
  let difference = expected.length ^ received.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ (received.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function POST(request: Request) {
  if (!schedulerAuthorized(request)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  let calls: Awaited<ReturnType<typeof dispatchDueReminderCalls>> | null = null;
  try {
    calls = await dispatchDueReminderCalls();
  } catch (error) {
    console.error("Reminder call dispatch failed", error);
  }
  // After the calls, so a repeating reminder is phoned for this occurrence
  // before it moves on to the next. Runs even when calling failed, so the
  // series never depends on the telephone side.
  let rolled: number | null = null;
  try {
    rolled = await rollDueRepeatingReminders();
  } catch (error) {
    console.error("Repeating reminder roll-forward failed", error);
  }
  if (!calls || rolled === null) {
    return Response.json({ error: "Reminder calls are unavailable." }, { status: 503 });
  }
  return Response.json({ ...calls, rolled }, { headers: { "Cache-Control": "no-store" } });
}
