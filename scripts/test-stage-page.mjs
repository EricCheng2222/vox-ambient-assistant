import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The stage's reader view (URL safety, charset decoding, main-text
// extraction, redirects) and the stage built for web answers.

const { decodeHtml, extractStagePage, fetchStagePage, STAGE_PAGE_LIMITS, StagePageError, validateStageUrl } = await import("../lib/stage-extract.ts");
const { collectSources, sanitizeStage, STAGE_SCHEMA } = await import("../lib/stage-answer.ts");

// ---- URL safety ----
const allowed = [
  "https://example.com/news?id=1",
  "https://news.ltn.com.tw/news/life/breakingnews/1",
  "http://www.cna.com.tw/news/aipl/1.aspx",
  "https://example.com:443/",
  "http://example.com:80/",
  "https://8.8.8.8/",
  "https://[2606:4700:4700::1111]/",
  "https://EXAMPLE.com./path",
];
for (const url of allowed) assert.equal(validateStageUrl(url).ok, true, url);

const blocked = [
  "",
  "not a url",
  "ftp://example.com/file",
  "file:///etc/passwd",
  "javascript:alert(1)",
  "data:text/html,hi",
  "http://localhost/",
  "https://localhost:443/",
  "https://LOCALHOST./",
  "https://app.localhost/",
  "https://printer.local/",
  "https://db.internal/",
  "https://router.lan/",
  "https://intranet/",
  "http://127.0.0.1/",
  "https://127.0.0.1/",
  "https://127.1/",
  "https://2130706433/",
  "https://0x7f.0.0.1/",
  "https://0.0.0.0/",
  "https://10.1.2.3/",
  "https://172.16.0.1/",
  "https://172.31.255.255/",
  "https://192.168.1.1/",
  "https://169.254.169.254/latest/meta-data/",
  "https://100.64.0.1/",
  "https://224.0.0.1/",
  "https://255.255.255.255/",
  "http://8.8.8.8/",
  "https://[::1]/",
  "https://[::]/",
  "https://[fe80::1]/",
  "https://[fd00::1]/",
  "https://[fc00::1]/",
  "https://[::ffff:127.0.0.1]/",
  "https://[::ffff:7f00:1]/",
  "https://[2001:db8::1]/",
  "https://[2002:7f00:1::]/",
  "https://example.com:8443/",
  "http://example.com:8080/",
  "https://example.com:22/",
  "https://user:pass@example.com/",
  "https://user@example.com/",
  "https://:pass@example.com/",
  `https://example.com/${"a".repeat(2100)}`,
];
for (const url of blocked) assert.equal(validateStageUrl(url).ok, false, url);

// ---- Extraction: a page heavy with navigation, sidebars, and a footer ----
const newsPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fallback title | Daily Example</title>
  <meta property="og:title" content="City opens a new river park &amp; bike path">
  <meta name="description" content="The riverside park opens on Saturday with 12 km of bike path.">
  <meta property="og:image" content="/images/park.jpg">
  <script>var html = "<p>This paragraph is inside a script and must never appear in the output text.</p>";</script>
  <style>p { color: red; } .x::before { content: "<p>style text should be ignored completely by the reader</p>"; }</style>
</head>
<body>
  <header class="site-header"><a href="/">Daily Example</a><p>Subscribe today for unlimited access to every single story we publish.</p></header>
  <nav><ul><li>Home</li><li>World news and analysis from around the globe today</li><li>Sports</li></ul></nav>
  <div class="layout">
    <aside><p>Most read: Ten things you did not know about the river and its history.</p></aside>
    <article class="story">
      <h1>City opens a new river park &amp; bike path</h1>
      <div class="share-buttons"><p>Share this story on Facebook, Twitter, LINE, or copy the link to it.</p></div>
      <p>The city&#8217;s new riverside park opens on Saturday, with 12&nbsp;km of protected bike path along the water.</p>
      <p>Officials said&hellip; the <a href="/x">project</a> cost <b>NT$1.2 billion</b> and took four years to finish, two more than planned.</p>
      <!-- <p>A commented-out paragraph that should not appear anywhere in the output.</p> -->
      <h2>Opening hours</h2>
      <ul>
        <li>The park is open every day from 6 a.m. until 10 p.m., including holidays.</li>
        <li>Short item</li>
      </ul>
      <table>
        <tr><th>Section</th><th>Length</th><th>Surface</th></tr>
        <tr><td>North bank</td><td>7 km</td><td>Asphalt, lit at night</td></tr>
      </table>
      <p hidden>This hidden paragraph is only for screen readers and should be left out.</p>
      <p>Line one of a poem that is fairly long<br>and line two continues it right here<br><br>A new paragraph after two line breaks starts here now.</p>
      <figure><img src="a.jpg" alt="The park"><figcaption>Caption text that is long enough to count as a paragraph.</figcaption></figure>
      <form><label>Leave a comment on this story, we read all of them carefully.</label><button>Send</button></form>
    </article>
    <div class="related-stories"><p>Related: The old river park closed last year after the flood damage was found.</p></div>
  </div>
  <footer><p>Copyright 2026 Daily Example. All rights reserved. Contact us for licensing.</p></footer>
