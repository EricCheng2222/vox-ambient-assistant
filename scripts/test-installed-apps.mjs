import assert from "node:assert/strict";
import { matchInstalledApp } from "../desktop/VoxDesktop/src/installed-apps.mjs";
import { isClosingDesktopApp } from "../desktop/VoxDesktop/src/desktop-control-policy.mjs";
import { classifyDesktopControlRequest, isRoutineDesktopAction } from "../lib/desktop-control-route.ts";
const apps = [{ id: "installed:jp.naver.line.mac", bundleId: "jp.naver.line.mac", name: "LINE", aliases: ["LINE"] }];
const resolved = matchInstalledApp("嗯,可以幫我打開LINE這個Mac的App嗎?", apps);
assert.equal(resolved?.name, "LINE");
assert.equal(resolved?.appOnly, false);
assert.equal(matchInstalledApp("Line的app", apps)?.appOnly, true);
assert.equal(matchInstalledApp("online shopping", apps), null);
assert.equal(matchInstalledApp("open Unknown", apps), null);
assert.equal(matchInstalledApp("LINE", [...apps, { ...apps[0], bundleId: "other.line" }]), null);
const control = classifyDesktopControlRequest("幫我打開LINE這個Mac的App", null, resolved);
assert.equal(control?.intent, "launch");
assert.equal(isRoutineDesktopAction("打開LINE", control), true);
assert.equal(classifyDesktopControlRequest("傳送LINE訊息", null, resolved), null);
assert.equal(classifyDesktopControlRequest("scroll down", control)?.appId, resolved.id);
console.log("Installed app routing checks passed");
for (const text of ["呃,你可以帮我打开LINE app吗?", "幫我打開LINE", "开启LINE", "启动LINE", "切换到LINE"]) {
  const app = matchInstalledApp(text, apps);
  const action = classifyDesktopControlRequest(text, null, app);
  assert.equal(action?.intent, "launch", text);
  assert.equal(isRoutineDesktopAction(text, action), true, text);
}
const clarification = matchInstalledApp("Line", apps);
assert.equal(clarification.appOnly, true);
assert.equal(classifyDesktopControlRequest("呃,你可以帮我打开LINE app吗? Line", null, clarification)?.intent, "launch");
console.log("Simplified and Traditional Chinese launch checks passed");

for (const text of ["Close the LINE app.", "OK, close line for me.", "Quit LINE", "Exit LINE", "幫我關掉 LINE", "關閉LINE", "帮我关闭LINE", "退出LINE"]) {
  const app = matchInstalledApp(text, apps);
  const action = classifyDesktopControlRequest(text, null, app);
  assert.equal(action?.intent, "interact", text);
  assert.equal(action?.appId, resolved.id, text);
  assert.equal(isRoutineDesktopAction(text, action), true, text);
  assert.equal(isClosingDesktopApp(text), true, text);
}
assert.equal(classifyDesktopControlRequest("close it", control)?.appId, resolved.id);
assert.equal(classifyDesktopControlRequest("close it", control)?.intent, "interact");
assert.equal(classifyDesktopControlRequest("close it"), null);
assert.equal(isClosingDesktopApp("open LINE"), false);
assert.equal(classifyDesktopControlRequest("close LINE and delete files", null, resolved), null);
console.log("Close/quit app and contextual follow-up checks passed");
