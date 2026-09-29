import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [webhook, setup, store, conversationRoute, page, proxy] = await Promise.all([
  read("app/api/twilio/sms/route.ts"),
  read("app/api/phone-assistant/texts/route.ts"),
  read("lib/conversation-store.ts"),
  read("app/api/conversation/route.ts"),
  read("app/page.tsx"),
  read("desktop/VoxDesktop/src/local-web-server.mjs"),
]);

// Only Twilio can add a text, each text is kept once, and Vox never replies.
assert.match(webhook, /if \(!\(await validateTwilioRequest\(request, form\)\)\) \{\n\s+return new Response\("Forbidden", \{ status: 403 \}\);/u);
assert.match(webhook, /\/\^\(SM\|MM\)\[a-f0-9\]\{32\}\$\/iu/u);
assert.match(webhook, /id: `sms-\$\{messageSid\.toLowerCase\(\)\}`/u);
assert.match(webhook, /return twiml\(""\);/u);
assert.doesNotMatch(webhook, /<Message/u);
// Texts are encrypted with the rest of the conversation and can't be relabelled.
assert.match(store, /encryptText\(JSON\.stringify\(\{ from: text\.from, body: text\.body \}\)\)/u);
assert.match(store, /ON CONFLICT\(id\) DO NOTHING/u);
assert.match(store, /AND source NOT IN \('sms', 'caller'\)/u);
// A signed-in client can only save its own "local" messages.
assert.match(conversationRoute, /source: "local",/u);
// Turning texts on is owner-only.
assert.equal(setup.match(/auth\.user\.role !== "master"/gu)?.length, 2);
// A live conversation hears about a text only as labelled, untrusted content.
assert.match(page, /\$\{contextText\(\{ role: "assistant", text: text\.text, source: "sms", sender: text\.sender \}\)\}/u);
assert.match(proxy, /\["\/api\/phone-assistant\/texts", new Set\(\["GET", "POST"\]\)\]/u);
console.log("Incoming text checks passed.");

// Read status lives on the account, so every device and every launch agrees.
{
  const [store, readRoute, page, proxy] = await Promise.all([
    read("lib/conversation-store.ts"),
    read("app/api/conversation/read/route.ts"),
    read("app/page.tsx"),
    read("desktop/VoxDesktop/src/local-web-server.mjs"),
  ]);
  assert.match(store, /SET read_at = \$\{new Date\(\)\.toISOString\(\)\}\n\s+WHERE owner_id = \$\{ownerId\}\n\s+AND source IN \('sms', 'caller'\)/u);
  assert.match(store, /read: Boolean\(record\.readAt\)/u);
  assert.match(readRoute, /markConversationRead\(auth\.user\.id, ids\)/u);
  assert.match(page, /fetch\("\/api\/conversation\/read"/u);
  assert.doesNotMatch(page, /vox\.dismissedTexts/u);
  // A sync that lands before the server has the change doesn't undo it.
  assert.match(page, /if \(!pendingReadRef\.current\.has\(message\.id\)\) return message;/u);
  assert.match(proxy, /\["\/api\/conversation\/read", new Set\(\["POST"\]\)\]/u);
  console.log("Read status checks passed.");
}