</body>
</html>`;

const page = extractStagePage(newsPage, "https://www.daily.example.com/2026/09/park?ref=home");
assert.equal(page.url, "https://www.daily.example.com/2026/09/park?ref=home");
assert.equal(page.site, "daily.example.com");
assert.equal(page.title, "City opens a new river park & bike path");
assert.equal(page.description, "The riverside park opens on Saturday with 12 km of bike path.");
assert.equal(page.image, "https://www.daily.example.com/images/park.jpg");
assert.deepEqual(page.paragraphs, [
  "The city’s new riverside park opens on Saturday, with 12 km of protected bike path along the water.",
  "Officials said… the project cost NT$1.2 billion and took four years to finish, two more than planned.",
  "Opening hours",
  "The park is open every day from 6 a.m. until 10 p.m., including holidays.",
  "Section · Length · Surface",
  "North bank · 7 km · Asphalt, lit at night",
  "Line one of a poem that is fairly long and line two continues it right here",
  "A new paragraph after two line breaks starts here now.",
]);
const allText = page.paragraphs.join("\n");
for (const leaked of ["script", "style text", "Subscribe", "World news", "Most read", "Share this", "commented-out", "hidden paragraph", "Caption", "comment on this", "Related:", "Copyright"]) {
  assert.ok(!allText.includes(leaked), leaked);
}

// og:title falls back to <title>; http images are dropped; <base> is honoured.
{
  const plain = extractStagePage(
    `<html><head><title> Plain &amp; simple </title><base href="https://cdn.example.org/assets/"><meta property="og:image" content="pic.png"><meta property="og:description" content="OG description"></head><body><p>Just one paragraph of body text, long enough to be kept by the reader.</p></body></html>`,
    "https://example.org/a",
  );
  assert.equal(plain.title, "Plain & simple");
  assert.equal(plain.description, "OG description");
  assert.equal(plain.image, "https://cdn.example.org/assets/pic.png");
  assert.deepEqual(plain.paragraphs, ["Just one paragraph of body text, long enough to be kept by the reader."]);
  const insecure = extractStagePage(`<meta property="og:image" content="http://example.org/a.png"><p>x</p>`, "https://example.org/");
  assert.equal(insecure.image, null);
  assert.equal(insecure.title, "example.org");
  assert.equal(insecure.description, null);
  assert.deepEqual(insecure.paragraphs, []);
}

// <main> is preferred when there is no article; listing pages pick the longest article.
{
  const filler = "This sentence is part of the main column and has plenty of words in it. ";
  const mainPage = `<body><div><p>Outside main: a promotional paragraph that is long enough to count.</p></div><main><p>${filler.repeat(2)}</p><p>${filler.repeat(2)}second</p></main></body>`;
  assert.ok(extractStagePage(mainPage, "https://example.org/").paragraphs.every((text) => !text.startsWith("Outside")));

  const listing = `<body><article><p>Short teaser for another story that is on this page.</p></article><article><p>${filler.repeat(3)}</p><p>${filler.repeat(2)}more</p></article></body>`;
  const chosen = extractStagePage(listing, "https://example.org/").paragraphs;
  assert.equal(chosen.length, 2);
  assert.ok(chosen.every((text) => text.startsWith("This sentence")));
}

// Limits: at most 40 paragraphs of at most 600 characters.
{
  const many = `<article>${Array.from({ length: 60 }, (_, index) => `<p>Paragraph number ${index + 1} has enough words to pass the length filter.</p>`).join("")}<p>${"word ".repeat(400)}</p></article>`;
  const limited = extractStagePage(many, "https://example.org/");
  assert.equal(limited.paragraphs.length, STAGE_PAGE_LIMITS.maxParagraphs);
  const long = extractStagePage(`<p>${"word ".repeat(400)}</p>`, "https://example.org/");
  assert.ok(long.paragraphs[0].length <= 600 && long.paragraphs[0].endsWith("…"));
}

// A class-name heuristic that would hide everything is dropped.
{
  const wrapped = `<body><div class="page has-sidebar"><p>The only real paragraph on this page lives inside a wrapper.</p></div></body>`;
  assert.deepEqual(extractStagePage(wrapped, "https://example.org/").paragraphs, ["The only real paragraph on this page lives inside a wrapper."]);
}

// Entities: named, decimal, hex, and unknown ones left alone.
{
  const entities = extractStagePage(`<p>Tom &amp; Jerry &#x4E2D;&#25991; &copy; 2026 &unknown; &lt;tag&gt; and a few more words here</p>`, "https://example.org/");
  assert.equal(entities.paragraphs[0], "Tom & Jerry 中文 © 2026 &unknown; <tag> and a few more words here");
}

