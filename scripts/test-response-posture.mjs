import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  fallbackResponsePosture,
  parseResponsePosture,
  responsePostureChoices,
  responsePostureInstruction,
} = await import("../lib/response-posture.ts");

assert.deepEqual(responsePostureChoices, [
  "flow",
  "acknowledge",
  "listen",
  "joke",
  "ask",
  "share",
  "answer",
  "advise",
  "repair",
]);
assert.equal(fallbackResponsePosture("I just finished dinner."), "acknowledge");
assert.equal(fallbackResponsePosture("我最近其實有點累。"), "listen");
assert.equal(fallbackResponsePosture("What time is it?"), "answer");
assert.equal(
  fallbackResponsePosture("你覺得我應該先做哪一個？給我一點建議。"),
  "advise",
);
assert.equal(parseResponsePosture("advise"), "advise");
assert.equal(parseResponsePosture("unexpected", "listen"), "listen");
assert.equal(fallbackResponsePosture("不是這個意思，你誤會了。"), "repair");
assert.equal(fallbackResponsePosture("哈哈真的笑死。"), "joke");
assert.match(responsePostureInstruction("flow"), /not a problem to solve/i);
assert.match(responsePostureInstruction("listen"), /do not diagnose/i);
assert.match(responsePostureInstruction("answer"), /do not expand into unsolicited/i);
assert.match(responsePostureInstruction("repair"), /do not defend/i);

const routeSource = await readFile(
  new URL("../app/api/jev-route/route.ts", import.meta.url),
  "utf8",
);
assert.match(routeSource, /conversation_move/);
assert.match(routeSource, /Advice is never the default/);

console.log("Response-posture checks passed.");
