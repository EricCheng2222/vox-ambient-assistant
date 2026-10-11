import { reduceTaskEvent, type TaskEvent, type TaskState } from "@vox/task-events";

/** Fetch-stream SSE reader, bounded and independent of the voice transport. */
export async function readTaskEventResponse(response: Response, taskId: string, emit: (event: TaskEvent) => void): Promise<TaskState | undefined> {
  if (!response.ok || !response.headers.get("Content-Type")?.includes("text/event-stream") || !response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let state: TaskState | undefined;
  const dispatch = (frame: string) => {
    const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    const raw: unknown = JSON.parse(data);
    const next = reduceTaskEvent(state, raw, taskId);
    if (next !== state) {
      state = next;
      emit(raw as TaskEvent);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Normalize CRLF only after both characters are available.
      buffer = buffer.replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        if (end > 100_000) throw new Error("Task event is too large.");
        dispatch(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
      if (buffer.length > 100_000) throw new Error("Task event is too large.");
      if (state && state.status !== "running") return state;
      if (done) return state;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
