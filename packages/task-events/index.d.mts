import type { BaseEvent } from "@ag-ui/core";
export type TaskKind = "answer" | "codex" | "browser";
export type TaskEvent = BaseEvent & {
  metadata: { vox: { taskId: string; kind: TaskKind; sourceId: string; sequence: number } };
};
export type TaskState = {
  id: string;
  kind: TaskKind;
  status: "running" | "completed" | "failed" | "cancelled" | "needs_input" | "delivered";
  phase: string;
  answer: string;
  startedAt: number;
  sources: Record<string, number>;
  error?: string;
  result?: Record<string, unknown>;
};
export function taskThreadId(taskId: string): string;
export function createTaskRun(options: { taskId: string; kind: TaskKind; emit: (event: TaskEvent) => void; now?: () => number }): {
  start(): void;
  progress(label: string): void;
  finish(answer?: string, result?: Record<string, unknown>): void;
  fail(message: string, code?: string): void;
};
export function readTaskEvent(value: unknown, expectedTaskId?: string): TaskEvent | null;
export function reduceTaskEvent(previous: TaskState | undefined, value: unknown, expectedTaskId?: string): TaskState | undefined;
