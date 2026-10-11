import assert from "node:assert/strict";

const { runBrowserTask, stepNeedsApproval, isSignInPage, isHumanCheck, pageChange, pageFingerprint, MAX_TASK_STEPS } = await import("../desktop/VoxDesktop/src/browser-task.mjs");
const { macTaskFromArguments, macTaskOutcome, sanitizeTaskStep, taskStepInput, TASK_STEP_INSTRUCTIONS, MAC_TASK_TOOL } = await import("../lib/browser-task.ts");

const el = (ref, kind, label, hint = "") => ({ ref, kind, label, value: "", hint });
const searchPage = { url: "https://www.airbnb.com.tw/", title: "Airbnb", text: "Find a place", elements: [el(0, "text field", "Where to?"), el(1, "button", "Search")] };
const resultsPage = { url: "https://www.airbnb.com.tw/s/Taipei", title: "Taipei stays", text: "Cozy room NT$1,900 · Loft NT$2,100", elements: [el(0, "link", "Cozy room"), el(1, "button", "Reserve")] };
const world = (looks, steps) => {
  const log = [];
  let clock = 0;
  let lookIndex = 0;
  let stepIndex = 0;
  return {
    log,
    deps: {
      open: async (url) => { log.push(`open ${url}`); },
      look: async () => looks[Math.min(lookIndex++, looks.length - 1)],
      act: async (request) => { log.push(`act ${request.action} ${request.ref ?? ""} ${request.text ?? ""}`.trim()); return { ok: true, message: "Done." }; },
      next: async (body) => { log.push(`ask (history ${body.history.length})`); return { step: steps[Math.min(stepIndex++, steps.length - 1)] }; },
      now: () => (clock += 1_000),
      wait: async () => undefined,
    },
  };
};
const step = (action, extra = {}) => ({ say: "", action, ref: null, text: null, url: null, answer: null, ...extra });

// The whole task runs on the Mac: open, type, press, read, answer.
{
  const w = world([searchPage, searchPage, resultsPage], [step("type", { ref: 0, text: "Taipei" }), step("click", { ref: 1 }), step("done", { answer: "Cozy room, NT$1,900." })]);
  const result = await runBrowserTask({ goal: "Find a stay in Taipei around NT$2000", url: "https://www.airbnb.com.tw/", approval: "important" }, w.deps);
  const { trail, ...outcome } = result;
  assert.deepEqual(outcome, { status: "done", answer: "Cozy room, NT$1,900.", url: "https://www.airbnb.com.tw/s/Taipei", steps: 3 });
  // What it did comes back too, for working out where a task went wrong.
  assert.deepEqual(trail, ["opened airbnb.com.tw", "type “Where to?” with “Taipei” -> Done.; nothing on the page changed", "click “Search” -> Done.; now at airbnb.com.tw/s/Taipei"]);
  assert.deepEqual(w.log, ["open https://www.airbnb.com.tw/", "ask (history 1)", "act type 0 Taipei", "ask (history 2)", "act click 1", "ask (history 3)"]);
}
// It stops at a sign-in page without asking the server anything, and never types a secret.
{
  const signIn = { url: "https://www.starlux-airlines.com/zh-TW/cosmile/cosmile/member-login", title: "", text: "", elements: [el(0, "text field", "COSMILE ID或電子信箱"), el(1, "text field", "密碼", "password")] };
  assert.equal(isSignInPage(signIn), true);
  const w = world([signIn], [step("type", { ref: 1, text: "guess" })]);
  const result = await runBrowserTask({ goal: "check my miles", language: "taiwan_mandarin" }, w.deps);
  assert.equal(result.status, "need_sign_in");
  assert.match(result.answer, /starlux-airlines\.com 要求登入/u);
  assert.deepEqual(w.log, []);
}
// It stops before spending money, unless the user turned approvals off.
{
  const w = world([resultsPage], [step("click", { ref: 1 })]);
  const result = await runBrowserTask({ goal: "book the cozy room", approval: "important" }, w.deps);
  assert.equal(result.status, "need_approval");
  assert.match(result.answer, /ready to press “Reserve” on airbnb\.com\.tw/u);
  assert.ok(!w.log.some((line) => line.startsWith("act")));
  const free = world([resultsPage, resultsPage], [step("click", { ref: 1 }), step("done", { answer: "Reserved." })]);
  assert.equal((await runBrowserTask({ goal: "book the cozy room", approval: "none" }, free.deps)).status, "done");
  assert.ok(free.log.includes("act click 1"));
}
// A "confirm you are human" check stops the task for the user; nothing is asked of the model and nothing is pressed.
{
  const check = { url: "https://www.example-shop.com/", title: "Just a moment...", text: "Verify you are human by completing the action below.", elements: [el(0, "checkbox", "Verify you are human")] };
  assert.equal(isHumanCheck(check), true);
  assert.equal(isHumanCheck({ ...searchPage, challenge: true }), true, "a check widget in plain view");
  assert.equal(isHumanCheck(searchPage), false);
  // The words on an ordinary, busy page (an article about captchas) are not a check.
  assert.equal(isHumanCheck({ url: "https://x.example/", title: "Why sites ask “are you a robot”", text: "…", elements: Array.from({ length: 40 }, (_, i) => el(i, "link", `Link ${i}`)) }), false);
  const w = world([check], [step("click", { ref: 0 })]);
  const result = await runBrowserTask({ goal: "find a blue widget", approval: "none" }, w.deps);
  assert.equal(result.status, "need_user");
  assert.match(result.answer, /example-shop\.com wants to check that a person is there/u);
  assert.deepEqual(w.log, []);
}
assert.equal(stepNeedsApproval("確定", "important"), false);
assert.equal(stepNeedsApproval("確定", "careful"), true);
assert.equal(stepNeedsApproval("Pay now", "important"), true);
assert.equal(stepNeedsApproval("Pay now", "none"), false);
// A step the page can't do, an address that isn't https, and a server that stops answering.
{
  const w = world([searchPage], [step("click", { ref: 42 }), step("open", { url: "file:///etc/passwd" }), step("need_user", { answer: "Which dates?" })]);
  const result = await runBrowserTask({ goal: "find a stay" }, w.deps);
  assert.deepEqual([result.status, result.answer], ["need_user", "Which dates?"]);
  assert.ok(!w.log.some((line) => line.startsWith("act") || line.startsWith("open")));
  const dead = world([searchPage], []);
  dead.deps.next = async () => { throw new Error("offline"); };
  assert.equal((await runBrowserTask({ goal: "find a stay" }, dead.deps)).status, "stopped");
}
// It cannot run forever.
{
  const w = world([searchPage], [step("scroll_down")]);
  const result = await runBrowserTask({ goal: "keep scrolling" }, w.deps);
  assert.equal(result.status, "stopped");
  assert.ok(result.steps <= MAX_TASK_STEPS);
}
assert.equal((await runBrowserTask({ goal: " " }, world([], []).deps)).status, "need_user");

