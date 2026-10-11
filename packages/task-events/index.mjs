import { EventType, PROTOCOL_VERSION } from "@ag-ui/core";

const kinds = new Set(["answer", "codex", "browser"]);
const terminal = new Set(["completed", "failed", "cancelled", "needs_input", "delivered"]);
const text = (value, max = 160) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, " ").trim().slice(0, max) : "";
export const taskThreadId = (taskId) => `vox-task:${taskId}`;

/** A task has its own thread. Its lifecycle never blocks the voice conversation.
 * Only public progress and results belong here, never prompts, page contents,
 * credentials, raw provider events, commands, or local file paths.
 */
export function createTaskRun({ taskId, kind, emit, now = Date.now }) {
  if (!taskId || !kinds.has(kind)) throw new Error("Invalid task identity.");
  const sourceId = crypto.randomUUID();
  let sequence = 0;
  let started = false;
  let ended = false;
  let stepName = "";
  let stepNumber = 0;
  const send = (type, fields = {}) => {
    const event = {
      type, timestamp: now(), ...fields,
      metadata: { vox: { taskId, kind, sourceId, sequence: ++sequence } },
    };
    // A display/transport failure cannot fail or cancel the work itself.
    try { emit(event); } catch { /* The durable result path still owns delivery. */ }
    return event;
  };
  const start = () => {
    if (started || ended) return;
    started = true;
    send(EventType.RUN_STARTED, { threadId: taskThreadId(taskId), runId: taskId, protocolVersion: PROTOCOL_VERSION });
  };
  const closeStep = () => {
    if (stepName) send(EventType.STEP_FINISHED, { stepName });
    stepName = "";
  };
  return {
    start,
    progress(label) {
      if (ended) return;
      start();
      closeStep();
      stepName = `${++stepNumber}. ${text(label) || "Working"}`;
      send(EventType.STEP_STARTED, { stepName });
    },
    finish(answer = "", result = {}) {
      if (ended) return;
      start();
      closeStep();
      const content = text(answer, 24_000);
      if (content) {
        const messageId = `${taskId}:result`;
        send(EventType.TEXT_MESSAGE_START, { messageId, role: "assistant" });
        send(EventType.TEXT_MESSAGE_CONTENT, { messageId, delta: content });
        send(EventType.TEXT_MESSAGE_END, { messageId });
      }
      ended = true;
      // A browser attempt can end needing the user. It is not a resumable
      // protocol interrupt: existing Vox policy decides how a follow-up runs.
      send(EventType.RUN_FINISHED, { threadId: taskThreadId(taskId), runId: taskId, result });
    },
    fail(message, code = "TASK_FAILED") {
      if (ended) return;
      start();
      closeStep();
      ended = true;
      send(EventType.RUN_ERROR, { message: text(message, 500) || "The task could not finish.", code });
    },
  };
}

/** Strictly the event subset this adapter displays. Events never execute tools. */
export function readTaskEvent(value, expectedTaskId) {
  if (!value || typeof value !== "object") return null;
  const meta = value.metadata?.vox;
  if (!meta || typeof meta.taskId !== "string" || !meta.taskId || meta.taskId.length > 200 || !kinds.has(meta.kind) ||
      typeof meta.sourceId !== "string" || !meta.sourceId || meta.sourceId.length > 200 || !Number.isSafeInteger(meta.sequence) || meta.sequence < 1 ||
      (value.timestamp !== undefined && (typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp))) ||
      (expectedTaskId && meta.taskId !== expectedTaskId)) return null;
  switch (value.type) {
    case EventType.RUN_STARTED:
    case EventType.RUN_FINISHED:
      if (value.threadId !== taskThreadId(meta.taskId) || value.runId !== meta.taskId) return null;
      break;
    case EventType.STEP_STARTED:
    case EventType.STEP_FINISHED:
      if (typeof value.stepName !== "string" || value.stepName.length > 200) return null;
      break;
    case EventType.TEXT_MESSAGE_START:
      if (value.role !== "assistant") return null;
      // falls through
    case EventType.TEXT_MESSAGE_END:
      if (value.messageId !== `${meta.taskId}:result`) return null;
      break;
    case EventType.TEXT_MESSAGE_CONTENT:
      if (value.messageId !== `${meta.taskId}:result` || typeof value.delta !== "string" || !value.delta || value.delta.length > 24_000) return null;
      break;
    case EventType.RUN_ERROR:
      if (typeof value.message !== "string" || value.message.length > 500) return null;
      break;
    default: return null;
  }
  return value;
}

/** Idempotent display projection shared by IPC, SSE, and polling recovery. */
export function reduceTaskEvent(previous, value, expectedTaskId) {
  const event = readTaskEvent(value, expectedTaskId);
  if (!event) return previous;
  const meta = event.metadata.vox;
  if (previous && previous.id !== meta.taskId) return previous;
  if (previous && previous.kind !== meta.kind) return previous;
  if (previous && terminal.has(previous.status)) return previous;
  const sequence = previous?.sources?.[meta.sourceId] ?? 0;
  if (!sequence && Object.keys(previous?.sources ?? {}).length >= 64) return previous;
  if (meta.sequence <= sequence) return previous;
  const state = {
    id: meta.taskId, kind: meta.kind, status: "running", phase: "", answer: "",
    startedAt: event.timestamp ?? Date.now(), ...previous,
    sources: { ...previous?.sources, [meta.sourceId]: meta.sequence },
  };
  switch (event.type) {
    case EventType.STEP_STARTED: state.phase = event.stepName.replace(/^\d+\. /u, ""); break;
    case EventType.TEXT_MESSAGE_START: state.answer = ""; break;
    case EventType.TEXT_MESSAGE_CONTENT: state.answer = (state.answer + event.delta).slice(0, 24_000); break;
    case EventType.RUN_FINISHED: {
      state.result = event.result;
      const status = event.result?.status;
      state.status = ["need_user", "need_sign_in", "need_approval"].includes(status) ? "needs_input"
        : ["delivered", "seen"].includes(status) ? "delivered"
        : status === "cancelled" ? "cancelled" : status === "stopped" ? "failed" : "completed";
      state.phase = "";
      break;
    }
    case EventType.RUN_ERROR:
      state.status = event.code === "CANCELLED" ? "cancelled" : "failed";
      state.error = event.message;
      state.phase = "";
      break;
  }
  return state;
}
