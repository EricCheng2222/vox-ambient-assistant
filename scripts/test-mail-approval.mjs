import assert from "node:assert/strict";

const {
  MAIL_CONFIRMED_TOOLS,
  MAIL_UNCONFIRMED_TOOLS,
  classifyMailApproval,
  describeMailApproval,
} = await import("../lib/mail-approval.ts");

for (const text of ["yes", "Yes.", "OK send it", "go ahead", "sure, please", "好", "好的。", "寄出去", "確定", "好 寄吧"]) {
  assert.equal(classifyMailApproval(text), "approve", text);
}
for (const text of ["no", "No, wait.", "cancel", "don't send it", "不要", "等一下", "算了"]) {
  assert.equal(classifyMailApproval(text), "deny", text);
}
// A change is not an approval; neither is anything unclear.
for (const text of ["yes but make it shorter", "send it to Amy instead", "好，但是改一下主旨", "what did it say?", "", "嗯"]) {
  assert.equal(classifyMailApproval(text), "other", text);
}

const send = describeMailApproval(
  "send_email",
  JSON.stringify({ to: ["amy@example.com"], cc: "bob@example.com", subject: "Lunch", body: "See you at noon." }),
  "english",
);
assert.equal(send, 'Send an email to amy@example.com, bob@example.com, subject "Lunch", saying: "See you at noon." Say yes to send it, or no to cancel.');
const zh = describeMailApproval("send_email", JSON.stringify({ to: "amy@example.com", subject: "午餐", body: "中午見" }), "taiwan_mandarin");
assert.match(zh, /寄信給 amy@example\.com，主旨「午餐」，內容：「中午見」/u);
const long = describeMailApproval("reply_email", JSON.stringify({ id: "x", body: "word ".repeat(200), reply_all: true }), "english");
assert.match(long, /^Reply to everyone on that email/u);
assert.match(long, /full text is on screen/u);
assert.match(describeMailApproval("trash_email", JSON.stringify({ ids: ["a", "b", "c"] }), "english"), /Move 3 emails to the trash/u);
assert.match(describeMailApproval("forward_email", JSON.stringify({ id: "x", to: ["c@d.com"], note: "FYI" }), "english"), /Forward that email to c@d\.com with the note: "FYI"/u);
assert.equal(describeMailApproval("search_email", "{}", "english"), null);
assert.match(
  describeMailApproval("send_email", JSON.stringify({ account: "me@icloud.com", to: "amy@example.com", subject: "Hi", body: "Hello" }), "english"),
  /^Send an email from me@icloud\.com to amy@example\.com/u,
);
assert.match(
  describeMailApproval("send_email", JSON.stringify({ account: "me@icloud.com", to: "amy@example.com", body: "嗨" }), "taiwan_mandarin"),
  /^要用 me@icloud\.com 寄信給 amy@example\.com/u,
);
assert.match(describeMailApproval("send_email", "not json", "english"), /^Send an email to /u);

// Every tool is in exactly one list.
const confirmed = new Set(MAIL_CONFIRMED_TOOLS);
assert.ok(MAIL_UNCONFIRMED_TOOLS.every((name) => !confirmed.has(name)));
for (const name of MAIL_CONFIRMED_TOOLS) assert.ok(describeMailApproval(name, "{}", "english"));

console.log("Mail approval checks passed.");

// Email always goes to the live model, which has the email tools.
const { readFile } = await import("node:fs/promises");
const [router, page, proxy] = await Promise.all([
  readFile(new URL("../app/api/jev-route/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../desktop/VoxDesktop/src/local-web-server.mjs", import.meta.url), "utf8"),
]);
assert.match(router, /only the realtime model has the email tools/u);
assert.match(page, /always: \{ tool_names: \[\.\.\.MAIL_CONFIRMED_TOOLS\] \}/u);
assert.match(page, /classifyMailApproval\(completeText\)/u);
assert.match(page, /tools: sessionTools\(\{/u);
assert.doesNotMatch(page, /tools: \[\]/u);
assert.match(proxy, /"\/api\/mail\/token"/u);
console.log("Mail routing checks passed.");