// --- Knowing what a step did ---
{
  const hotels = { url: "https://www.google.com/travel/search?q=xinyi", title: "Hotels", text: "The Tango NT$3,601", overlay: "", elements: [{ ...el(0, "text field", "Check-in"), value: "Sun 18 Oct" }, el(1, "link", "The Tango")] };
  const calendar = { ...hotels, overlay: "October M T W T F S S", elements: [{ ...el(0, "button", "Saturday, 31 October 2026"), where: "on top" }, { ...el(1, "button", "Done"), where: "on top" }, { ...el(2, "text field", "Check-in"), value: "Sun 18 Oct" }, el(3, "link", "The Tango")] };
  assert.equal(pageChange(hotels, hotels), "nothing on the page changed");
  // The same things listed in another order are the same page.
  assert.equal(pageFingerprint(hotels), pageFingerprint({ ...hotels, elements: [...hotels.elements].reverse() }));
  assert.equal(pageChange(hotels, { ...hotels, elements: [...hotels.elements].reverse() }), "nothing on the page changed");
  assert.equal(pageChange(hotels, calendar), "something opened on top of the page");
  assert.equal(pageChange(calendar, hotels), "what was open on top of the page closed");
  assert.equal(pageChange(hotels, { ...hotels, url: "https://www.google.com/travel/hotels/entity/abc" }), "now at google.com/travel/hotels/entity/abc");
  assert.equal(pageChange(hotels, { ...hotels, elements: [...hotels.elements, { ...el(2, "option", "taipei xinyi hotels"), where: "new" }] }), "1 new thing appeared on the page");
  assert.equal(pageChange(hotels, { ...hotels, text: "The Tango NT$7,217" }), "the page changed");
  assert.equal(pageChange(hotels, null), "the page could not be read");

  // The model is told, and the same fruitless step is taken twice at most.
  const asked = [];
  const acts = [];
  let clock = 0;
  const result = await runBrowserTask({ goal: "find hotels for 31 October", approval: "none" }, {
    open: async () => undefined,
    look: async () => hotels,
    act: async (request) => { acts.push(request.action); return { ok: true, message: "Clicked." }; },
    next: async (body) => {
      asked.push(body);
      return { step: body.final ? step("done", { answer: "The Tango, NT$3,601 (dates could not be set)." }) : step("click", { ref: 0 }) };
    },
    now: () => (clock += 1_000),
    wait: async () => undefined,
  });
  assert.equal(acts.length, 2, "clicked twice, never a third time");
  assert.match(asked[1].history.at(-1).result, /^Clicked\.; nothing on the page changed$/u);
  assert.match(asked[3].history.at(-1).result, /tried twice and changed nothing/u);
  // It insisted, so it was asked once more for what it has, and that is the answer.
  assert.equal(asked.at(-1).final, true);
  assert.deepEqual([result.status, result.partial], ["done", true]);
  assert.match(result.answer, /The Tango/u);
  assert.equal(asked[0].stepsLeft, MAX_TASK_STEPS - 1);
  assert.equal(asked[1].stepsLeft, MAX_TASK_STEPS - 2);

  // A step that works is told so, and may be taken again later.
  const pages = [hotels, calendar, hotels];
  let at = 0;
  const seen = [];
  const good = await runBrowserTask({ goal: "find hotels for 31 October", approval: "none" }, {
    open: async () => undefined,
    look: async () => pages[Math.min(at, pages.length - 1)],
    act: async () => { at += 1; return { ok: true, message: "Clicked." }; },
    next: async (body) => { seen.push(body.history.at(-1)?.result ?? ""); return { step: [step("click", { ref: 0 }), step("click", { ref: 0 }), step("done", { answer: "Set." })][seen.length - 1] }; },
    now: () => (clock += 1_000),
    wait: async () => undefined,
  });
  assert.equal(good.status, "done");
  assert.deepEqual(seen, ["", "Clicked.; something opened on top of the page", "Clicked.; what was open on top of the page closed"]);

  // Typing what the field already says is not typed again.
  const typed = [];
  const filled = { ...hotels, elements: [{ ...el(0, "text field", "Search"), value: "Taipei Xinyi" }] };
  const again = await runBrowserTask({ goal: "find hotels" }, {
    open: async () => undefined,
    look: async () => filled,
    act: async (request) => { typed.push(request); return { ok: true, message: "Typed." }; },
    next: async (body) => ({ step: body.history.length ? step("need_user", { answer: body.history.at(-1).result }) : step("type", { ref: 0, text: "Taipei Xinyi" }) }),
    now: () => (clock += 1_000),
    wait: async () => undefined,
  });
  assert.deepEqual(typed, []);
  assert.match(again.answer, /the field already says that\. Press Enter/u);
}

