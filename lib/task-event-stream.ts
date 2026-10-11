import { EventEncoder } from "@ag-ui/encoder";
import { createTaskRun } from "@vox/task-events";

export type TaskJobStatus = { status: string; answer?: string; model?: string; stage?: unknown };

/** Subscribe to durable work. Closing this response only stops observation. */
export function taskEventResponse(
  taskId: string,
  read: () => Promise<TaskJobStatus>,
  signal?: AbortSignal,
  options: { intervalMs?: number; maxMs?: number } = {},
) {
  let cancelled = false;
  let closed = false;
  let close: (() => void) | undefined;
  let wake: (() => void) | undefined;
  const stop = () => { cancelled = true; wake?.(); close?.(); };
  const encoder = new EventEncoder({ accept: "text/event-stream" });
  const bytes = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) stop();
      const run = createTaskRun({ taskId, kind: "answer", emit: (event) => {
        if (!cancelled) controller.enqueue(bytes.encode(encoder.encode(event)));
      } });
      const until = Date.now() + (options.maxMs ?? 60_000);
      try {
        if (cancelled) return;
        run.start();
        run.progress("Working on your answer");
        while (!cancelled && Date.now() < until) {
          const job = await read();
          if (cancelled) break;
          if (job.status === "done" && job.answer) { run.finish(job.answer, job); break; }
          if (job.status === "delivered" || job.status === "seen") { run.finish("", job); break; }
          if (job.status === "failed" || job.status === "unknown") {
            run.fail("The answer could not be completed.", job.status === "unknown" ? "NOT_FOUND" : "TASK_FAILED");
            break;
          }
          // A heartbeat keeps intermediaries from buffering an idle stream.
          controller.enqueue(bytes.encode(": waiting\n\n"));
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { wake = undefined; resolve(); }, options.intervalMs ?? 2_500);
            wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
            if (cancelled) wake();
          });
        }
      } catch {
        // A transient read failure closes the observation stream. The client
        // falls back to the durable status endpoint; the job is not failed.
      } finally {
        signal?.removeEventListener("abort", stop);
        close();
      }
    },
    cancel() { closed = true; stop(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no",
  } });
}
