const bridge = window.voxDesktop;

// The bar above Vox shows whether the Mac is busy with a task Vox sent to its
// workspace. The work itself is asked for in conversation; Vox reports back.
const state = document.querySelector("#connection-state");

function show(label, mode = "") {
  state.classList.toggle("is-busy", mode === "busy");
  state.classList.toggle("is-error", mode === "error");
  state.textContent = label;
  state.prepend(document.createElement("i"));
}

bridge.onCodexEvent((event) => {
  if (event.type === "thread" || event.type === "progress") show("Working", "busy");
  else if (event.type === "completed" || event.type === "cancelled") show("Ready");
  else if (event.type === "failed") show("Ready", "error");
});

try {
  const status = await bridge.getCodexStatus();
  show(status.running ? "Working" : "Ready", status.running ? "busy" : "");
} catch {
  show("Ready");
}
