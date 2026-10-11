import assert from "node:assert/strict";

const { secureFieldKind, secureFormFromArguments, secureInputProps, secureFillOutcome, SECURE_FILL_TOOL, MAX_SECURE_FIELDS } = await import("../lib/secure-fill.ts");

const el = (ref, label, hint = "", kind = "text field") => ({ ref, kind, label, hint });
assert.equal(secureFieldKind(el(0, "Password", "password current-password")), "password");
assert.equal(secureFieldKind(el(0, "密碼")), "password");
assert.equal(secureFieldKind(el(0, "Email or mobile phone number", "email")), "email");
assert.equal(secureFieldKind(el(0, "Username", "text username")), "username");
assert.equal(secureFieldKind(el(0, "Card number", "cc-number")), "card_number");
assert.equal(secureFieldKind(el(0, "MM / YY", "cc-exp")), "card_expiry");
assert.equal(secureFieldKind(el(0, "CVV", "cc-csc")), "card_code");
assert.equal(secureFieldKind(el(0, "Security code (CVV)")), "card_code");
assert.equal(secureFieldKind(el(0, "Enter verification code", "one-time-code")), "code");
assert.equal(secureFieldKind(el(0, "Name on card", "cc-name")), "name");
assert.equal(secureFieldKind(el(0, "Where to?")), "text");

const look = {
  url: "https://www.amazon.com/ap/signin",
  title: "Amazon Sign-In",
  text: "",
  elements: [el(0, "Email or mobile phone number", "email"), el(1, "Password‮ \n", "password"), el(2, "Sign in", "", "button"), el(3, "", "one-time-code")],
};
const form = secureFormFromArguments(JSON.stringify({ refs: [0, 1, 1, 2, 3, 99, -1, "x"] }), look);
assert.equal(form.host, "amazon.com");
assert.equal(form.secure, true);
// Buttons, unknown numbers and repeats are dropped; an unlabelled field gets a plain name.
assert.deepEqual(form.fields, [
  { ref: 0, kind: "email", label: "Email or mobile phone number" },
  { ref: 1, kind: "password", label: "Password" },
  { ref: 3, kind: "code", label: "Verification code" },
]);
assert.equal(secureFormFromArguments(JSON.stringify({ refs: [2] }), look), null, "only buttons: nothing to type");
assert.equal(secureFormFromArguments(JSON.stringify({ refs: [0] }), null), null, "the page must have been looked at");
assert.equal(secureFormFromArguments("nope", look), null);
assert.equal(secureFormFromArguments(JSON.stringify({ refs: [0] }), { ...look, url: "http://shop.example/login" }).secure, false);
assert.equal(secureFormFromArguments(JSON.stringify({ refs: Array.from({ length: 20 }, (_, i) => i) }), { ...look, elements: Array.from({ length: 20 }, (_, i) => el(i, `Field ${i}`)) }).fields.length, MAX_SECURE_FIELDS);

// Masked where it should be, and marked up so the system's own password and card autofill can help.
assert.deepEqual(secureInputProps("password"), { type: "password", autoComplete: "current-password" });
assert.equal(secureInputProps("card_code").type, "password");
assert.equal(secureInputProps("card_number").autoComplete, "cc-number");
assert.equal(secureInputProps("code").autoComplete, "one-time-code");

