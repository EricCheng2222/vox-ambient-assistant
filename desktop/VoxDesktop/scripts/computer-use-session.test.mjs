import test from "node:test";
import assert from "node:assert/strict";
import { computerUseFailure, permitsConfirmedApp, computerUseModelSettings } from "../src/computer-use-session.mjs";
import {
  currentDesktopActionText,
  hasRunningDesktopApp,
  isClosingDesktopApp,
} from "../src/desktop-control-policy.mjs";

test("only supported task tiers choose models; missing or invalid tiers retain Terra", () => {
  assert.deepEqual(computerUseModelSettings("fast"), {model: "gpt-5.6-luna", effort: "low"});
  for (const mode of [undefined, "standard", "gpt-6-astra", {}, "FAST"]) {
    assert.deepEqual(computerUseModelSettings(mode), {model: "gpt-5.6-terra", effort: "medium"});
  }
});

test("recognizes native screen capture denial without blaming Safari approval", () => {
  const message = computerUseFailure({ result: { content: [{ type: "text", text: "The user declined TCCs for application, window, display capture" }] } });
  assert.match(message, /macOS blocked screen capture/);
  assert.match(message, /task was not completed/);
});

test("ordinary tool results do not imply permission denial", () => {
  assert.equal(computerUseFailure({ result: { content: [{ text: "Safari is open" }] } }), null);
  assert.equal(computerUseFailure({ error: "Native pipe closed" }), null);
});

test("spoken confirmation is scoped to the selected app and current task", () => {
  const request = { threadId: "task", serverName: "cua_repl", mode: "form", _meta: { connector_id: "computer-use", tool_name: "get_app_state", tool_params: { app: "com.apple.Safari" } }, requestedSchema: { type: "object", properties: {} } };
  assert.equal(permitsConfirmedApp(request, "com.apple.Safari", "task"), true);
  assert.equal(permitsConfirmedApp(request, "com.apple.finder", "task"), false);
  assert.equal(permitsConfirmedApp(request, "com.apple.Safari", "other"), false);
  for (const tool of ["click", "press_key", "type_text", "scroll"]) {
    const action = { ...request, _meta: { ...request._meta, tool_name: tool } };
    assert.equal(permitsConfirmedApp(action, "com.apple.Safari", "task"), true);
    assert.equal(permitsConfirmedApp(action, "com.apple.finder", "task"), false);
  }
  assert.equal(permitsConfirmedApp({ ...request, _meta: { ...request._meta, tool_name: "run_shell" } }, "com.apple.Safari", "task"), false);
});

test("macOS running-app probes do not mistake an empty result for a running app", () => {
  assert.equal(hasRunningDesktopApp('ASN:0x0-0xce2ce2-"LINE":'), true);
  assert.equal(hasRunningDesktopApp(""), false);
  assert.equal(hasRunningDesktopApp("()"), false);
  assert.equal(hasRunningDesktopApp(undefined), false);
});

test("only the current request can turn a contextual desktop prompt into a close action", () => {
  const prompt = 'Recent task context: {"request":"close LINE"}\nInspect the current app before acting.\n\nCurrent user request: OK, 翻譯工作結束, 謝謝。';
  const current = currentDesktopActionText(prompt);
  assert.equal(current, "OK, 翻譯工作結束, 謝謝。");
  assert.equal(isClosingDesktopApp(current), false);
  assert.equal(isClosingDesktopApp(currentDesktopActionText("Current user request: 幫我關掉 LINE")), true);
});
