import assert from "node:assert/strict";

import { isLocalCodexTask } from "../lib/local-codex-route.ts";

for (const value of [
  "Ask Codex to inspect this repository",
  "Use the local agent to fix the failing tests",
  "Fix the bug in this app",
  "Please refactor this component",
  "交給 Codex 幫我修復這個錯誤",
  "幫我修改這個專案的程式碼",
]) {
  assert.equal(isLocalCodexTask(value), true, value);
}

for (const value of [
  "What is Codex?",
  "Explain what a React component is",
  "I saw a bug in a movie yesterday",
  "Can you give me general programming advice?",
  "寫一首關於程式設計的詩",
  "Codex sounds interesting",
]) {
  assert.equal(isLocalCodexTask(value), false, value);
}

console.log("Local Codex routing checks passed.");