// The model is told what happened, never what was typed.
assert.match(secureFillOutcome(form, "filled", 2), /wrote them into 2 fields on amazon\.com\. You were not shown what they typed/u);
assert.match(secureFillOutcome(form, "cancelled"), /without filling it in/u);
assert.match(secureFillOutcome(form, "failed"), /couldn't be written/u);
assert.equal(SECURE_FILL_TOOL.name, "ask_user_to_fill");
assert.deepEqual(Object.keys(SECURE_FILL_TOOL.parameters.properties), ["refs"], "the tool has no way to carry a value");

// Fields left empty use what is saved, by reference: the box never holds a saved value.
{
  const { secureFillEntries, savedKindNames } = await import("../lib/secure-fill.ts");
  assert.deepEqual(secureFillEntries(form, { 3: "123456" }, { 0: true, 1: true }), [{ ref: 0, saved: true }, { ref: 1, saved: true }, { ref: 3, value: "123456" }]);
  assert.deepEqual(secureFillEntries(form, { 0: "new@example.com" }, { 0: true }), [{ ref: 0, value: "new@example.com" }], "typing replaces the saved one");
  assert.deepEqual(secureFillEntries(form, {}, {}), []);
  assert.equal(savedKindNames(["email", "password", "nope"]), "email, password");
}

// The store on the Mac: encrypted, sign-ins per site, card anywhere, codes never.
{
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createVault, fieldKind, vaultHost } = await import("../desktop/VoxDesktop/src/secure-vault.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vox-vault-"));
  const file = path.join(dir, "saved.bin");
  let on = true;
  const safeStorage = {
    isEncryptionAvailable: () => on,
    encryptString: (text) => Buffer.from(text, "utf8").map((byte) => byte ^ 0x5a),
    decryptString: (buffer) => Buffer.from(buffer).map((byte) => byte ^ 0x5a).toString("utf8"),
  };
  const vault = createVault({ file, safeStorage });
  assert.equal(vault.remember("amazon.com", "email", "me@example.com"), true);
  assert.equal(vault.remember("amazon.com", "password", "hunter2-secret"), true);
  assert.equal(vault.remember("amazon.com", "card_number", "4242424242424242"), true);
  assert.equal(vault.remember("amazon.com", "code", "123456"), false, "one-time codes are never kept");
  assert.equal(vault.remember("amazon.com", "card_code", "123"), false, "a card's security code is never kept");
  assert.equal(vault.remember("amazon.com", "text", "anything"), false);
  assert.equal(vault.remember("not a host", "password", "x"), false);
  assert.equal(vault.get("amazon.com", "password"), "hunter2-secret");
  assert.equal(vault.get("evil-amazon.com", "password"), "", "a sign-in belongs to its own site only");
  assert.equal(vault.get("uber.com", "card_number"), "4242424242424242", "the card is the same everywhere");
  const onDisk = fs.readFileSync(file);
  assert.ok(!onDisk.includes("hunter2") && !onDisk.includes("4242424242424242"), "nothing readable on disk");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(vault.list(), { available: true, sites: [{ host: "amazon.com", kinds: ["email", "password"] }], anywhere: ["card_number"] });
  assert.ok(!JSON.stringify(vault.list()).includes("hunter2"), "the list carries names, never values");
  assert.equal(vault.forget("amazon.com"), true);
  assert.equal(vault.get("amazon.com", "password"), "");
  assert.equal(vault.forget("anywhere"), true);
  assert.equal(vault.get("uber.com", "card_number"), "");
  on = false;
  assert.equal(vault.remember("amazon.com", "password", "x"), false, "without the keychain nothing is kept");
  assert.equal(vaultHost("https://www.amazon.com/ap/signin"), "amazon.com");
  assert.equal(vaultHost("http://amazon.com/"), "", "never over an insecure connection");
  assert.equal(vaultHost("https://user:pw@amazon.com/"), "");
  // The Mac app and the web app agree on what a field is.
  for (const about of ["password current-password", "email Email", "cc-number Card number", "cc-exp MM / YY", "cc-csc CVV", "one-time-code Enter code", "tel Phone", "text username", "Where to?"]) {
    assert.equal(fieldKind(about), secureFieldKind({ label: about, hint: "" }), about);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// How the built-in browser names itself to websites.
{
  const { browserUserAgent, browserLanguages } = await import("../desktop/VoxDesktop/src/browser-identity.mjs");
  assert.equal(
    browserUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) vox-desktop/0.9.14 Chrome/152.0.7977.130 Electron/44.4.3 Safari/537.36"),
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  );
  assert.equal(browserUserAgent("Mozilla/5.0 (X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Electron/44.4.3 Safari/537.36"), "Mozilla/5.0 (X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36");
  assert.equal(browserLanguages(["zh-Hant-TW", "en-US"]), "zh-TW,zh,en-US,en");
  assert.equal(browserLanguages(["ja-JP"]), "ja-JP,ja,en");
  assert.equal(browserLanguages(["bad tag\r\nX: y", 7]), "en");
}
// A look sent to the paired phone is cut to fit the relay, least important parts first.
{
  const { lookForRelay } = await import("../desktop/VoxDesktop/src/stage-browser-relay.mjs");
  const big = { url: "https://shop.example/x", title: "訂單", text: "字".repeat(6000), elements: Array.from({ length: 90 }, (_, ref) => ({ ref, kind: "button", label: "按鈕".repeat(60), value: "值".repeat(60), hint: "x".repeat(80) })) };
  const cut = lookForRelay(big);
  assert.ok(Buffer.byteLength(JSON.stringify(cut), "utf8") <= 20_000);
  assert.ok(cut.elements.length >= 10 && cut.elements[0].ref === 0 && cut.text.length >= 200);
  assert.deepEqual(lookForRelay({ url: "https://a.example/", title: "A", text: "hello", elements: [{ ref: 0, kind: "link", label: "Home", value: "", hint: "" }] }), { url: "https://a.example/", title: "A", text: "hello", elements: [{ ref: 0, kind: "link", label: "Home", value: "", hint: "" }] });
  assert.equal(lookForRelay(null), null);
}

// A page showing a sign-in: the app finds the fields itself (STARLUX's form, as Vox sees it).
{
  const { signInRefsFromLook } = await import("../lib/secure-fill.ts");
  const starlux = { url: "https://www.starlux-airlines.com/zh-TW", title: "", text: "", elements: [el(13, "登入", "", "button"), el(15, "COSMILE ID或電子信箱", ""), el(16, "密碼", "password currect-password"), el(19, "登入", "", "button")] };
  assert.deepEqual(signInRefsFromLook(starlux), [15, 16]);
  const made = secureFormFromArguments(JSON.stringify({ refs: signInRefsFromLook(starlux) }), starlux);
  assert.deepEqual(made.fields.map((field) => field.kind), ["email", "password"]);
  assert.equal(made.host, "starlux-airlines.com");
  // A search box far above the password is not who is signing in; a page with no password has no sign-in.
  assert.deepEqual(signInRefsFromLook({ ...starlux, elements: [el(2, "搜尋", "search"), el(16, "密碼", "password")] }), [16]);
  assert.deepEqual(signInRefsFromLook({ ...starlux, elements: [el(15, "搜尋航班", "search"), el(16, "密碼", "password")] }), [16]);
  assert.equal(signInRefsFromLook({ ...starlux, elements: [el(1, "Where to?"), el(2, "Search", "", "button")] }), null);
  assert.equal(signInRefsFromLook(null), null);
}

console.log("Secure fill checks passed.");
