import assert from "node:assert/strict";
import {
  isSmartHomeControlRequest,
  matchSmartHomeControlRequest,
} from "../lib/smart-home-route.ts";

for (const request of [
  "Turn the Dyson purifier on",
  "Set the air purifier speed to 5",
  "幫我把戴森清淨機關掉",
  "戴森現在的空氣品質如何？",
]) {
  assert.equal(isSmartHomeControlRequest(request), true, request);
  assert.equal(matchSmartHomeControlRequest(request)?.adapter, "dyson-local");
}

for (const request of [
  "Is the air quality good today?",
  "Tell me about Dyson",
  "Turn the music off",
]) {
  assert.equal(isSmartHomeControlRequest(request), false, request);
}

console.log("Smart-home route checks passed.");
