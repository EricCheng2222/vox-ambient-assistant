import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  fallbackResponsePosture,
  parseResponsePosture,
  responsePostureChoices,
  responsePostureInstruction,
} = await import("../lib/response-posture.ts");

assert.deepEqual(responsePostureChoices, ["flow", "reflect", "answer", "advise"]);
assert.equal(fallbackResponsePosture("I just finished dinner."), "flow");
assert.equal(fallbackResponsePosture("我最近其實有點累。"), "reflect");
assert.equal(fallbackResponsePosture("What time is it?"), "answer");
assert.equal(
  fallbackResponsePosture("你覺得我應該先做哪一個？給我一點建議。"),
  "advise",
);
assert.equal(parseResponsePosture("advise"), "advise");
assert.equal(parseResponsePosture("unexpected", "reflect"), "reflect");
assert.match(responsePostureInstruction("flow"), /not a problem to solve/i);
assert.match(responsePostureInstruction("reflect"), /do not diagnose/i);
assert.match(responsePostureInstruction("answer"), /do not expand into unsolicited/i);

const routeSource = await readFile(
  new URL("../app/api/jev-route/route.ts", import.meta.url),
  "utf8",
);
assert.match(routeSource, /response_posture/);
assert.match(routeSource, /Advice is not the default/);

console.log("Response-posture checks passed.");
