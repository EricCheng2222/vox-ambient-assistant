import assert from "node:assert/strict";

import {
  classifyDesktopControlRequest,
  containsBlockedDesktopAction,
  isDesktopControlRequest,
} from "../lib/desktop-control-route.ts";

assert.deepEqual(classifyDesktopControlRequest("Open Calculator"), {
  appId: "calculator",
  appName: "Calculator",
  intent: "launch",
});
assert.deepEqual(classifyDesktopControlRequest("Click the sidebar in Finder"), {
  appId: "finder",
  appName: "Finder",
  intent: "interact",
});
assert.deepEqual(classifyDesktopControlRequest("幫我開啟備忘錄"), {
  appId: "notes",
  appName: "Notes",
  intent: "launch",
});
assert.deepEqual(classifyDesktopControlRequest("在 Safari 捲動一下"), {
  appId: "safari",
  appName: "Safari",
  intent: "interact",
});
assert.deepEqual(classifyDesktopControlRequest("Create a new tab in Safari"), {
  appId: "safari",
  appName: "Safari",
  intent: "interact",
});
assert.deepEqual(
  classifyDesktopControlRequest(
    "Open Safari, create a new tab, and search for YouTube using Computer Use",
  ),
  {
    appId: "safari",
    appName: "Safari",
    intent: "interact",
  },
);

for (const value of [
  "Delete this file in Finder",
  "Send this email in Safari",
  "在 Chrome 登入我的帳號",
  "在備忘錄刪除這一頁",
  "Use Terminal to run this command",
]) {
  assert.equal(containsBlockedDesktopAction(value), true, value);
  assert.equal(classifyDesktopControlRequest(value), null, value);
}

for (const value of [
  "What is Finder?",
  "Open Spotify",
  "Click that button",
  "Can you explain how Chrome works?",
]) {
  assert.equal(isDesktopControlRequest(value), false, value);
}

console.log("Desktop control routing checks passed.");
