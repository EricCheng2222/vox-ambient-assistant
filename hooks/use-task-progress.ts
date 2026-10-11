"use client";

import { useCallback, useRef, useState } from "react";
import { readTaskEvent, reduceTaskEvent, type TaskState } from "@vox/task-events";

/** Progress is a disposable display projection. Durable delivery and speech
 * stay with their existing owners; these events cannot execute any action.
 */
export function useTaskProgress() {
  const known = useRef(new Set<string>());
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const register = useCallback((id: string) => { known.current.add(id); }, []);
  const forget = useCallback((id: string) => {
    known.current.delete(id);
    setTasks((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);
  const accept = useCallback((value: unknown, expectedId?: string) => {
    const event = readTaskEvent(value, expectedId);
    if (!event || !known.current.has(event.metadata.vox.taskId)) return;
    const id = event.metadata.vox.taskId;
    setTasks((current) => {
      if (!known.current.has(id)) return current;
      const next = reduceTaskEvent(current[id], event, id);
      return next && next !== current[id] ? { ...current, [id]: next } : current;
    });
  }, []);
  return { tasks, register, forget, accept };
}
