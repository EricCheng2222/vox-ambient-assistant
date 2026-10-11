import { getAnswerJob, isJobId, settleAnswerJob, startAnswerJob } from "@/lib/answer-jobs";
import { requireUser } from "@/lib/auth";
import { appendAssistantNote } from "@/lib/conversation-store";
import { leaveOwnerNotice } from "@/lib/push-store";

// A website task the user's own Mac is carrying out for a phone or tablet.
//   start:   the Mac has picked the task up.
//   deliver: it has finished; the result is written into the conversation at
//            once, under the task's own id, so it is there whether or not the
//            device that asked is still around (and exists once, even if that
//            device also shows it).
//   notify:  a little later; if that device never confirmed having it on
//            screen, the user gets a notice.

const noStore = { "Cache-Control": "no-store" };
const MAC_TASK = "mac-task";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; action?: unknown; text?: unknown };
  if (!isJobId(body.id)) return Response.json({ error: "Which task?" }, { status: 400, headers: noStore });
  const nowIso = new Date().toISOString();
  if (body.action === "start") {
    await startAnswerJob(auth.user.id, body.id, MAC_TASK, nowIso);
    return Response.json({ started: true }, { headers: noStore });
  }
  const text = typeof body.text === "string" ? body.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, " ").trim().slice(0, 12_000) : "";
  const job = await getAnswerJob(auth.user.id, body.id);
  if (!job || job.responseId !== MAC_TASK) return Response.json({ delivered: false, notified: false }, { headers: noStore });
  if (body.action === "fail") {
    const failed = await settleAnswerJob(job.id, "failed", nowIso);
    return Response.json({ failed }, { headers: noStore });
  }
  if (!text) return Response.json({ delivered: false, notified: false }, { headers: noStore });
  if (body.action === "deliver") {
    const wasNew = await appendAssistantNote(auth.user.id, { id: body.id, text });
    // From here the result is in the conversation; "seen" (set by the device) is left alone.
    await settleAnswerJob(job.id, "delivered", nowIso);
    return Response.json({ delivered: true, wasNew }, { headers: noStore });
  }
  if (body.action === "notify") {
    // "seen" means the device that asked has it on screen.
    if (job.status !== "delivered") return Response.json({ notified: false }, { headers: noStore });
    await leaveOwnerNotice(auth.user.id, { title: "Done on your Mac", body: text.slice(0, 400) }, false).catch(() => 0);
    return Response.json({ notified: true }, { headers: noStore });
  }
  return Response.json({ error: "Unknown action." }, { status: 400, headers: noStore });
}
