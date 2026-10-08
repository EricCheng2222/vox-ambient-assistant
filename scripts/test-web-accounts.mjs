import assert from "node:assert/strict";

const { WEB_ACCOUNT_SERVICES, WEB_ACCOUNT_CATEGORIES, webAccountChecks, looksSignedIn, webAccountsInstruction } = await import("../lib/web-accounts.ts");

// The catalogue is well formed: unique, https, and each sign-in page is on one of the service's own domains.
assert.ok(WEB_ACCOUNT_SERVICES.length >= 40 && WEB_ACCOUNT_SERVICES.length <= 60);
assert.equal(new Set(WEB_ACCOUNT_SERVICES.map((item) => item.id)).size, WEB_ACCOUNT_SERVICES.length);
assert.equal(new Set(WEB_ACCOUNT_SERVICES.map((item) => item.name)).size, WEB_ACCOUNT_SERVICES.length);
for (const item of WEB_ACCOUNT_SERVICES) {
  const url = new URL(item.url);
  assert.equal(url.protocol, "https:", item.id);
  assert.ok(!url.username && !url.password, item.id);
  assert.ok(item.domains.length > 0 && item.domains.every((domain) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/u.test(domain)), item.id);
  assert.ok(item.domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)), `${item.id}: sign-in page is on its own domain`);
  assert.ok(WEB_ACCOUNT_CATEGORIES.includes(item.category), item.id);
  assert.match(item.id, /^[a-z0-9-]{1,24}$/u);
}
// No banks or payment services: Vox doesn't move money.
assert.ok(!WEB_ACCOUNT_SERVICES.some((item) => /paypal|bank|stripe|wise|revolut|venmo|binance|coinbase/iu.test(`${item.id} ${item.name}`)));
assert.deepEqual(Object.keys(webAccountChecks()[0]).sort(), ["cookies", "domains", "id"]);

// A service's own sign-in cookie is exact.
assert.equal(looksSignedIn(["session-id", "ubid-main", "at-main"], ["at-main", "x-main"]), true);
assert.equal(looksSignedIn(["session-id", "ubid-main"], ["at-main", "x-main"]), false, "Amazon sets session-id for every visitor");
// Without one, it is a careful guess from the names.
assert.equal(looksSignedIn(["_ga", "csrf_token", "locale", "cf_clearance"]), false);
assert.equal(looksSignedIn(["auth_token", "_ga"]), true);
assert.equal(looksSignedIn(["user_session"]), true);
assert.equal(looksSignedIn(["guest_session_id", "visitor_token"]), false);
assert.equal(looksSignedIn([]), false);

assert.match(webAccountsInstruction(["amazon", "uber"]), /signed in to these websites[^:]*: Amazon, Uber\./u);
assert.match(webAccountsInstruction([]), /they sign in themselves/u);
assert.ok(!webAccountsInstruction(["nope"]).includes("nope"));

console.log("Web account checks passed.");
