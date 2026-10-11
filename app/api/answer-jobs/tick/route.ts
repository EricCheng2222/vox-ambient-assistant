import { deliverAbandonedAnswers } from "@/lib/answer-delivery";
import { abandonedAnswerJobs, ANSWER_GIVE_UP_MS, answerText, backgroundState, fetchBackground, forgetBackground, pruneAnswerJobs, settleAnswerJob } from "@/lib/answer-jobs";
import { appendAssistantNote } from "@/lib/conversation-store";
import { leaveOwnerNotice } from "@/lib/push-store";
import { schedulerAuthorized } from "@/lib/scheduler-auth";

// Run by the Worker's every-minute timer: answers whose app stopped waiting
// (the user left) are finished here and left in the conversation, with a
// notice for their devices. Reached only in-process; it takes no input.
export async function POST(request: Request) {
  if (!schedulerAuthorized(request)) return Response.json({ error: "Not found." }, { status: 404 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ delivered: 0, failed: 0 }, { headers: { "Cache-Control": "no-store" } });
  const now = Date.now();
  try {
    const result = await deliverAbandonedAnswers(
      {
        jobs: abandonedAnswerJobs,
        check: async (responseId) => {
          const payload = await fetchBackground(apiKey, responseId);
          const state = payload ? backgroundState(payload) : "working";
          return { state, answer: state === "done" && payload ? answerText(payload) : "" };
        },
        settle: (id, status) => settleAnswerJob(id, status, new Date().toISOString()),
        append: (ownerId, messageId, text) => appendAssistantNote(ownerId, { id: messageId, text }),
        notify: async (ownerId, text) => {
          await leaveOwnerNotice(ownerId, { title: "Your answer is ready", body: text.slice(0, 400) }, false);
        },
        forget: (responseId) => forgetBackground(apiKey, responseId),
        giveUpAfterMs: ANSWER_GIVE_UP_MS,
      },
      now,
    );
    await pruneAnswerJobs(now);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Answer jobs check failed", error instanceof Error ? error.message : "");
    return Response.json({ error: "Unavailable." }, { status: 503 });
  }
}
