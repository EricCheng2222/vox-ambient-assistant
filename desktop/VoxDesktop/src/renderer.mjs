const bridge = window.voxDesktop;

const elements = {
  panel: document.querySelector("#codex-panel"),
  toggle: document.querySelector("#toggle-codex"),
  close: document.querySelector("#close-codex"),
  state: document.querySelector("#connection-state"),
  form: document.querySelector("#codex-form"),
  workspace: document.querySelector("#workspace"),
  choose: document.querySelector("#choose-folder"),
  access: document.querySelector("#access"),
  prompt: document.querySelector("#prompt"),
  run: document.querySelector("#run-codex"),
  cancel: document.querySelector("#cancel-codex"),
  error: document.querySelector("#error"),
  activityCard: document.querySelector("#activity-card"),
  activityLabel: document.querySelector("#activity-label"),
  activity: document.querySelector("#activity"),
  outputCard: document.querySelector("#output-card"),
  output: document.querySelector("#output"),
};

let workspace = "";
let activeTaskId = null;
let running = false;
const activityLines = [];

function setPanel(open) {
  elements.panel.classList.toggle("is-open", open);
  elements.panel.setAttribute("aria-hidden", String(!open));
  elements.toggle.setAttribute("aria-expanded", String(open));
  void bridge.setCodexPanelOpen(open);
  if (open) elements.prompt.focus();
}

function setError(message = "") {
  elements.error.textContent = message;
  elements.error.hidden = !message;
  elements.state.classList.toggle("is-error", Boolean(message));
}

function refreshControls() {
  elements.workspace.textContent = workspace || "No local folder selected";
  elements.run.disabled = running || !workspace || !elements.prompt.value.trim();
  elements.choose.disabled = running;
  elements.access.disabled = running;
  elements.prompt.disabled = running;
  elements.cancel.hidden = !running;
  elements.run.hidden = running;
  elements.state.classList.toggle("is-busy", running);
  elements.state.textContent = running ? "Local Codex working" : "Local Codex ready";
  const dot = document.createElement("i");
  elements.state.prepend(dot);
}

function resetResults() {
  activityLines.length = 0;
  elements.activity.textContent = "";
  elements.activityCard.hidden = true;
  elements.output.textContent = "";
  elements.outputCard.hidden = true;
}

function addActivity(text) {
  if (!text) return;
  activityLines.push(text);
  if (activityLines.length > 12) activityLines.shift();
  elements.activity.textContent = activityLines.join("\n\n");
  elements.activityCard.hidden = false;
  elements.activity.scrollTop = elements.activity.scrollHeight;
}

function finishTask() {
  running = false;
  activeTaskId = null;
  refreshControls();
}

function formatProgress(item) {
  if (item.kind === "message") {
    elements.output.textContent = item.text || "";
    elements.outputCard.hidden = !item.text;
    return;
  }
  if (item.text) return item.text;
  if (item.command) return `$ ${item.command}${item.output ? `\n${item.output}` : ""}`;
  if (item.changes) return item.changes.map((change) => `${change.kind}: ${change.path}`).join("\n");
  return item.output || "";
}

elements.toggle.addEventListener("click", () => setPanel(!elements.panel.classList.contains("is-open")));
elements.close.addEventListener("click", () => setPanel(false));
elements.prompt.addEventListener("input", refreshControls);
elements.choose.addEventListener("click", async () => {
  setError();
  try {
    const result = await bridge.chooseCodexWorkspace();
    if (!result.canceled && result.workspace) workspace = result.workspace;
    refreshControls();
  } catch (error) {
    setError(error instanceof Error ? error.message : "That folder could not be selected.");
  }
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (running) return;
  setError();
  resetResults();
  try {
    const result = await bridge.runCodex({
      workspace,
      prompt: elements.prompt.value.trim(),
      access: elements.access.value,
    });
    if (!result.canceled && result.taskId) {
      activeTaskId = result.taskId;
      running = true;
      addActivity("Local Codex is starting…");
      refreshControls();
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : "Local Codex could not start.");
  }
});

elements.cancel.addEventListener("click", async () => {
  if (activeTaskId) await bridge.cancelCodex(activeTaskId);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.panel.classList.contains("is-open")) setPanel(false);
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    setPanel(!elements.panel.classList.contains("is-open"));
  }
});

bridge.onCodexEvent((event) => {
  if (event.type === "thread" || event.type === "progress") {
    activeTaskId = event.taskId;
    running = true;
    refreshControls();
  }
  if (event.type === "progress" && event.item) addActivity(formatProgress(event.item));
  if (event.type === "completed") {
    if (event.finalResponse) {
      elements.output.textContent = event.finalResponse;
      elements.outputCard.hidden = false;
    }
    addActivity("Task completed.");
    finishTask();
  } else if (event.type === "cancelled") {
    addActivity(event.message || "Task cancelled.");
    finishTask();
  } else if (event.type === "failed") {
    setError(event.message || "Local Codex task failed.");
    finishTask();
  }
});

bridge.onCodexPanelOpen((open) => setPanel(open));

try {
  const status = await bridge.getCodexStatus();
  workspace = status.workspace || "";
  running = status.running;
  activeTaskId = status.taskId;
} catch (error) {
  setError(error instanceof Error ? error.message : "Local Codex could not connect.");
}

refreshControls();
