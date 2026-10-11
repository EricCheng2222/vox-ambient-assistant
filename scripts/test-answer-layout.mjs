import assert from "node:assert/strict";
const { answerBlocks, withAmounts } = await import("../lib/answer-layout.ts");

// Prose stays prose.
assert.deepEqual(answerBlocks("Ash."), [{ kind: "text", text: "Ash." }]);
assert.deepEqual(answerBlocks("One line\nstill the same paragraph.\n\nA second one."), [{ kind: "text", text: "One line still the same paragraph." }, { kind: "text", text: "A second one." }]);

// A list of options, name first.
const hotels = answerBlocks("For Sat 31 Oct to Sun 1 Nov in Xinyi:\n\n- Waterfront Hotel — from NT$5,660, rated 4.4/5\n- The Tango Taipei Xinyi — from NT$7,217, rated 4.2/5, central\n- **Swiio Hotel Daan**: NT$3,944, just outside Xinyi\n\nPrices are per night.");
assert.equal(hotels.length, 3);
assert.deepEqual(hotels[0], { kind: "text", text: "For Sat 31 Oct to Sun 1 Nov in Xinyi:" });
assert.deepEqual(hotels[1], { kind: "list", ordered: false, items: [
  { lead: "Waterfront Hotel", detail: "from NT$5,660, rated 4.4/5" },
  { lead: "The Tango Taipei Xinyi", detail: "from NT$7,217, rated 4.2/5, central" },
  { lead: "Swiio Hotel Daan", detail: "NT$3,944, just outside Xinyi" },
] });
assert.deepEqual(hotels[2], { kind: "text", text: "Prices are per night." });

// Steps keep their order; lines without a name are whole.
assert.deepEqual(answerBlocks("1. Open Settings\n2. Tap Websites\n3) Sign in"), [{ kind: "list", ordered: true, items: [{ lead: "", detail: "Open Settings" }, { lead: "", detail: "Tap Websites" }, { lead: "", detail: "Sign in" }] }]);
// A long opening is not a name, and a time is not a separator.
assert.equal(answerBlocks("- a\n- " + "x".repeat(80) + " — tail")[0].items[1].lead, "");
assert.deepEqual(answerBlocks("- Breakfast at 7:30 sharp\n- Lunch")[0].items[0], { lead: "", detail: "Breakfast at 7:30 sharp" });
// A sentence that merely starts with a dash, and a negative number, are text.
assert.deepEqual(answerBlocks("- just a thought"), [{ kind: "text", text: "just a thought" }]);
assert.deepEqual(answerBlocks("-5 degrees tonight"), [{ kind: "text", text: "-5 degrees tonight" }]);
// Chinese.
assert.deepEqual(answerBlocks("找到三間：\n- 水岸飯店：NT$5,660 起，4.4 分\n- 探戈飯店 — 7,217 元")[1].items, [{ lead: "水岸飯店", detail: "NT$5,660 起，4.4 分" }, { lead: "探戈飯店", detail: "7,217 元" }]);
assert.deepEqual(answerBlocks(""), []);

// Amounts of money are picked out; other numbers are left alone.
assert.deepEqual(withAmounts("from NT$5,660, rated 4.4/5"), [{ text: "from ", amount: false }, { text: "NT$5,660", amount: true }, { text: ", rated 4.4/5", amount: false }]);
assert.deepEqual(withAmounts("£14.19 then 7,217 元").filter((run) => run.amount).map((run) => run.text), ["£14.19", "7,217 元"]);
assert.deepEqual(withAmounts("32 books"), [{ text: "32 books", amount: false }]);
// Choices: what the user can have Vox do, one tap each.
{
  const notice = answerBlocks('An email from Amy needs you: "Budget sign-off".\n→ Read me the email "Budget sign-off"\n→ Draft a reply to "Budget sign-off"\n-> Remind me tonight\n\nA second thing.\n→ It is done');
  assert.deepEqual(notice, [
    { kind: "text", text: 'An email from Amy needs you: "Budget sign-off".' },
    { kind: "choices", choices: ['Read me the email "Budget sign-off"', 'Draft a reply to "Budget sign-off"', "Remind me tonight"] },
    { kind: "text", text: "A second thing." },
    { kind: "choices", choices: ["It is done"] },
  ]);
  // Never a wall of buttons.
  assert.equal(answerBlocks(["→ a", "→ b", "→ c", "→ d", "→ e", "→ f"].join("\n"))[0].choices.length, 4);
  // An arrow in the middle of a sentence is just a sentence.
  assert.deepEqual(answerBlocks("Taipei → Tokyo is three hours."), [{ kind: "text", text: "Taipei → Tokyo is three hours." }]);
  // A text message's "come to Vox" ending is dropped inside Vox.
  assert.deepEqual(answerBlocks("有一封信需要你處理：「Low Balance Warning」。打開 Vox 處理。 https://vox-assistant.example.workers.dev"), [{ kind: "text", text: "有一封信需要你處理：「Low Balance Warning」。" }]);
  assert.deepEqual(answerBlocks("An email needs you. Open Vox to deal with it.\nhttps://vox-assistant.example.workers.dev"), [{ kind: "text", text: "An email needs you." }]);
}
console.log("answer layout: ok");
