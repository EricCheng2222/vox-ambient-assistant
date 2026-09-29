import assert from "node:assert/strict";

const { STAGE_TOOL, stageFromToolArguments } = await import("../lib/stage-tool.ts");

assert.equal(STAGE_TOOL.name, "show_on_stage");
const stage = stageFromToolArguments(JSON.stringify({
  title: "KMU exam dates",
  url: "https://www.kmu.edu.tw/admissions",
  blocks: [
    { kind: "facts", title: "Key dates", facts: [{ label: "Written exam", value: "March 7" }, { label: "", value: "dropped" }] },
    { kind: "table", title: "Compare", columns: ["A", "B"], rows: [["1", "2"], []] },
    { kind: "steps", items: ["Register", "Pay", " "] },
    { kind: "list", items: ["ignored: over three blocks"] },
  ],
}), 42);
assert.equal(stage.title, "KMU exam dates");
assert.deepEqual(stage.sources, [{ url: "https://www.kmu.edu.tw/admissions", title: "kmu.edu.tw", site: "kmu.edu.tw" }]);
assert.equal(stage.blocks.length, 3);
assert.deepEqual(stage.blocks[0], { kind: "facts", title: "Key dates", rows: [{ label: "Written exam", value: "March 7" }] });
assert.deepEqual(stage.blocks[1].rows, [["1", "2"]]);
assert.deepEqual(stage.blocks[2].items, ["Register", "Pay"]);
assert.equal(stage.createdAt, 42);

// Unsafe or empty input shows nothing.
assert.equal(stageFromToolArguments("not json"), null);
assert.equal(stageFromToolArguments(JSON.stringify({ title: "x", blocks: [] })), null);
assert.equal(stageFromToolArguments(JSON.stringify({ title: "", blocks: [{ kind: "list", items: ["a"] }] })), null);
const unsafe = stageFromToolArguments(JSON.stringify({ title: "x", url: "javascript:alert(1)", blocks: [{ kind: "list", items: ["a"] }] }));
assert.deepEqual(unsafe.sources, []);
assert.deepEqual(stageFromToolArguments(JSON.stringify({ title: "x", url: "http://example.com", blocks: [{ kind: "list", items: ["a"] }] })).sources, []);
assert.deepEqual(stageFromToolArguments(JSON.stringify({ title: "x", url: "https://u:p@example.com", blocks: [{ kind: "list", items: ["a"] }] })).sources, []);
assert.equal(stageFromToolArguments(JSON.stringify({ title: "x", blocks: [{ kind: "html", text: "<b>" }] })), null);

console.log("Stage tool checks passed.");
