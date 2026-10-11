import { ANSWER_GIVE_UP_MS, answerText, backgroundState, fetchBackground, forgetBackground, getAnswerJob, isJobId, markAnswerJobSeen, settleAnswerJob, touchAnswerJob } from "@/lib/answer-jobs";
import { requireUser } from "@/lib/auth";

// The app asking after an answer it started and lost touch with (it was put
// in the background, or the connection dropped). If the answer is ready it is
// handed over here; if the server already left it in the conversation, the
// app is told so and shows nothing twice.

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const jobId = new URL(request.url).searchParams.get("id");
  if (!isJobId(jobId)) return Response.json({ error: "Which answer?" }, { status: 400, headers: noStore });
  const job = await getAnswerJob(auth.user.id, jobId);
  if (!job) return Response.json({ status: "unknown" }, { status: 404, headers: noStore });
  if (job.status !== "running") return Response.json({ status: job.status }, { headers: noStore });
  // A task on the user's Mac: it reports for itself.
  if (!job.responseId.startsWith("resp_")) return Response.json({ status: "running" }, { headers: noStore });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ status: "failed" }, { headers: noStore });
  const nowIso = new Date().toISOString();
  await touchAnswerJob(job.id, nowIso);
  const payload = await fetchBackground(apiKey, job.responseId);
  const state = payload ? backgroundState(payload) : "working";
  if (state === "working") {
    if (Date.now() - Date.parse(job.createdAt) > ANSWER_GIVE_UP_MS) {
      await settleAnswerJob(job.id, "failed", nowIso);
      return Response.json({ status: "failed" }, { headers: noStore });
    }
    return Response.json({ status: "running" }, { headers: noStore });
  }
  if (state === "failed" || !payload) {
    await settleAnswerJob(job.id, "failed", nowIso);
    return Response.json({ status: "failed" }, { headers: noStore });
  }
  // Handed over, not yet confirmed: the app confirms with POST once it has shown it.
  return Response.json({ status: "done", answer: answerText(payload) }, { headers: noStore });
}

/** The app confirming it received and showed an answer. From here the server's timer leaves the job alone. */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (!isJobId(body.id)) return Response.json({ error: "Which answer?" }, { status: 400, headers: noStore });
  const job = await getAnswerJob(auth.user.id, body.id);
  if (!job) return Response.json({ status: "unknown" }, { status: 404, headers: noStore });
  const nowIso = new Date().toISOString();
  // False when the result was already left in the conversation (by the server's timer, or the Mac).
  const mine = job.status === "seen" || (job.status === "running" && (await settleAnswerJob(job.id, "seen", nowIso)));
  // Either way the device has it on screen now, so no notice is owed.
  if (!mine && job.status !== "failed") await markAnswerJobSeen(job.id, nowIso);
  const apiKey = process.env.OPENAI_API_KEY;
  if (mine && apiKey && job.responseId.startsWith("resp_")) await forgetBackground(apiKey, job.responseId);
  return Response.json({ status: mine ? "seen" : job.status === "running" ? "delivered" : job.status }, { headers: noStore });
}
