import { createTaskRun } from "@vox/task-events";

const labels = {
  agent_message: "Preparing the answer",
  reasoning: "Working through the task",
  command_execution: "Running a workspace command",
  file_change: "Updating workspace files",
  mcp_tool_call: "Using a task tool",
  web_search: "Searching the web",
  todo_list: "Updating the task plan",
};

/** Project provider activity into public progress, without provider payloads. */
export function createCodexTaskRun(options) {
  const run = createTaskRun({ ...options, kind: "codex" });
  return {
    ...run,
    accept(event) {
      if (event?.type === "item.started" || event?.type === "item.completed" || event?.type === "item.updated") {
        const label = labels[event.item?.type];
        if (label) run.progress(label);
      }
    },
  };
}