// ---- Charsets: a Taiwanese Big5 page ----
const big5Hex =
  "3c68746d6c3e3c686561643e3c6d65746120687474702d65717569763d22436f6e74656e742d547970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d62696735223e3c7469746c653ebbe4adb7b0caba41a155a4a4a5a1aef0b648b8703c2f7469746c653e3c2f686561643e3c626f64793e3c64697620636c6173733d226d656e75223eadbaadb620a4d1aef020a661be5f3c2f6469763e3c61727469636c653e3c68323ebbe4adb7b3ccb773aef8aea73c2f68323e3c703ea4a4abd7bbe4adb7a4b5a4d1b24db1e1a662aae1bdacb56eb3b0a141aef0b648b870b4a3bff4a5c1b2b3aa60b74eb16aadb7bba8ab42a141a473b0cfa569afe0a558b27bb657b94ca4ada6cab240a6ccaabab2d6bf6eab42b671a1433c2f703e3c703eb5753c2f703e3c2f61727469636c653e3c666f6f7465723eaaa9c576a9d2a6b320a4a4a5a1aef0b648b8703c2f666f6f7465723e3c2f626f64793e3c2f68746d6c3e";
const big5 = new Uint8Array(Buffer.from(big5Hex, "hex"));
const expectedBig5 = {
  url: "https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_NEWS.html",
  site: "cwa.gov.tw",
  title: "颱風動態｜中央氣象署",
  description: null,
  image: null,
  paragraphs: ["颱風最新消息", "中度颱風今天清晨在花蓮登陸，氣象署提醒民眾注意強風豪雨，山區可能出現超過五百毫米的累積雨量。"],
};
// From the meta tag, from the Content-Type header, and with an alias label.
for (const contentType of ["text/html", "text/html; charset=big5", "text/html; charset=\"BIG5\"", "text/html;charset=x-big5", "text/html; charset=cp950"]) {
  assert.deepEqual(extractStagePage(decodeHtml(big5, contentType), expectedBig5.url), expectedBig5, contentType);
}
// UTF-8 (with and without BOM) and an unknown label fall back safely.
{
  const utf8 = new TextEncoder().encode(`<title>臺北市</title><p>臺北市今天天氣晴朗，氣溫攝氏三十度，午後山區可能有局部短暫陣雨。</p>`);
  assert.equal(extractStagePage(decodeHtml(utf8, "text/html; charset=utf-8"), "https://example.tw/").title, "臺北市");
  assert.equal(extractStagePage(decodeHtml(utf8, "text/html; charset=nonsense-9"), "https://example.tw/").title, "臺北市");
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
  assert.equal(extractStagePage(decodeHtml(bom, "text/html; charset=big5"), "https://example.tw/").title, "臺北市");
}

