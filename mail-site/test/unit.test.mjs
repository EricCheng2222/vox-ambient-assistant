import assert from "node:assert/strict";

import { parseBuilt } from "./helpers.mjs";

// Pure pieces: MIME building and parsing, reply headers, HTML to text, the
// search translator, account-qualified ids, IMAP tokens and folder names,
// SMTP dot-stuffing, secret binding, and socket guards.

const mime = await import("../src/mime.ts");
const message = await import("../src/message.ts");
const utf8 = (bytes) => new TextDecoder().decode(bytes);

// ---- MIME ----
{
  const subject = "會議記錄：下週一的安排與準備事項（請在星期五前確認，謝謝大家的協助）";
  const built = mime.buildMessage({
    to: mime.requireAddresses('王小明 <ming@example.com>, "Lee, Amy" <amy@example.com>', "to"),
    cc: mime.requireAddresses("bob@example.com", "cc"),
    subject,
    body: "你好，\n明天見。\nSee you tomorrow.",
  });
  assert.match(built, /^[\x00-\x7f]*$/u, "the message is plain ASCII");
  const rawSubject = /^Subject: ([\s\S]*?)\r\n(?! )/mu.exec(built)[1];
  const words = rawSubject.split("\r\n ");
  assert.ok(words.length > 1, "a long subject folds into several encoded words");
  for (const word of words) {
    assert.match(word, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/u);
    assert.ok(word.length <= 75, `encoded word too long: ${word.length}`);
  }
  // Each word decodes on its own (no character split across words).
  assert.equal(words.map((word) => mime.decodeHeaderText(word)).join(""), subject);
  assert.equal(mime.decodeHeaderText(rawSubject.replace(/\r\n /g, " ")), subject);
  const { headers, body } = parseBuilt(built);
  assert.equal(headers["mime-version"], "1.0");
  assert.equal(headers["content-type"], 'text/plain; charset="UTF-8"');
  assert.equal(headers["content-transfer-encoding"], "base64");
  assert.equal(utf8(Buffer.from(body, "base64")), "你好，\r\n明天見。\r\nSee you tomorrow.");
  assert.ok(body.split("\r\n").every((line) => line.length <= 76));
  assert.match(headers.to, /^=\?UTF-8\?B\?[^?]+\?= <ming@example\.com>, "Lee, Amy" <amy@example\.com>$/u);
  assert.equal(mime.decodeHeaderText(headers.to.split(" <")[0]), "王小明");
  assert.equal(headers.cc, "bob@example.com");

  // No header injection through user text.
  const injected = mime.buildMessage({ to: [{ name: "", email: "a@example.com" }], subject: "Hi\r\nBcc: evil@example.com", body: "x" });
  assert.equal(parseBuilt(injected).headers.bcc, undefined);
  assert.equal(parseBuilt(injected).headers.subject, "Hi Bcc: evil@example.com");
  assert.throws(() => mime.requireAddresses("not an address", "to"), /not an email address/u);
  assert.throws(() => mime.requireAddresses("a@example.com\r\nBcc: b@example.com", "to"), /not an email address/u);

  // raw is base64url of the whole message.
  const raw = mime.toRaw(built);
  assert.doesNotMatch(raw, /[+/=]/u);
  assert.equal(Buffer.from(raw, "base64url").toString("utf8"), built);

  // Attachments: multipart/mixed with RFC 2231 names.
  const withFile = mime.buildMessage({
    to: [{ name: "", email: "a@example.com" }],
    subject: "Files",
    body: "See attached.",
    attachments: [{ filename: "報告.pdf", mimeType: "application/pdf", data: new Uint8Array([1, 2, 3]) }],
  });
  assert.match(withFile, /Content-Type: multipart\/mixed; boundary="vox-mail-/u);
  assert.match(withFile, /filename\*=UTF-8''%E5%A0%B1%E5%91%8A\.pdf/u);
  assert.match(withFile, /\r\nAQID\r\n/u);
  assert.equal(mime.decodeHeaderText("=?ISO-8859-1?Q?caf=E9_au_lait?="), "café au lait");
}

// ---- Reply headers ----
{
  assert.equal(mime.replySubject("Lunch?"), "Re: Lunch?");
  assert.equal(mime.replySubject("Re: Lunch?"), "Re: Lunch?");
  assert.equal(mime.replySubject("RE: Lunch?"), "RE: Lunch?");
  assert.equal(mime.replySubject("回覆：午餐"), "回覆：午餐");
  assert.equal(mime.replySubject("Regarding lunch"), "Re: Regarding lunch");
  assert.equal(mime.forwardSubject("Lunch?"), "Fwd: Lunch?");
  assert.equal(mime.forwardSubject("Fwd: Lunch?"), "Fwd: Lunch?");
  assert.equal(mime.replyReferences("<a@x> <b@x>", "<c@x>"), "<a@x> <b@x> <c@x>");
  assert.equal(mime.replyReferences("", "<c@x>"), "<c@x>");
  assert.equal(mime.replyReferences("<c@x>", "<c@x>"), "<c@x>");
  const long = Array.from({ length: 30 }, (_, index) => `<m${index}@x>`).join(" ");
  const trimmed = mime.replyReferences(long, "<new@x>").split(" ");
  assert.equal(trimmed.length, 20);
  assert.equal(trimmed[0], "<m0@x>");
  assert.equal(trimmed.at(-1), "<new@x>");

  const original = { from: "Amy <amy@example.com>", replyTo: "", to: "me@gmail.com, Bob <bob@example.com>", cc: "carol@example.com, ME@gmail.com" };
  const direct = mime.replyRecipients(original, "me@gmail.com", false);
  assert.deepEqual(direct.to.map((address) => address.email), ["amy@example.com"]);
  assert.deepEqual(direct.cc, []);
  const all = mime.replyRecipients(original, "me@gmail.com", true);
  assert.deepEqual(all.to.map((address) => address.email), ["amy@example.com"]);
  assert.deepEqual(all.cc.map((address) => address.email), ["bob@example.com", "carol@example.com"]);
  const listReply = mime.replyRecipients({ ...original, replyTo: "list@example.com" }, "me@gmail.com", false);
  assert.deepEqual(listReply.to.map((address) => address.email), ["list@example.com"]);
  // Replying to your own sent message goes to its recipients.
  const mine = mime.replyRecipients({ from: "Me <me@gmail.com>", replyTo: "", to: "amy@example.com", cc: "bob@example.com" }, "me@gmail.com", true);
  assert.deepEqual(mine.to.map((address) => address.email), ["amy@example.com"]);
  assert.deepEqual(mine.cc.map((address) => address.email), ["bob@example.com"]);

  const reply = parseBuilt(
    mime.buildMessage({
      to: direct.to,
      subject: mime.replySubject("Lunch?"),
      body: "Sure",
      inReplyTo: "<orig@mail.example.com>",
      references: mime.replyReferences("<root@x>", "<orig@mail.example.com>"),
    }),
  ).headers;
  assert.equal(reply["in-reply-to"], "<orig@mail.example.com>");
  assert.equal(reply.references, "<root@x> <orig@mail.example.com>");
  assert.equal(reply.subject, "Re: Lunch?");
  assert.match(mime.quoteOriginal("Mon, 28 Sep 2026", "Amy", "line one\n\nline two"), /^On Mon, 28 Sep 2026, Amy wrote:\n> line one\n>\n> line two$/u);
}

// ---- HTML to text ----
{
  const html = `<html><head><title>T</title><style>p { color: red }</style></head><body>
    <div style="display:none">Hidden preview text</div>
    <script>alert(1)</script><!-- comment -->
    <h1>Order&nbsp;shipped</h1>
    <p>Hi Amy,<br>Your order <b>#123</b> is on its way &amp; arrives Friday.</p>
    <ul><li>Tea</li><li>Cups &#39;n&#39; saucers</li></ul>
    <table><tr><td>Total</td><td>NT$&#x20;500</td></tr></table>
    <p><a href="https://shop.example/track">Track it</a> · <a href="https://click.example/${"x".repeat(200)}">Manage preferences</a></p>
    <p>&#x4F60;&#22909;​‌</p><img src="x.png" alt="logo">
  </body></html>`;
  const text = message.htmlToText(html);
  assert.equal(
    text,
    [
      "Order shipped",
      "",
      "Hi Amy,",
      "Your order #123 is on its way & arrives Friday.",
      "",
      "- Tea",
      "- Cups 'n' saucers",
      "",
      "Total NT$ 500",
      "",
      "Track it (https://shop.example/track) · Manage preferences",
      "",
      "你好",
    ].join("\n"),
  );
  assert.doesNotMatch(text, /Hidden|alert|comment|color|logo/u);

  // text/plain wins; a stub text part loses to the HTML.
  const part = (mimeType, body, charset = "utf-8") => ({
    mimeType,
    headers: [{ name: "Content-Type", value: `${mimeType}; charset="${charset}"` }],
    body: { data: Buffer.from(body, charset === "utf-8" ? "utf8" : "latin1").toString("base64url"), size: body.length },
  });
  const full = "<p>" + "A real newsletter paragraph with plenty of words. ".repeat(10) + "</p>";
  assert.equal(message.messageText({ mimeType: "multipart/alternative", parts: [part("text/plain", "Plain body"), part("text/html", "<p>HTML body</p>")] }), "Plain body");
  assert.match(message.messageText({ mimeType: "multipart/alternative", parts: [part("text/plain", "View in browser"), part("text/html", full)] }), /^A real newsletter/u);
  assert.equal(message.messageText(part("text/plain", "café", "iso-8859-1")), "café");
  const attachments = message.listAttachments({
    mimeType: "multipart/mixed",
    parts: [part("text/plain", "hi"), { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "att1", size: 1_300_000 } }],
  });
  assert.deepEqual(attachments.map((item) => [item.filename, message.formatSize(item.size)]), [["a.pdf", "1.2 MB"]]);

  const truncated = message.truncate("word ".repeat(5000), 12_000);
  assert.ok(truncated.length < 12_100);
  assert.match(truncated, /more characters not shown\]$/u);
  assert.equal(message.stripQuoted("Thanks!\n\nOn Mon, Sep 28, 2026 at 10:00 AM Amy <amy@example.com> wrote:\n> earlier"), "Thanks!");
  assert.equal(message.stripQuoted("好的\n\nAmy 於 2026年9月28日 週一 寫道：\n> 之前"), "好的");
}

