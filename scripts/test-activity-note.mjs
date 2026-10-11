import assert from "node:assert/strict";

const { toolActivity, serviceActivity, routeActivity } = await import("../lib/activity-note.ts");

const here = { zh: false, onMac: false };
const mac = { zh: false, onMac: true };
assert.equal(toolActivity("show_on_stage", JSON.stringify({ title: "Stays", sources: [{ url: "https://www.airbnb.com.tw/s/Taipei" }] }), here), "Opening airbnb.com.tw");
assert.equal(toolActivity("show_on_stage", JSON.stringify({ title: "Plan", blocks: [] }), here), "Putting it on screen");
assert.equal(toolActivity("browser_look", "{}", mac), "Reading the page on your Mac");
assert.equal(toolActivity("browser_act", JSON.stringify({ action: "click", ref: 3 }), { ...here, elementLabel: "登入" }), "Pressing “登入”");
assert.equal(toolActivity("browser_act", JSON.stringify({ action: "type", ref: 3, text: "Taipei" }), { ...mac, elementLabel: "Where to?" }), "Typing into “Where to?” on your Mac");
assert.ok(!toolActivity("browser_act", JSON.stringify({ action: "type", ref: 3, text: "what I typed" }), { ...here, elementLabel: "Search" }).includes("what I typed"), "what is typed is not echoed");
assert.equal(toolActivity("browser_act", JSON.stringify({ action: "scroll_down" }), here), "Scrolling the page");
assert.equal(toolActivity("fill_code_from_email", "{}", here), "Getting the code from your email");
assert.equal(toolActivity("browser_act", JSON.stringify({ action: "click" }), { zh: true, onMac: true, elementLabel: "登入" }), "正在按「登入」（在你的 Mac 上）");
assert.equal(toolActivity("nonsense", "not json", here), "");
// A long or odd label is shortened and cleaned.
assert.ok(toolActivity("browser_act", JSON.stringify({ action: "click" }), { ...here, elementLabel: `Buy‮ now ${"x".repeat(80)}` }).length < 50);

assert.equal(serviceActivity("search_email", "email", false), "Searching your email");
assert.equal(serviceActivity("list_events", "email", true), "正在看你的行事曆");
assert.equal(serviceActivity("log_set", "velo", false), "Writing in your notebook");
assert.equal(serviceActivity("unknown_tool", "unknown", false), "");
assert.equal(routeActivity("live_web", false), "Searching the web and reading what it finds");
assert.equal(routeActivity("expert_reasoning", true), "正在用較強的模型仔細思考");
assert.equal(routeActivity("realtime", false), "");

console.log("Activity note checks passed.");
