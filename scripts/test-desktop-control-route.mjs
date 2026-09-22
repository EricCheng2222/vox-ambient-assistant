import assert from "node:assert/strict";

import {
  classifyDesktopControlRequest,
  containsBlockedDesktopAction,
  isDraftOnlyDesktopAction,
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
  "在 Chrome 登入我的帳號",
  "在備忘錄刪除這一頁",
  "Use Terminal to run this command",
]) {
  assert.equal(containsBlockedDesktopAction(value), true, value);
  assert.equal(classifyDesktopControlRequest(value), null, value);
}

assert.equal(isDraftOnlyDesktopAction("Send this email in Safari"), true);
assert.deepEqual(classifyDesktopControlRequest("Send this email in Safari"), {
  appId: "safari",
  appName: "Safari",
  intent: "interact",
});

const line = { id: "installed:jp.naver.line.mac", name: "LINE" };
for (const value of [
  "幫我在 LINE 裡打訊息，我自己發送",
  "你幫我打在 LINE 裡面好嗎?",
  "Type this message in LINE, but don't send it",
  "幫我跟這個人說，在 LINE 裡跟這個人說我也進不去",
  "Type this message in LINE and send it",
  "幫我在 LINE 裡打好然後送出",
  "幫我傳送這則 LINE 訊息",
]) {
  assert.equal(isDraftOnlyDesktopAction(value), true, value);
  assert.equal(containsBlockedDesktopAction(value), false, value);
  assert.deepEqual(classifyDesktopControlRequest(value, null, line), {
    appId: line.id,
    appName: line.name,
    intent: "interact",
  });
}

for (const value of [
  "Click Send in LINE",
  "按一下 LINE 的送出按鈕",
]) {
  assert.equal(containsBlockedDesktopAction(value), true, value);
  assert.equal(classifyDesktopControlRequest(value, null, line), null, value);
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
