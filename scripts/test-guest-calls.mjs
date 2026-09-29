import assert from "node:assert/strict";

// Simulates a phone call through the call controller: a fake OpenAI socket and
// a fake Vox server, so we can see what Vox does for an unverified caller.
const { SipCallDurableObject } = await import("../cloudflare/sip-call-durable-object.mjs");

function harness({ guestAllowed = true, owner = false } = {}) {
  const sent = [];
  const internal = [];
  const openai = [];
  let alarmAt = null;
  const listeners = {};
  const socket = {
    readyState: 1,
    accept() {},
    send: (data) => sent.push(JSON.parse(data)),
    close() {},
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  const storage = new Map();
  const state = {
    storage: {
      get: async (key) => storage.get(key),
      put: async (key, value) => { storage.set(key, value); },
      setAlarm: async (at) => { alarmAt = at; },
      deleteAlarm: async () => { alarmAt = null; },
    },
    waitUntil: () => {},
  };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("/api/openai/realtime-sip/internal")) {
      const body = JSON.parse(init.body);
      internal.push(body);
      if (body.action === "authenticate") {
        return owner
          ? Response.json({ authenticated: true, instructions: "owner", carryover: "" })
          : Response.json({ authenticated: false, guest: guestAllowed }, { status: 401 });
      }
      return Response.json({ saved: true });
    }
    openai.push(target);
    if (target.includes("/v1/realtime?call_id=")) return { ok: true, status: 101, webSocket: socket };
    return new Response("{}", { status: 200 });
  };
  const call = new SipCallDurableObject(state, { OPENAI_API_KEY: "sk-test", VOX_CONTACT_SECRET: "secret" });
  return { call, sent, internal, openai, storage, alarm: () => alarmAt };
}

const event = (value) => JSON.stringify(value);
const callId = "rtc_test12345678";

// ---- An unverified caller gets Vox as the owner's assistant ----
{
  const h = harness();
  await h.call.start({ callId, origin: "https://vox.example", voice: "marin", caller: '"+15551234567" <sip:+15551234567@pstn>' });
  // The greeting never mentions verification.
  const greeting = h.sent.find((item) => item.type === "response.create");
  assert.match(greeting.response.instructions, /English and then in natural Taiwan Mandarin/u);
  assert.match(greeting.response.instructions, /Never mention verification or passwords/u);
  await h.call.handleServerEvent(event({ type: "response.output_audio_transcript.done", transcript: "Hi, this is Vox. 你好，我是 Vox。", response_id: "resp_1" }));

  const started = Date.now();
  await h.call.handleServerEvent(event({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hi, is Eric there? It's about the lab.", item_id: "item_1" }));
  const update = h.sent.find((item) => item.type === "session.update");
  assert.match(update.session.instructions, /has not been verified/u);
  assert.match(update.session.instructions, /reply in the language the caller is speaking/u);
  assert.deepEqual(update.session.tools, []);
  assert.equal(update.session.tool_choice, "none");
  assert.equal(h.sent.at(-1).type, "response.create");
  // The greeting and the caller's first words go to the stream as the caller's call.
  const synced = h.internal.filter((item) => item.action === "guest_sync");
  assert.deepEqual(synced.map((item) => [item.role, item.transcript, item.caller]), [
    ["assistant", "Hi, this is Vox. 你好，我是 Vox。", "+15551234567"],
    ["user", "Hi, is Eric there? It's about the lab.", "+15551234567"],
  ]);
  assert.ok(synced.every((item) => /^guest_[A-Za-z0-9_-]{8,170}$/u.test(item.messageId)));
  // Wrap-up is scheduled about 78 s in, never past 90 s.
  assert.ok(h.alarm() - started >= 77_000 && h.alarm() - started <= 79_000, `${h.alarm() - started}`);
  assert.equal(h.storage.get("call").guest, true);

  // Later lines keep syncing, including Vox's replies, and never as the owner's.
  await h.call.handleServerEvent(event({ type: "conversation.item.input_audio_transcription.completed", transcript: "我叫小明", item_id: "item_2" }));
  await h.call.handleServerEvent(event({ type: "response.output_audio_transcript.done", transcript: "好的，小明，我會轉達。", response_id: "resp_2" }));
  assert.equal(h.internal.filter((item) => item.action === "sync").length, 0);
  assert.equal(h.internal.filter((item) => item.action === "guest_sync").length, 4);

  // At the wrap-up time, while Vox is mid-sentence, the goodbye waits for it.
  await h.call.handleServerEvent(event({ type: "response.created" }));
  await h.call.alarm();
  assert.ok(!h.sent.some((item) => item.response?.instructions?.startsWith("Time is almost up")));
  await h.call.handleServerEvent(event({ type: "response.done" }));
  assert.match(h.sent.at(-1).response.instructions, /^Time is almost up/u);
  assert.ok(!h.openai.some((url) => url.endsWith("/hangup")));
  // The goodbye ends the call.
  await h.call.handleServerEvent(event({ type: "response.done" }));
  assert.ok(h.openai.some((url) => url.endsWith("/hangup")));
}

// ---- The line closes at the limit even if the goodbye never finishes ----
{
  const h = harness();
  await h.call.start({ callId, origin: "https://vox.example", caller: "+15551234567" });
  await h.call.handleServerEvent(event({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello", item_id: "a" }));
  await h.call.alarm();
  assert.match(h.sent.at(-1).response.instructions, /^Time is almost up/u);
  h.call.guestDeadline = Date.now() - 1;
  await h.call.alarm();
  assert.ok(h.openai.some((url) => url.endsWith("/hangup")));
}

// ---- With the phone assistant off, an unverified caller is still turned away ----
{
  const h = harness({ guestAllowed: false });
  await h.call.start({ callId, origin: "https://vox.example", caller: "+15551234567" });
  await h.call.handleServerEvent(event({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello", item_id: "a" }));
  assert.ok(!h.sent.some((item) => item.type === "session.update"));
  assert.equal(h.call.hangupAfterResponse, true);
  assert.equal(h.internal.filter((item) => item.action === "guest_sync").length, 0);
}

// ---- The owner's private sentence still unlocks the full assistant ----
{
  const h = harness({ owner: true });
  await h.call.start({ callId, origin: "https://vox.example", caller: "+15551234567" });
  await h.call.handleServerEvent(event({ type: "conversation.item.input_audio_transcription.completed", transcript: "my private sentence", item_id: "a" }));
  const update = h.sent.find((item) => item.type === "session.update");
  assert.equal(update.session.instructions, "owner");
  assert.ok(update.session.tools.length > 0);
  assert.equal(h.call.guest, false);
}

console.log("Guest call checks passed.");
