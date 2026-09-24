import assert from "node:assert/strict";
import {
  isSmartHomeControlRequest,
  isSmartHomeFollowUpRequest,
  isSmartHomeRetryRequest,
  matchSmartHomeControlRequest,
  smartHomeFailureMessage,
} from "../lib/smart-home-route.ts";

for (const request of [
  "Turn the Dyson purifier on",
  "Set the air purifier speed to 5",
  "幫我把戴森清淨機關掉",
  "戴森現在的空氣品質如何？",
  "幫我把風速調成三好嗎？",
  "Set the fan speed to 3",
]) {
  assert.equal(isSmartHomeControlRequest(request), true, request);
  assert.equal(matchSmartHomeControlRequest(request)?.adapter, "dyson-local");
}

for (const request of ["再試一次。", "OK, 再試一次", "Please try it again"]) {
  assert.equal(isSmartHomeRetryRequest(request), true, request);
}

for (const request of ["再說一次", "Try the music again"]) {
  assert.equal(isSmartHomeRetryRequest(request), false, request);
}

for (const request of [
  "那空氣品質如何啊？",
  "風速呢？",
  "再打開",
  "What about the air quality?",
]) {
  assert.equal(isSmartHomeFollowUpRequest(request), true, request);
}

for (const request of [
  "那外面的溫度呢？",
  "把音樂關掉",
  "What about the weather outside?",
]) {
  assert.equal(isSmartHomeFollowUpRequest(request), false, request);
}

for (const request of [
  "Is the air quality good today?",
  "Tell me about Dyson",
  "Turn the music off",
  "今天外面的風速如何？",
]) {
  assert.equal(isSmartHomeControlRequest(request), false, request);
}

assert.equal(
  smartHomeFailureMessage(
    "Error invoking remote method 'vox-smart-home:command': Error: Vox could not connect to the Dyson purifier on this Wi-Fi network.",
    "taiwan_mandarin",
  ),
  "目前連不上 Dyson。請確認它已開機並連上同一個 Wi-Fi；如果剛設定完成，可以重新開機後再試一次。",
);
assert.equal(
  smartHomeFailureMessage(
    "Error invoking remote method 'vox-smart-home:command': Error: The purifier rejected its local device credential.",
    "english",
  ),
  "Dyson did not accept the saved local credential. Please reconnect the device.",
);
assert.equal(
  smartHomeFailureMessage(
    "Remote control is paused on this Mac. Open Vox Desktop and allow it until Vox quits.",
    "taiwan_mandarin",
  ),
  "Mac 上的遠端控制目前暫停中。請在 Vox Desktop 的「Phone control」選擇允許直到 Vox 結束，再試一次。",
);
assert.match(
  smartHomeFailureMessage("The Mac did not answer before the command expired.", "english"),
  /can’t reach the paired Mac/u,
);
assert.match(
  smartHomeFailureMessage("The paired Mac is offline or not ready.", "taiwan_mandarin"),
  /連不上配對的 Mac/u,
);
assert.match(
  smartHomeFailureMessage("Choose a configured smart-home device on the Mac first.", "english"),
  /no smart-home device/u,
);

console.log("Smart-home route checks passed.");
