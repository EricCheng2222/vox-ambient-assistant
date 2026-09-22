import assert from "node:assert/strict";

import {
  classifyVoiceConfirmation,
  isOpenWorkspaceRequest,
  isStandaloneVoiceConfirmation,
} from "../lib/desktop-action-route.ts";

for (const value of [
  "Can you open the folder for me?",
  "Show me the project folder",
  "Open the Codex folder I chose",
  "幫我打開專案資料夾",
  "可以顯示我選好的資料夾嗎？",
]) {
  assert.equal(isOpenWorkspaceRequest(value), true, value);
}

for (const value of [
  "Open the website",
  "What is a workspace?",
  "Create a folder",
  "Can you explain Finder?",
]) {
  assert.equal(isOpenWorkspaceRequest(value), false, value);
}

for (const value of ["yes", "Okay, go ahead", "open it", "好，打開吧"]) {
  assert.equal(classifyVoiceConfirmation(value), "confirm", value);
}

for (const value of ["no", "don't open it", "never mind", "不用了", "取消"]) {
  assert.equal(classifyVoiceConfirmation(value), "cancel", value);
}

for (const value of ["which folder?", "I was talking about something else", "嗯"]) {
  assert.equal(classifyVoiceConfirmation(value), "unknown", value);
}

for (const value of ["OK", "Okay.", "yes", "好的", "沒問題！"]) {
  assert.equal(isStandaloneVoiceConfirmation(value), true, value);
}
for (const value of ["OK, 幫我關掉它", "OK, 翻譯工作結束，謝謝", "yes, pause it", "好的，提醒我六點去拿禮盒"]) {
  assert.equal(isStandaloneVoiceConfirmation(value), false, value);
}

console.log("Desktop action routing checks passed.");
