import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  computeTwilioSignature,
  dialSip,
  escapeXml,
  gatherSpeech,
  say,
} from "../lib/twilio.ts";
import {
  isValidSpokenPassphrase,
  normalizePhoneNumber,
  normalizeSpokenPassphrase,
} from "../lib/phone-assistant-policy.ts";
import {
  buildPhoneWebSearchRequest,
  normalizePhoneWebQuery,
  readPhoneWebSearchResult,
  searchPhoneWeb,
} from "../lib/phone-web-search.ts";

assert.equal(normalizePhoneNumber("+886 912-345-678"), "+886912345678");
assert.equal(normalizePhoneNumber("0912345678"), null);
assert.equal(normalizeSpokenPassphrase("  月亮，記得藍色的雨傘！ "), "月亮記得藍色的雨傘");
assert.equal(
  normalizeSpokenPassphrase("My Quiet River Remembers"),
  "myquietriverremembers",
);
assert.equal(isValidSpokenPassphrase("月亮記得藍色的雨傘和咖啡"), true);
assert.equal(isValidSpokenPassphrase("芝麻開門"), false);

assert.equal(escapeXml(`Vox <phone> & "voice"`), "Vox &lt;phone&gt; &amp; &quot;voice&quot;");
assert.match(say("你好 & welcome"), /你好 &amp; welcome/u);
assert.equal(
  dialSip("sip:proj_test@sip.api.openai.com;transport=tls"),
  '<Dial answerOnBridge="true"><Sip>sip:proj_test@sip.api.openai.com;transport=tls</Sip></Dial>',
);
assert.match(gatherSpeech("https://vox.example/voice", "請說"), /language="zh-TW"/u);
assert.match(gatherSpeech("https://vox.example/voice", "請說"), /timeout="12"/u);
assert.match(gatherSpeech("https://vox.example/voice", "請說"), /speechTimeout="2"/u);
assert.doesNotMatch(gatherSpeech("https://vox.example/voice", ""), /<Say/u);
assert.match(
  gatherSpeech("https://vox.example/voice", "請說", {
    timeoutSeconds: 18,
    speechTimeoutSeconds: 3,
  }),
  /timeout="18" speechTimeout="3"/u,
);

const signature = await computeTwilioSignature(
  "test-auth-token",
  "https://vox.example/api/twilio/voice?stage=start",
  new URLSearchParams({ CallSid: "CA123", From: "+886912345678" }),
);
assert.match(signature, /^[A-Za-z0-9+/]+={0,2}$/u);
assert.equal(
  signature,
  await computeTwilioSignature(
    "test-auth-token",
    "https://vox.example/api/twilio/voice?stage=start",
    new URLSearchParams({ From: "+886912345678", CallSid: "CA123" }),
  ),
);

assert.equal(normalizePhoneWebQuery("  今天   新竹天氣如何？  "), "今天 新竹天氣如何？");
assert.equal(normalizePhoneWebQuery(null), "");
const searchRequest = buildPhoneWebSearchRequest(
  "今天新竹天氣如何？",
  new Date("2026-09-23T02:00:00.000Z"),
);
assert.equal(searchRequest.model, "gpt-4.1-mini");
assert.equal(searchRequest.tool_choice, "required");
assert.equal(searchRequest.tools[0].type, "web_search");
assert.equal(searchRequest.tools[0].user_location.country, "TW");

const parsedSearch = readPhoneWebSearchResult({
  output: [{
    content: [{
      type: "output_text",
      text: "新竹目前 27°C。[中央氣象署](https://www.cwa.gov.tw/)",
      annotations: [{
        type: "url_citation",
        title: "中央氣象署",
        url: "https://www.cwa.gov.tw/",
      }],
    }],
  }],
});
assert.equal(parsedSearch.answer, "新竹目前 27°C。中央氣象署");
assert.deepEqual(parsedSearch.sources, ["中央氣象署"]);

let requestedBody;
const searched = await searchPhoneWeb(
  "今天新竹天氣如何？",
  "test-key",
  async (_url, init) => {
    requestedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ output_text: "新竹目前晴朗，約 27°C。" }));
  },
);
assert.equal(requestedBody.tool_choice, "required");
assert.equal(searched.answer, "新竹目前晴朗，約 27°C。");

const realtimeInstructions = await readFile(
  new URL("../lib/realtime-sip.ts", import.meta.url),
  "utf8",
);
assert.match(realtimeInstructions, /starts on Vox Cloud/iu);
assert.match(realtimeInstructions, /set_execution_route/iu);
assert.match(realtimeInstructions, /run_on_mac/iu);
assert.match(realtimeInstructions, /Mac-side policy still blocks or confirms sensitive actions/iu);

