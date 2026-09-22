import assert from "node:assert/strict";
import { classifyDesktopControlRequest, isRoutineDesktopAction, inferredDesktopControl } from "../lib/desktop-control-route.ts";
const safari = classifyDesktopControlRequest("Open Safari and search for YouTube");
assert.equal(isRoutineDesktopAction("Open Safari and search for YouTube", safari), true);
const followup = classifyDesktopControlRequest("Can you click it for me, like open YouTube page?", safari);
assert.equal(followup.appId, "safari");
assert.equal(followup.intent, "interact");
assert.equal(isRoutineDesktopAction("Can you click it for me, like open YouTube page?", followup), true);
assert.equal(classifyDesktopControlRequest("Open YouTube"), null);
assert.equal(classifyDesktopControlRequest("send an email", safari), null);
assert.equal(isRoutineDesktopAction("Open Safari and accept the agreement", safari), false);
for (const name of ["Finder", "Safari", "Chrome", "Preview", "Notes", "Calculator", "TextEdit", "Visual Studio Code"]) {
  const control = classifyDesktopControlRequest(`Open ${name}`);
  assert.ok(control, name);
  assert.equal(isRoutineDesktopAction(`Open ${name}`, control), true, name);
  assert.equal(isRoutineDesktopAction("scroll down", control), true, name);
  assert.equal(classifyDesktopControlRequest("click it", control)?.appId, control.appId);
  assert.equal(isRoutineDesktopAction("click delete", control), false, name);
  assert.equal(isRoutineDesktopAction("click Allow", control), false, name);
}
assert.equal(classifyDesktopControlRequest("That's interesting", safari), null);
assert.equal(classifyDesktopControlRequest("OK, 翻譯工作結束, 謝謝。", safari), null);
assert.equal(classifyDesktopControlRequest("提醒工作結束", safari), null);
for (const text of ["Pause the video, pause the video.", "Resume the video", "暫停影片", "繼續播放"]) {
  assert.equal(classifyDesktopControlRequest(text, safari)?.appId, "safari");
  assert.equal(isRoutineDesktopAction(text, safari), true);
  assert.equal(classifyDesktopControlRequest(text), null);
}
console.log("Desktop follow-up checks passed");
const inferred = inferredDesktopControl("YouTube please", "safari", 0.95);
assert.equal(inferred?.appId, "safari");
assert.equal(inferred?.intent, "interact");
assert.equal(isRoutineDesktopAction("YouTube please", inferred, true), true);
assert.equal(inferredDesktopControl("Open Chrome", "safari", 0.99), null);
assert.equal(inferredDesktopControl("Open it", "safari", 0.4), null);
assert.equal(inferredDesktopControl("Open it", "terminal", 0.99), null);
assert.equal(inferredDesktopControl("Open it", "safari", NaN), null);
assert.equal(inferredDesktopControl("send my password", "safari", 0.99), null);
assert.equal(inferredDesktopControl("OK, 翻譯工作結束, 謝謝。", "safari", 0.99), null);
assert.equal(inferredDesktopControl("提醒我今天晚上六點拿禮盒", "safari", 0.99), null);
for (const acknowledgement of ["OK", "Okay.", "yes", "好的", "沒問題！"]) {
  assert.equal(inferredDesktopControl(acknowledgement, "safari", 0.99), null, acknowledgement);
}
assert.equal(isRoutineDesktopAction("accept the agreement", inferred, true), false);
console.log("Inferred app routing checks passed");
for (const [name, id] of [["Apple Music", "music"], ["Podcasts", "podcasts"], ["Apple TV", "tv"], ["Photos", "photos"], ["Calendar", "calendar"], ["Reminders", "reminders"], ["Apple Maps", "maps"], ["Weather app", "weather"], ["Clock", "clock"], ["Contacts", "contacts"], ["QuickTime Player", "quicktime"], ["Mail", "mail"], ["Messages", "messages"]]) {
  assert.equal(classifyDesktopControlRequest(`Open ${name}`)?.appId, id);
  assert.equal(inferredDesktopControl(`Open ${name}`, id, 0.95)?.appId, id);
}
assert.equal(classifyDesktopControlRequest("幫我用Apple Music播放音樂好嗎?")?.appId, "music");
assert.equal(classifyDesktopControlRequest("play music in Apple Music")?.intent, "interact");
