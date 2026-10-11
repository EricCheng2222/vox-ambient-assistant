// A whole website task, carried out here on the Mac for the user's phone or
// tablet, so it keeps going when that device is put away. This loop looks at
// the page, asks the Vox server for one next step, and takes it, until the
// task is done or the user is needed. The limits are enforced here, whatever
// the server suggests:
//   - it never types into password, card, or code fields (the page step refuses);
//   - it stops at a sign-in page, so the user can sign in;
//   - it stops before a step that spends money, reaches other people, or
//     deletes, unless the user turned approvals off on the device that asked;
//   - it only opens https pages, and gives up after a bounded number of steps.
//
// It also keeps the model honest about progress: after every step it says
// whether the page changed, it will not take the same step a third time when
// that step changed nothing, and when the steps run out it asks once more for
// the best answer from what was found instead of reporting only that it stopped.

export const MAX_TASK_STEPS = 20;
export const MAX_TASK_MS = 4 * 60_000;
/** A step that changed nothing may be taken this many times; after that it is refused. */
const MAX_SAME_STEP = 2;
/** Refusals in a row before the task stops trying and wraps up. */
const MAX_REFUSALS = 3;

const COMMIT_WORDS =
  /\b(order|pay|purchase|buy|checkout|check out|place|confirm|book|request|reserve|send|submit|post|publish|share|delete|remove|cancel|transfer|subscribe|unsubscribe|donate|tip|sign up|register|accept|agree|apply|withdraw|deposit|bid|rsvp)\b|下單|付款|結帳|購買|訂購|確認|確定|預訂|預約|叫車|送出|傳送|發送|發佈|發布|分享|刪除|移除|取消|轉帳|訂閱|捐|同意|接受|報名|申請|提交/iu;
const HIGH_STAKES_WORDS =
  /\b(order|pay|purchase|buy|checkout|check out|place order|send|post|publish|share|delete|remove|cancel|transfer|subscribe|unsubscribe|donate|tip|withdraw|deposit|bid|book now|reserve)\b|下單|付款|結帳|購買|訂購|叫車|傳送|發送|發佈|發布|分享|刪除|移除|取消訂|轉帳|訂閱|捐|立即預訂|確認訂/iu;

/** Whether pressing this needs the user's yes, by the approval level they chose. */
export function stepNeedsApproval(label, approval) {
  if (approval === "none") return false;
  return (approval === "careful" ? COMMIT_WORDS : HIGH_STAKES_WORDS).test(String(label ?? ""));
}