const [sipRoute, legacyPhoneAssistant, conversationStore, page, styles] = await Promise.all([
  readFile(new URL("../app/api/openai/realtime-sip/internal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/phone-assistant.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/conversation-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);
assert.match(sipRoute, /source:\s*"phone"/u);
assert.match(legacyPhoneAssistant, /source:\s*"phone"/u);
assert.match(conversationStore, /conversationMessages\.source/u);
assert.match(page, /message\.source === "phone"/u);
assert.match(page, /Phone call/u);
assert.match(page, /message-phone-badge/u);
assert.match(page, /Mark as call/u);
assert.match(styles, /\.message-phone/u);
assert.match(styles, /\.message-phone-badge/u);

// Reminder phone calls: spoken script, Twilio language, and scheduler wiring.
const {
  isReminderDelivery,
  isReminderOverdue,
  isReminderPostpone,
  isReminderVisible,
  postponedDueAt,
  reminderCallScript,
} = await import("../lib/reminder.ts");
// Place-based reminders: no due time, labelled by place, hidden once finished.
{
  const { LOCATION_REMINDER_DUE_AT, isLocationReminder, reminderPlaceLabel, isReminderLocationStatus } =
    await import("../lib/reminder.ts");
  const place = { status: "pending", dueAt: LOCATION_REMINDER_DUE_AT, triggerType: "location" };
  assert.equal(isLocationReminder(place), true);
  assert.equal(isReminderOverdue(place, Date.now()), false);
  assert.equal(isReminderVisible(place, Date.now()), true);
  assert.equal(isReminderVisible({ ...place, status: "completed" }, Date.now()), false);
  assert.equal(reminderPlaceLabel({ place: "家", placeEvent: "arrive" }, "taiwan_mandarin"), "抵達「家」時");
  assert.equal(reminderPlaceLabel({ place: "the office", placeEvent: "leave" }), "When you leave the office");
  assert.equal(isReminderLocationStatus("armed"), true);
  assert.equal(isReminderLocationStatus("somewhere"), false);
}
// Reminder list lifecycle: finished reminders leave once due; open ones stay.
const clock = Date.parse("2026-09-25T10:00:00.000Z");
const past = "2026-09-25T09:00:00.000Z";
const future = "2026-09-25T11:00:00.000Z";
assert.equal(isReminderVisible({ status: "pending", dueAt: past }, clock), true);
assert.equal(isReminderVisible({ status: "completed", dueAt: past }, clock), false);
assert.equal(isReminderVisible({ status: "dismissed", dueAt: past }, clock), false);
assert.equal(isReminderVisible({ status: "completed", dueAt: future }, clock), true);
assert.equal(isReminderOverdue({ status: "pending", dueAt: past }, clock), true);
assert.equal(isReminderOverdue({ status: "pending", dueAt: future }, clock), false);
assert.equal(isReminderPostpone("1h"), true);
assert.equal(isReminderPostpone("2h"), false);
assert.equal(postponedDueAt("10m", new Date(clock)), "2026-09-25T10:10:00.000Z");
assert.equal(postponedDueAt("1h", new Date(clock)), "2026-09-25T11:00:00.000Z");
// 10:00 UTC is 18:00 in Taipei; tomorrow 09:00 Taipei is 01:00 UTC on the 26th.
assert.equal(postponedDueAt("tomorrow", new Date(clock)), "2026-09-26T01:00:00.000Z");
// 17:00 UTC is already 01:00 on the 26th in Taipei, so "tomorrow" is the 27th.
assert.equal(
  postponedDueAt("tomorrow", new Date("2026-09-25T17:00:00.000Z")),
  "2026-09-27T01:00:00.000Z",
);
assert.equal(isReminderDelivery("call"), true);
assert.equal(isReminderDelivery("sms"), false);
assert.deepEqual(reminderCallScript({ title: "打電話給牙醫", notes: null }), {
  language: "zh-TW",
  text: "你好，這是 Vox 的提醒。打電話給牙醫。",
});
assert.deepEqual(reminderCallScript({ title: "Call the dentist", notes: "Ask about Friday" }), {
  language: "en-GB",
  text: "Hello, this is Vox with your reminder. Call the dentist. Ask about Friday.",
});
assert.equal(say("Tea <now>", "en-GB"), '<Say language="en-GB">Tea &lt;now&gt;</Say>');
const workerEntry = await readFile(new URL("../cloudflare/worker-entry.mjs", import.meta.url), "utf8");
const deployPrep = await readFile(new URL("../scripts/prepare-cloudflare-deploy.mjs", import.meta.url), "utf8");
const dispatchRoute = await readFile(
  new URL("../app/api/reminders/call-dispatch/route.ts", import.meta.url),
  "utf8",
);
assert.match(workerEntry, /async scheduled\(/u);
assert.match(workerEntry, /\/api\/reminders\/call-dispatch/u);
assert.match(deployPrep, /crons: \["\* \* \* \* \*"\]/u);
assert.match(dispatchRoute, /__voxSchedulerToken/u);
assert.match(dispatchRoute, /status: 404/u);

console.log("Conservative phone assistant checks passed.");