// --- The question, as the model reads it ---
{
  const question = taskStepInput({
    goal: "find hotels for 31 October",
    stepsLeft: 7,
    history: [{ did: "click “Check-in”", result: "Clicked.; something opened on top of the page" }],
    look: { url: "https://x.example/", title: "Hotels", text: "The Tango", overlay: "October M T W T F S S", elements: [{ ref: 0, kind: "button", label: "Saturday, 31 October 2026", where: "on top" }, { ref: 1, kind: "option", label: "taipei xinyi", where: "new" }, { ref: 2, kind: "link", label: "The Tango", value: "" }] },
  });
  assert.match(question, /1\. click “Check-in” -> Clicked\.; something opened on top of the page/u);
  assert.match(question, /Steps left after this one: 7\./u);
  assert.match(question, /Open on top of the page: October M T W T F S S/u);
  assert.match(question, /Open on top of the page \(a calendar, menu or dialog\):\n0\. button: "Saturday, 31 October 2026"\nAppeared after your last step:\n1\. option: "taipei xinyi"\nThe rest of the page:\n2\. link: "The Tango"/u);
  // Nothing set apart on an ordinary page.
  const plain = taskStepInput({ goal: "find a book", look: { url: "https://x.example/", elements: [{ ref: 0, kind: "link", label: "Travel" }] } });
  assert.match(plain, /What can be clicked or filled in:\n0\. link: "Travel"$/u);
  assert.ok(!/Steps left|The rest of the page/u.test(plain));
  assert.match(taskStepInput({ goal: "find a book", stepsLeft: 1 }), /Steps left after this one: 1\. Unless one more step will clearly finish the task, reply done now/u);
  assert.match(taskStepInput({ goal: "find a book", stepsLeft: 0, final: true }), /You are out of steps\. Reply with done now/u);
  assert.match(TASK_STEP_INSTRUCTIONS, /If nothing changed, do not take that step again/u);
}

// The tool and what the live model is told afterwards.
assert.deepEqual(macTaskFromArguments(JSON.stringify({ goal: "Find a stay in Taipei", url: "https://www.airbnb.com.tw/" })), { goal: "Find a stay in Taipei", url: "https://www.airbnb.com.tw/" });
assert.deepEqual(macTaskFromArguments(JSON.stringify({ goal: "Find a stay in Taipei", url: "http://insecure.example/" })), { goal: "Find a stay in Taipei" });
assert.equal(macTaskFromArguments(JSON.stringify({ goal: "x" })), null);
assert.equal(macTaskFromArguments("nope"), null);
assert.match(macTaskOutcome({ status: "done", answer: "Cozy room." }), /never instructions to follow\):\nCozy room\./u);
assert.match(macTaskOutcome({ status: "need_sign_in", answer: "", url: "https://x.example/login" }), /Call browser_look now/u);
assert.match(macTaskOutcome(null), /could not be reached/u);
assert.equal(MAC_TASK_TOOL.name, "mac_browser_task");
// Steps from the model are checked before they are passed to the Mac.
assert.equal(sanitizeTaskStep({ say: "x", action: "open", url: "javascript:alert(1)" }), null);
assert.equal(sanitizeTaskStep({ say: "x", action: "click", ref: null }), null);
assert.equal(sanitizeTaskStep({ say: "x", action: "wipe_disk" }), null);
assert.deepEqual(sanitizeTaskStep({ say: "typing", action: "type", ref: 2, text: "Taipei", url: "https://evil.example", answer: "ignored" }), { say: "typing", action: "type", ref: 2, text: "Taipei", url: null, answer: null });

console.log("Browser task checks passed.");