const isHttps = (value) => {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};
const hostOf = (value) => {
  try {
    return new URL(String(value ?? "")).hostname.replace(/^www\./u, "");
  } catch {
    return "the site";
  }
};
const clip = (value, max) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
/** An answer keeps its lines: it is laid out for reading (one option per line). */
const answerText = (value, max) => String(value ?? "").replace(/[^\S\n]+/gu, " ").replace(/ ?\n ?/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim().slice(0, max);

/** A page that is asking the user to sign in. */
export function isSignInPage(look) {
  return Boolean(look?.elements?.some((element) => element.kind === "text field" && /password|密碼/iu.test(`${element.hint ?? ""} ${element.label ?? ""}`)));
}

const pathOf = (value) => {
  try {
    const url = new URL(String(value ?? ""));
    return `${url.hostname.replace(/^www\./u, "")}${url.pathname === "/" ? "" : url.pathname.slice(0, 40)}`;
  } catch {
    return "";
  }
};

/** A page in a form two looks can be compared by; the order things are listed in does not matter. */
export function pageFingerprint(look) {
  if (!look) return "";
  const things = (look.elements ?? []).map((element) => `${element.kind}:${element.label}=${element.value}`).sort();
  return [String(look.url ?? "").replace(/#.*$/u, ""), look.title ?? "", look.text ?? "", look.overlay ?? "", things.join("|")].join("\n");
}

/** In a few words, what a step did to the page: the model is told this, so it does not repeat what had no effect. */
export function pageChange(before, after) {
  if (!after) return "the page could not be read";
  if (!before) return "";
  if (pathOf(before.url) !== pathOf(after.url)) return `now at ${pathOf(after.url) || "another page"}`;
  if (after.overlay && !before.overlay) return "something opened on top of the page";
  if (!after.overlay && before.overlay) return "what was open on top of the page closed";
  if (pageFingerprint(before) === pageFingerprint(after)) return "nothing on the page changed";
  const appeared = (after.elements ?? []).filter((element) => element.where === "new").length;
  return appeared ? `${appeared} new ${appeared === 1 ? "thing" : "things"} appeared on the page` : "the page changed";
}

const HUMAN_CHECK_WORDS =
  /verify (?:that )?you(?:'| a)re (?:a )?human|confirm you(?:'| a)re (?:not a robot|human)|i(?:'| a)m not a robot|are you a robot|checking (?:if the site connection is secure|your browser)|unusual traffic|press (?:and|&) hold|security check|驗證您是真人|我不是機器人|請完成驗證|人機驗證|安全驗證/iu;

/** A page that wants proof a person is there. That is the user's to give; Vox does not try. */
export function isHumanCheck(look) {
  if (!look) return false;
  if (look.challenge === true) return true;
  // A page that is nothing but the check: a few words, almost nothing to press.
  const words = `${look.title ?? ""} ${String(look.text ?? "").slice(0, 600)}`;
  return HUMAN_CHECK_WORDS.test(words) && (look.elements?.length ?? 0) <= 12;
}

/**
 * Runs the task. `deps`: open(url), look(), act({action, ref, text}),
 * next({goal, language, look, history, stepsLeft, final}) → {step}, now(), wait(ms).
 * Resolves to { status, answer, url, steps }.
 */
export async function runBrowserTask(task, deps) {
  const goal = clip(task?.goal, 1_200);
  // What was said just before, so the server can tell what "that day" refers to.
  const context = String(task?.context ?? "").trim().slice(0, 1_500);
  const approval = ["careful", "important", "none"].includes(task?.approval) ? task.approval : "important";
  const language = task?.language === "taiwan_mandarin" ? "taiwan_mandarin" : "english";
  const zh = language === "taiwan_mandarin";
  if (goal.length < 4) return { status: "need_user", answer: zh ? "我不清楚要做什麼。" : "It isn't clear what to do.", steps: 0 };
  const started = deps.now();
  const history = [];
  // How often each step was taken with nothing to show for it.
  const fruitless = new Map();
  let steps = 0;
  let refusals = 0;
  let url = "";
  let before = null;
  let lastKey = "";
  const question = (look, extra) => ({ goal, language, ...(context ? { context } : {}), look: look ?? { url: "", title: "", text: "", elements: [] }, history: history.slice(-14), ...extra });
  // What was done, step by step, goes back with the result: when a task goes wrong, this says where.
  const finish = (result) => ({ ...result, trail: history.slice(-24).map((entry) => clip(`${entry.did}${entry.result ? ` -> ${entry.result}` : ""}`, 150)) });
  if (task?.url && isHttps(task.url)) {
    await deps.open(task.url);
    await deps.wait(2_500);
    history.push({ did: `opened ${hostOf(task.url)}` });
  }
  while (steps < MAX_TASK_STEPS && refusals < MAX_REFUSALS && deps.now() - started < MAX_TASK_MS) {
    const look = await deps.look();
    url = look?.url ?? url;
    // What the last step did, said plainly, and counted when it was nothing.
    if (lastKey) {
      const change = pageChange(before, look);
      const entry = history.at(-1);
      if (entry && change) entry.result = [entry.result, change].filter(Boolean).join("; ");
      if (change === "nothing on the page changed") fruitless.set(lastKey, (fruitless.get(lastKey) ?? 0) + 1);
      else fruitless.delete(lastKey);
      lastKey = "";
    }
    if (isHumanCheck(look)) {
      return finish({ status: "need_user", answer: zh ? `${hostOf(url)} 要確認是真人在操作，這一步需要你自己來。` : `${hostOf(url)} wants to check that a person is there. That step is yours to do.`, url, steps });
    }
    if (look && isSignInPage(look)) {
      return finish({ status: "need_sign_in", answer: zh ? `${hostOf(url)} 要求登入。` : `${hostOf(url)} is asking you to sign in.`, url, steps });
    }
    let step;
    try {
      step = (await deps.next(question(look, { stepsLeft: MAX_TASK_STEPS - steps - 1 })))?.step;
    } catch {
      step = null;
    }
    if (!step) return finish({ status: "stopped", answer: zh ? "中途無法決定下一步。" : "It couldn't work out the next step partway through.", url, steps });
    steps += 1;
    if (step.action === "done") return finish({ status: "done", answer: answerText(step.answer, 2_400) || (zh ? "完成了。" : "Done."), url, steps });
    if (step.action === "need_user") return finish({ status: "need_user", answer: clip(step.answer, 600) || (zh ? "需要你的協助。" : "It needs you."), url, steps });
    const scrolling = step.action === "scroll_down" || step.action === "scroll_up";
    const element = scrolling || step.action === "open" ? null : look?.elements?.find((item) => item.ref === step.ref);
    const label = clip(element?.label, 60);
    const key = step.action === "open" ? `open ${step.url}` : `${step.action} ${label} ${step.action === "type" || step.action === "select" ? clip(step.text, 80) : ""}`;
    if ((fruitless.get(key) ?? 0) >= MAX_SAME_STEP) {
      refusals += 1;
      history.push({ did: `wanted to ${step.action.replace("_", " ")}${label ? ` “${label}”` : ""} again`, result: "not done: that was tried twice and changed nothing. Take a different step, or finish with what you have" });
      continue;
    }
    // Typing what the field already says does nothing: the search has not been sent yet.
    if (step.action === "type" && element && clip(element.value, 500) && clip(element.value, 500) === clip(step.text, 500)) {
      refusals += 1;
      history.push({ did: `wanted to type “${clip(step.text, 60)}” into “${label}” again`, result: "not done: the field already says that. Press Enter on it, or pick one of the suggestions listed" });
      continue;
    }
    refusals = 0;
    if (step.action === "open") {
      if (!isHttps(step.url)) {
        history.push({ did: "tried to open an address", result: "refused: only https pages can be opened" });
        continue;
      }
      before = look;
      lastKey = key;
      await deps.open(step.url);
      await deps.wait(2_500);
      history.push({ did: `opened ${hostOf(step.url)}` });
      continue;
    }
    if (!scrolling && !element) {
      history.push({ did: `${step.action} on number ${step.ref}`, result: "that number is not on the page" });
      continue;
    }
    if ((step.action === "click" || step.action === "press_enter") && stepNeedsApproval(label, approval)) {
      return finish({
        status: "need_approval",
        answer: zh ? `準備在 ${hostOf(url)} 按「${label}」。` : `It is ready to press “${label}” on ${hostOf(url)}.`,
        url,
        steps,
      });
    }
    before = look;
    lastKey = key;
    const result = await deps.act({ action: step.action, ref: step.ref ?? undefined, text: step.text ?? "" });
    history.push({ did: scrolling ? step.action.replace("_", " ") : `${step.action.replace("_", " ")} “${label}”${step.action === "type" ? ` with “${clip(step.text, 60)}”` : ""}`, result: clip(result?.message, 120) });
    // The page refused a secret field: only the user can fill that in.
    if (result?.ok === false && /password|card|code/iu.test(String(result?.message ?? ""))) {
      return finish({ status: "need_sign_in", answer: zh ? `${hostOf(url)} 需要你輸入私密資料。` : `${hostOf(url)} needs details only you can type.`, url, steps });
    }
    await deps.wait(700);
  }
  // Out of steps or time. What was found on the way is still worth having:
  // one last question, answered from the page as it stands.
  try {
    const look = await deps.look();
    url = look?.url ?? url;
    const last = (await deps.next(question(look, { stepsLeft: 0, final: true })))?.step;
    const answer = last?.action === "done" || last?.action === "need_user" ? answerText(last.answer, 2_400) : "";
    if (answer) return finish({ status: last.action === "done" ? "done" : "need_user", answer, url, steps, partial: true });
  } catch {
    // Nothing more to be had; say so below.
  }
  return finish({
    status: "stopped",
    answer: zh ? `做了 ${steps} 個步驟還沒完成，先停在這裡。` : `It took ${steps} steps without finishing, so it stopped here.`,
    url,
    steps,
  });
}