// ---- Fetching: redirects re-checked, HTML only, size cap ----
function fakeWeb(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, "manual");
    const route = routes[url];
    if (!route) return new Response("missing", { status: 404, headers: { "Content-Type": "text/html" } });
    return route();
  };
  return { fetcher, calls };
}
const redirect = (location, status = 302) => () => new Response(null, { status, headers: { Location: location } });
const html = (body, type = "text/html; charset=utf-8") => () => new Response(body, { headers: { "Content-Type": type } });

{
  const { fetcher, calls } = fakeWeb({
    "https://short.example.com/a": redirect("https://news.example.com/story", 301),
    "https://news.example.com/story": redirect("/story/amp?x=1"),
    "https://news.example.com/story/amp?x=1": html(`<title>Story</title><p>The story body is right here and it is long enough.</p>`),
  });
  const result = await fetchStagePage("https://short.example.com/a", fetcher);
  assert.equal(result.url, "https://news.example.com/story/amp?x=1");
  assert.equal(result.title, "Story");
  assert.equal(calls.length, 3);
}

async function rejects(promise, status, pattern) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof StagePageError);
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

{
  // Into a private address, by name or by IP.
  for (const target of ["http://169.254.169.254/latest/meta-data/", "https://localhost/admin", "https://example.com:8443/", "https://u:p@example.com/"]) {
    const { fetcher, calls } = fakeWeb({ "https://evil.example.com/": redirect(target) });
    await rejects(fetchStagePage("https://evil.example.com/", fetcher), 502, /redirects somewhere/u);
    assert.equal(calls.length, 1, target);
  }
  // Too many hops.
  const { fetcher, calls } = fakeWeb({
    "https://a.example.com/": redirect("https://b.example.com/"),
    "https://b.example.com/": redirect("https://c.example.com/"),
    "https://c.example.com/": redirect("https://d.example.com/"),
    "https://d.example.com/": redirect("https://e.example.com/"),
    "https://e.example.com/": html("<p>too far</p>"),
  });
  await rejects(fetchStagePage("https://a.example.com/", fetcher), 502, /too many/u);
  assert.equal(calls.length, 4);
  // Invalid start, non-HTML, and errors.
  await rejects(fetchStagePage("http://127.0.0.1/", fakeWeb({}).fetcher), 400);
  await rejects(fetchStagePage("https://example.com/file.pdf", fakeWeb({ "https://example.com/file.pdf": html("%PDF", "application/pdf") }).fetcher), 415);
  await rejects(fetchStagePage("https://example.com/x", fakeWeb({ "https://example.com/x": html("{}", "application/json") }).fetcher), 415);
  await rejects(fetchStagePage("https://example.com/none", fakeWeb({ "https://example.com/none": () => new Response("x") }).fetcher), 415);
  await rejects(fetchStagePage("https://example.com/gone", fakeWeb({}).fetcher), 502, /404/u);
  await rejects(fetchStagePage("https://example.com/down", async () => { throw new TypeError("network"); }), 502);
}

{
  // The body is cut at 2 MB (the stream is not read further).
  let pulled = 0;
  const chunk = new TextEncoder().encode(`<p>${"Filler text that repeats to make a very large page body. ".repeat(1000)}</p>`);
  const endless = new ReadableStream({
    pull(controller) {
      pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const { fetcher } = fakeWeb({ "https://big.example.com/": () => new Response(endless, { headers: { "Content-Type": "text/html" } }) });
  const big = await fetchStagePage("https://big.example.com/", fetcher);
  assert.ok(pulled < STAGE_PAGE_LIMITS.maxBytes + 4 * chunk.byteLength, `read ${pulled} bytes`);
  assert.ok(big.paragraphs.length >= 1);
}

// ---- Web answers: sources from url_citation annotations ----
{
  const citation = (url, title) => ({ type: "url_citation", start_index: 0, end_index: 5, url, title });
  const payload = {
    output: [
      { type: "web_search_call", id: "ws_1", status: "completed" },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Answer text.",
            annotations: [
              citation("https://www.cwa.gov.tw/V8/C/?utm_source=openai", "中央氣象署"),
              citation("https://www.cwa.gov.tw/V8/C/", "Duplicate after cleanup"),
              citation("https://news.example.com/a?id=1&utm_source=openai#top", "  News   A "),
              { type: "file_citation", file_id: "f1" },
              citation("javascript:alert(1)", "Bad"),
              citation("https://user:pw@example.com/", "Credentials"),
              citation("https://b.example.com/", ""),
              citation("https://c.example.com/", "C"),
              citation("https://d.example.com/", "D"),
              citation("https://e.example.com/", "E"),
            ],
          },
        ],
      },
    ],
  };
  const sources = collectSources(payload);
  assert.equal(sources.length, 5);
  assert.deepEqual(sources[0], { url: "https://www.cwa.gov.tw/V8/C/", title: "中央氣象署", site: "cwa.gov.tw", image: null, excerpt: null });
  assert.deepEqual(sources[1], { url: "https://news.example.com/a?id=1", title: "News A", site: "news.example.com", image: null, excerpt: null });
  assert.equal(sources[2].title, "b.example.com");
  assert.deepEqual(sources.map((source) => source.site), ["cwa.gov.tw", "news.example.com", "b.example.com", "c.example.com", "d.example.com"]);
  assert.deepEqual(collectSources({}), []);
  assert.deepEqual(collectSources({ output: [{ type: "message", content: [{ type: "output_text", text: "x" }] }] }), []);
}

