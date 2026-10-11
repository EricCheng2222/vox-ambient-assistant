import assert from "node:assert/strict";

const { stageForHistory, mergeStageHistory, MAX_STAGE_HISTORY } = await import("../lib/stage-history.ts");

const plan = {
  id: "abc-123",
  title: "一週增肌訓練課表",
  createdAt: 1,
  sources: [{ url: "https://example.com/plan", title: "Plan", site: "x" }, { url: "javascript:alert(1)", title: "bad" }, { url: "https://user:pw@example.com/", title: "bad" }],
  blocks: [{ kind: "table", title: "每週安排", columns: ["日", "部位"], rows: [["週一", "胸"]] }, { kind: "nonsense" }, { kind: "map", title: "Devices", points: [{ id: "a", label: "Keys", lat: 25, lon: 121 }] }],
  extra: "dropped",
};
const kept = stageForHistory(plan);
assert.equal(kept.title, "一週增肌訓練課表");
assert.deepEqual(kept.blocks, [{ kind: "table", title: "每週安排", columns: ["日", "部位"], rows: [["週一", "胸"]] }], "unknown blocks and device maps are not stored");
assert.deepEqual(kept.sources.map((source) => source.url), ["https://example.com/plan"]);
assert.equal(kept.sources[0].site, "example.com");
assert.ok(!("extra" in kept));
// Nothing worth keeping: a device map alone, no title, no id, or something huge.
assert.equal(stageForHistory({ id: "m", title: "Where things are", sources: [], blocks: [plan.blocks[2]] }), null);
assert.equal(stageForHistory({ id: "m", title: "", sources: [], blocks: plan.blocks }), null);
assert.equal(stageForHistory({ id: "../x y", title: "T", sources: [], blocks: plan.blocks }).id, "xy");
assert.equal(stageForHistory(null), null);

// Newest first, the same title replaces the older one, and only a handful are kept.
let list = [];
for (let i = 0; i < 20; i += 1) list = mergeStageHistory(list, { ...kept, id: `s${i}`, title: `T${i}` });
assert.equal(list.length, MAX_STAGE_HISTORY);
assert.equal(list[0].title, "T19");
list = mergeStageHistory(list, { ...kept, id: "again", title: "T15" });
assert.equal(list[0].id, "again");
assert.equal(list.filter((item) => item.title === "T15").length, 1);

{
  const { stageHistoryDetail } = await import("../lib/stage-history.ts");
  assert.equal(stageHistoryDetail({ ...kept, createdAt: 1_000 }, 1_000 + 3_600_000), "table, example.com, today");
  assert.equal(stageHistoryDetail({ ...kept, sources: [], createdAt: 0 }, 2 * 86_400_000), "table, 2 days ago");
}

console.log("Stage history checks passed.");