// ---- Raw MIME (IMAP) ----
{
  const raw = [
    "From: =?UTF-8?B?5bqX5a62?= <shop@example.com>",
    "Subject: =?UTF-8?Q?Caf=C3=A9_receipt?=",
    "Message-ID: <r1@example.com>",
    "References: <root@example.com>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="outer"',
    "",
    "preamble",
    "--outer",
    'Content-Type: multipart/alternative; boundary="inner"',
    "",
    "--inner",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Caf=C3=A9 total: NT$=20500=",
    " thanks",
    "--inner",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("<p>Café total</p>").toString("base64"),
    "--inner--",
    "--outer",
    "Content-Type: application/pdf; name=\"x.pdf\"",
    "Content-Disposition: attachment; filename*=UTF-8''%E6%94%B6%E6%93%9A.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("%PDF-1.4 hello").toString("base64"),
    "--outer--",
    "epilogue",
  ].join("\r\n");
  const part = message.parseMime(new TextEncoder().encode(raw));
  assert.equal(message.header(part, "subject"), "Café receipt");
  assert.equal(message.header(part, "from"), "店家 <shop@example.com>");
  assert.equal(part.mimeType, "multipart/mixed");
  assert.equal(message.messageText(part), "Café total: NT$ 500 thanks");
  const attachments = message.listAttachments(part);
  assert.deepEqual(attachments.map((item) => [item.filename, item.mimeType, item.size]), [["收據.pdf", "application/pdf", 14]]);
  assert.equal(Buffer.from(attachments[0].data, "base64url").toString(), "%PDF-1.4 hello");
  assert.equal(message.parseHeaderParams('attachment; filename*0*=UTF-8\'\'%E5%A0%B1; filename*1="告.txt"').params.filename, "報告.txt");
  // A message with no MIME headers is plain text.
  assert.equal(message.messageText(message.parseMime(new TextEncoder().encode("Subject: hi\r\n\r\nJust text\r\n"))), "Just text");
}