// ---- Web answers: the model's blocks are checked and trimmed ----
{
  const stage = sanitizeStage({
    title: "  颱風  動態 ",
    blocks: [
      { kind: "facts", title: "Now", rows: [{ label: "Wind", value: "Level 12" }, { label: "", value: "dropped" }] },
      { kind: "facts", title: "Empty", rows: [] },
      { kind: "chart", title: "Unknown kind" },
      { kind: "table", title: "Compare", columns: ["A", "B"], rows: [["1", "2", "3"], ["only"], [], ["", ""]] },
      { kind: "quote", text: "Stay indoors.", source: null },
      { kind: "list", title: "Fourth block", items: ["dropped"] },
    ],
  });
  assert.deepEqual(stage, {
    title: "颱風 動態",
    blocks: [
      { kind: "facts", title: "Now", rows: [{ label: "Wind", value: "Level 12" }] },
      { kind: "table", title: "Compare", columns: ["A", "B"], rows: [["1", "2"], ["only", ""]] },
      { kind: "quote", text: "Stay indoors." },
    ],
  });
  assert.deepEqual(sanitizeStage(null), { title: "", blocks: [] });
  assert.deepEqual(sanitizeStage({ title: "T", blocks: [{ kind: "quote", text: "Q", source: "CWA" }, { kind: "steps", title: "S", items: ["a", "", 3] }] }), {
    title: "T",
    blocks: [{ kind: "quote", text: "Q", source: "CWA" }, { kind: "steps", title: "S", items: ["a"] }],
  });
  // Strict structured outputs: every object lists all its properties as required.
  const walk = (schema) => {
    if (!schema || typeof schema !== "object") return;
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    }
    Object.values(schema).forEach(walk);
  };
  walk(STAGE_SCHEMA);
}

// ---- Wiring ----
const [reasonRoute, factsRoute, pageRoute, todayRoute, proxy] = await Promise.all([
  readFile(new URL("../app/api/reason/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/stage/facts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/stage/page/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/today/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../desktop/VoxDesktop/src/local-web-server.mjs", import.meta.url), "utf8"),
]);
assert.match(reasonRoute, /if \(!isWeb\) \{\n\s+return Response\.json\(\{ answer, model \}, \{ headers: \{ "Cache-Control": "no-store" \} \}\);/u);
// Web answers return their sources at once; the facts come separately so
// speech never waits on them.
assert.doesNotMatch(reasonRoute, /gpt-5\.6-luna/u);
assert.match(factsRoute, /model: "gpt-5\.6-luna"/u);
assert.match(factsRoute, /AbortSignal\.timeout\(STAGE_TIMEOUT_MS\)/u);
assert.match(factsRoute, /requireUser\(request\)/u);
assert.match(proxy, /\["\/api\/stage\/facts", new Set\(\["POST"\]\)\]/u);
assert.match(pageRoute, /requireUser\(request\)/u);
assert.match(todayRoute, /requireUser\(request\)/u);
assert.match(todayRoute, /"Cache-Control": "no-store"/u);
assert.match(proxy, /\["\/api\/stage\/page", new Set\(\["GET"\]\)\]/u);
assert.match(proxy, /\["\/api\/today", new Set\(\["GET"\]\)\]/u);

console.log("Stage page checks passed.");
