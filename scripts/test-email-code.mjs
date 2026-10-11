import assert from "node:assert/strict";

const { registrableDomain, senderDomain, sentBySite, parseMailSearch, extractCode, recentFromSite, emailCodeOutcome, EMAIL_CODE_TOOL } = await import("../lib/email-code.ts");

assert.equal(registrableDomain("www.starlux-airlines.com"), "starlux-airlines.com");
assert.equal(registrableDomain("mail.starlux-airlines.com"), "starlux-airlines.com");
assert.equal(registrableDomain("ecvip.pchome.com.tw"), "pchome.com.tw");
assert.equal(registrableDomain("com.tw"), "", "a public suffix alone is nobody's site");
assert.equal(registrableDomain("localhost"), "");
assert.equal(senderDomain("STARLUX Airlines <no-reply@mail.starlux-airlines.com>"), "mail.starlux-airlines.com");
assert.equal(senderDomain("noreply@uber.com"), "uber.com");
assert.equal(senderDomain("Just A Name"), "");

// A code only goes to the site that sent it.
assert.equal(sentBySite("STARLUX <no-reply@mail.starlux-airlines.com>", "www.starlux-airlines.com"), true);
assert.equal(sentBySite("STARLUX <no-reply@starlux-airlines.com.evil.example>", "www.starlux-airlines.com"), false);
assert.equal(sentBySite("Your Bank <alerts@bank.example>", "www.starlux-airlines.com"), false, "another service's code is never offered to this page");
assert.equal(sentBySite("STARLUX <no-reply@starlux-airlines.com>", "evil.example"), false);
assert.equal(sentBySite("\"starlux-airlines.com\" <a@evil.example>", "starlux-airlines.com"), false, "the display name proves nothing");

for (const [text, code] of [
  ["您的驗證碼為 482913，請於 10 分鐘內輸入。", "482913"],
  ["Your verification code is 482 913. It expires in 10 minutes.", "482913"],
  ["Use code 7741 to sign in to your account.", "7741"],
  ["482913 is your STARLUX verification code", "482913"],
  ["STARLUX 會員登入驗證碼：19283746", "19283746"],
  ["Hello, 2026-10-10 12:30, order 123456789012 shipped. Call 0800-123-456.", ""],
  ["Two numbers 123456 and 654321 with no hint.", ""],
  ["One-time passcode: 55-66-77", "556677"],
  ["No digits here at all", ""],
]) assert.equal(extractCode(text), code, text);

const search = [
  "Found 3 messages.",
  "1. id=m:a1:101 account=me@kimo.com (unread)",
  "   From: STARLUX Airlines <no-reply@mail.starlux-airlines.com> | To: me@kimo.com",
  "   Date: 2026-10-10T03:00:30.000Z",
  "   Subject: STARLUX 驗證碼通知",
  "   Snippet: 您的驗證碼為 482913，請於 10 分鐘內輸入。",
  "2. id=m:a1:100 account=me@kimo.com",
  "   From: Your Bank <alerts@bank.example> | To: me@kimo.com",
  "   Date: 2026-10-10T03:00:50.000Z",
  "   Subject: Your code is 999999",
  "3. id=m:a1:099 account=me@kimo.com",
  "   From: STARLUX Airlines <no-reply@mail.starlux-airlines.com> | To: me@kimo.com",
  "   Date: 2026-10-10T01:00:00.000Z",
  "   Subject: 舊的驗證碼 111111",
].join("\n");
const parsed = parseMailSearch(search);
assert.deepEqual(parsed.map((message) => message.id), ["m:a1:101", "m:a1:100", "m:a1:099"]);
assert.equal(parsed[0].from, "STARLUX Airlines <no-reply@mail.starlux-airlines.com>");
assert.equal(parsed[0].snippet, "您的驗證碼為 482913，請於 10 分鐘內輸入。");
const now = Date.parse("2026-10-10T03:02:00.000Z");
// Only this site's email, only a recent one: not the bank's newer code, not the old one.
assert.deepEqual(recentFromSite(parsed, "www.starlux-airlines.com", now).map((message) => message.id), ["m:a1:101"]);
assert.deepEqual(recentFromSite(parsed, "bank.example", now).map((message) => message.id), ["m:a1:100"]);
assert.deepEqual(recentFromSite(parsed, "evil.example", now), []);

// The model is told what happened and never the code; the tool cannot carry one either.
assert.ok(!/\d{4,}/u.test(emailCodeOutcome("filled", "starlux-airlines.com")));
assert.match(emailCodeOutcome("no_email", "starlux-airlines.com"), /ask_user_to_fill/u);
assert.deepEqual(Object.keys(EMAIL_CODE_TOOL.parameters.properties), ["ref"]);

console.log("Email code checks passed.");