// ---- Search translation ----
{
  const { parseQuery, imapDate } = await import("../src/query.ts");
  const now = new Date("2026-09-29T00:00:00Z");
  const parsed = parseQuery('from:amy subject:"lunch plan" is:unread is:starred newer_than:7d before:2026/09/28 has:attachment in:sent 發票 -spam OR "exact phrase"', now);
  assert.deepEqual(parsed.from, ["amy"]);
  assert.deepEqual(parsed.subject, ["lunch plan"]);
  assert.deepEqual(parsed.text, ["發票", "exact phrase"]);
  assert.equal(parsed.unread, true);
  assert.equal(parsed.starred, true);
  assert.equal(parsed.after.toISOString(), "2026-09-22T00:00:00.000Z");
  assert.equal(parsed.before.toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(parsed.hasAttachment, true);
  assert.equal(parsed.folder, "sent");
  assert.equal(imapDate(new Date("2026-09-05T00:00:00Z")), "5-Sep-2026");
}

// ---- Account-qualified ids ----
{
  const { qualify, unqualify } = await import("../src/ids.ts");
  const id = qualify("m", "abcd1234", "1700000000:42:工作/收據");
  assert.match(id, /^m\.abcd1234\.[A-Za-z0-9_-]+$/u);
  assert.deepEqual(unqualify(id, "m"), { accountId: "abcd1234", native: "1700000000:42:工作/收據" });
  assert.throws(() => unqualify(id, "t"), /valid thread id/u, "the kind must match");
  assert.throws(() => unqualify(id.replace("abcd1234", "ABCD1234"), "m"), /valid message id/u);
  assert.throws(() => unqualify(`${id}=`, "m"), /valid message id/u);
  assert.throws(() => unqualify("m.abcd1234.QR", "m"), /valid message id/u, "non-canonical base64 (QR decodes like QQ) is refused");
  assert.throws(() => unqualify("m.abcd1234.gA", "m"), /valid message id/u, "invalid UTF-8 is refused");
  assert.throws(() => unqualify("18c2a3b4c5d6e7f8", "m"), /valid message id/u, "bare provider ids are refused");
  assert.throws(() => unqualify({ id }, "m"), /valid message id/u);
}

// ---- IMAP tokens and modified UTF-7 ----
{
  const imap = await import("../src/imap.ts");
  // The example from RFC 3501 5.1.3.
  assert.equal(imap.decodeMailboxName("~peter/mail/&U,BTFw-/&ZeVnLIqe-"), "~peter/mail/台北/日本語");
  assert.equal(imap.encodeMailboxName("~peter/mail/台北/日本語"), "~peter/mail/&U,BTFw-/&ZeVnLIqe-");
  assert.equal(imap.encodeMailboxName("工作/收據"), "&XeVPXA-/&ZTZk2g-");
  assert.equal(imap.encodeMailboxName("Réunions & Co"), "R&AOk-unions &- Co");
  assert.equal(imap.decodeMailboxName("R&AOk-unions &- Co"), "Réunions & Co");
  assert.equal(imap.decodeMailboxName(imap.encodeMailboxName("😀 Emoji")), "😀 Emoji");
  const body = new TextEncoder().encode("Subject: 你好\r\n\r\nhi");
  const values = imap.parseValues(['* 3 FETCH (UID 42 FLAGS (\\Seen $Label) BODY[HEADER.FIELDS (REFERENCES)] "" BODY[]<0> ', body, ' ENVELOPE ("date" NIL (("Amy" NIL "amy" "example.com")) NIL))']);
  assert.deepEqual(values.slice(0, 3), ["*", "3", "FETCH"]);
  const data = values[3];
  assert.deepEqual(data.slice(0, 4), ["UID", "42", "FLAGS", ["\\Seen", "$Label"]]);
  assert.equal(data[4], "BODY[HEADER.FIELDS (REFERENCES)]");
  assert.equal(data[5], "");
  assert.equal(data[6], "BODY[]<0>");
  assert.equal(new TextDecoder().decode(data[7]), "Subject: 你好\r\n\r\nhi");
  assert.deepEqual(data[9], ["date", null, [["Amy", null, "amy", "example.com"]], null]);
  assert.deepEqual(imap.readEnvelope(['Mon, 28 Sep 2026', "=?UTF-8?B?5L2g5aW9?=", [["Amy", null, "amy", "example.com"]], null, null, [[null, null, "me", "icloud.com"]], null, null, null, "<m@x>"]), {
    date: "Mon, 28 Sep 2026",
    subject: "你好",
    from: "Amy <amy@example.com>",
    replyTo: "",
    to: "me@icloud.com",
    cc: "",
    inReplyTo: "",
    messageId: "<m@x>",
  });
  assert.equal(imap.imapString('a "quoted" \\ value'), '"a \\"quoted\\" \\\\ value"');
  assert.deepEqual(imap.imapString("密碼"), { literal: new TextEncoder().encode("密碼") });
}

// ---- SMTP dot-stuffing ----
{
  const { dotStuff } = await import("../src/smtp.ts");
  const stuffed = new TextDecoder().decode(dotStuff(new TextEncoder().encode(".starts with a dot\nmiddle\n.\n..two")));
  assert.equal(stuffed, "..starts with a dot\r\nmiddle\r\n..\r\n...two\r\n.\r\n");
}

// ---- Secrets are bound to the user and the account ----
{
  const { sealSecret, openSecret } = await import("../src/accounts.ts");
  const env = { MAIL_TOKEN_SECRET: "test-secret" };
  const owner = { userId: "user-1", id: "acct0001" };
  const sealed = await sealSecret(env, owner, "app-password");
  assert.equal(await openSecret(env, owner, sealed.ciphertext, sealed.iv), "app-password");
  await assert.rejects(openSecret(env, { userId: "user-1", id: "acct0002" }, sealed.ciphertext, sealed.iv), "another account of the same user");
  await assert.rejects(openSecret(env, { userId: "user-2", id: "acct0001" }, sealed.ciphertext, sealed.iv), "the same account id for another user");
  await assert.rejects(openSecret({ MAIL_TOKEN_SECRET: "other" }, owner, sealed.ciphertext, sealed.iv), "another site secret");
  await assert.rejects(openSecret({}, owner, sealed.ciphertext, sealed.iv), /MAIL_TOKEN_SECRET/u);
}

// ---- Socket guards: ports, hosts, timeouts ----
{
  const { Connection, isPublicHost, setConnector } = await import("../src/socket.ts");
  for (const host of ["imap.mail.me.com", "mail.example.co.uk", "8.8.8.8"]) assert.equal(isPublicHost(host), true, host);
  for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.2", "172.20.0.1", "169.254.169.254", "printer.local", "intranet", "bad host"]) {
    assert.equal(isPublicHost(host), false, host);
  }
  await assert.rejects(Connection.open("mail.example.com", 25, "starttls"), /Only mail ports/u);
  await assert.rejects(Connection.open("mail.example.com", 8080, "on"), /Only mail ports/u);
  await assert.rejects(Connection.open("10.0.0.1", 993, "on"), /isn't a mail server/u);
  // A server that never answers times out instead of hanging.
  setConnector(() => ({
    readable: new ReadableStream(),
    writable: new WritableStream(),
    opened: Promise.resolve({}),
    close: async () => {},
    startTls() {
      return this;
    },
  }));
  const quiet = await Connection.open("imap.example.com", 993, "on", 50);
  await assert.rejects(quiet.readLine(), /stopped answering/u);
  await quiet.close();
  setConnector(() => ({ readable: new ReadableStream(), writable: new WritableStream(), opened: new Promise(() => {}), close: async () => {}, startTls() {} }));
  await assert.rejects(Connection.open("imap.example.com", 993, "on", 50), /didn't answer in time/u);
  setConnector(null);
}
