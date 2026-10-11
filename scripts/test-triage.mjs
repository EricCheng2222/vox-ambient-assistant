import assert from "node:assert/strict";

const { triage, isRequestSource, REQUEST_SOURCES } = await import("../lib/triage.ts");

const mac = { browserAvailable: true, lookupMode: "auto" };
const phoneAlone = { browserAvailable: false, lookupMode: "auto" };
const allBrowser = { browserAvailable: true, lookupMode: "browser" };
const go = (route, where, device = mac, text = "x", whereConfidence = 0.9) => triage({ route, where, whereConfidence, text }, device).route;

assert.deepEqual(Object.keys(REQUEST_SOURCES), ["conversation", "own_data", "own_account_on_site", "site", "public_web", "deep_thought", "mac"]);
assert.equal(isRequestSource("site"), true);
assert.equal(isRequestSource("route"), false);

// Specific jobs are never second-guessed.
for (const route of ["silence", "create_reminder", "create_file", "desktop_action", "local_codex"]) assert.equal(go(route, "public_web"), route);
assert.equal(go("desktop_control", "mac"), "desktop_control");

// The user's own things go to the part of Vox that holds those tools, whatever the first decision was.
for (const route of ["live_web", "expert_reasoning", "realtime"]) {
  assert.equal(go(route, "own_data"), "realtime");
  assert.equal(go(route, "own_account_on_site"), "realtime");
  assert.equal(go(route, "own_account_on_site", phoneAlone), "realtime");
}
// A named site: the browser when there is one, otherwise the best a web search can do.
assert.equal(go("live_web", "site"), "realtime");
assert.equal(go("realtime", "site", phoneAlone), "live_web");
// Public information: web search, unless the user chose the browser for everything.
assert.equal(go("realtime", "public_web"), "live_web");
assert.equal(go("live_web", "public_web", allBrowser), "realtime");
assert.equal(go("live_web", "public_web", { browserAvailable: false, lookupMode: "browser" }), "live_web");
// Hard thinking gets a stronger model; chat never triggers a search.
assert.equal(go("realtime", "deep_thought"), "balanced_reasoning");
assert.equal(go("expert_reasoning", "deep_thought"), "expert_reasoning");
assert.equal(go("live_web", "conversation"), "realtime");
assert.equal(go("realtime", "conversation"), "realtime");
assert.equal(go("balanced_reasoning", "conversation"), "balanced_reasoning");

// An unsure or missing "where" leaves the first decision, with the keyword rules as a net.
assert.equal(go("live_web", "conversation", mac, "who won the race", 0.3), "live_web");
assert.equal(go("live_web", null, mac, "take a look at my starlux account and see how many mileage is about to expire"), "realtime");
assert.equal(go("live_web", undefined, mac, "Find me something around 2000NTD in Airbnb in Taipei that day"), "realtime");
assert.equal(go("live_web", null, mac, "who won the race"), "live_web");
assert.match(triage({ route: "live_web", where: "site", whereConfidence: 0.9, text: "x" }, mac).why, /named site, in the browser/u);

// The user said how: "use computer use" goes to the browser even with no site named and a web-search first choice.
{
  const { asksForBrowser } = await import("../lib/triage.ts");
  for (const text of ["Use computer used to find hotels around October 31 for one night in Taipei xinyi", "use computer use to check flight prices", "do it in the browser", "open the website and look", "用電腦幫我找信義區的飯店", "用瀏覽器查一下"]) assert.equal(asksForBrowser(text), true, text);
  for (const text of ["what computer should I buy", "my browser history is long", "find hotels in Taipei Xinyi for October 31"]) assert.equal(asksForBrowser(text), false, text);
  assert.equal(go("live_web", "public_web", mac, "Use computer used to find hotels around October 31 for one night in Taipei xinyi"), "realtime");
  assert.equal(go("live_web", "public_web", phoneAlone, "use computer use to find hotels"), "live_web", "no browser to use: web search is the best there is");
  assert.equal(go("create_reminder", "conversation", mac, "remind me to use the computer"), "create_reminder");
}

// "Computer use" for something on the web means Vox's browser, not driving a Mac app; naming an app keeps the app.
{
  const hotels = "Use computer used to find hotels around October 31 for one night in Taipei xinyi";
  assert.equal(go("desktop_control", "public_web", mac, hotels), "realtime");
  assert.equal(go("desktop_control", null, mac, hotels), "realtime", "the words alone are enough");
  assert.equal(go("desktop_control", "site", mac, "check Airbnb for a place in Taipei"), "realtime");
  assert.equal(go("desktop_control", "public_web", mac, "open Safari and go to apple.com"), "desktop_control");
  assert.equal(go("desktop_control", "mac", mac, "click the second file in the list"), "desktop_control");
  assert.equal(go("desktop_control", "conversation", mac, "scroll down a bit"), "desktop_control");
  assert.equal(go("desktop_control", "public_web", phoneAlone, hotels), "desktop_control", "no browser to send it to");
  assert.match(triage({ route: "desktop_control", where: "public_web", whereConfidence: 0.9, text: hotels }, mac).why, /a web task, in the browser/u);
  // The same for the workspace agent: a web task is not a coding job, but a coding job stays one.
  assert.equal(go("local_codex", "public_web", mac, hotels), "realtime");
  assert.equal(go("local_codex", "mac", mac, "write a script that renames my photos by date"), "local_codex");
  assert.equal(go("local_codex", "public_web", mac, "write a script that downloads today's weather"), "local_codex");
}

// Triage says when the job is to be done by working a web page, so a phone can hand it to the Mac at once.
{
  const flag = (route, where, device, text = "x") => triage({ route, where, whereConfidence: 0.9, text }, device).useBrowser === true;
  assert.equal(flag("live_web", "site", mac), true);
  assert.equal(flag("live_web", "own_account_on_site", mac), true);
  assert.equal(flag("live_web", "public_web", mac, "use computer use to find hotels"), true);
  assert.equal(flag("live_web", "public_web", allBrowser), true);
  assert.equal(flag("live_web", "public_web", mac), false, "a quick fact is a web search");
  assert.equal(flag("realtime", "own_data", mac), false, "email and calendar are not web pages");
  assert.equal(flag("realtime", "conversation", mac), false);
  assert.equal(flag("live_web", "own_account_on_site", phoneAlone), false, "no browser anywhere");
  assert.equal(flag("create_reminder", "site", mac), false);
}

// A follow-up on the website task from a moment ago is that task again, wherever the words alone would have gone.
{
  const after = (route, extra, device = mac, text = "Search again for hotel") => triage({ route, where: "public_web", whereConfidence: 0.9, text, recentWebTask: true, ...extra }, device);
  // The decision model said so.
  for (const route of ["live_web", "realtime", "desktop_control", "local_codex", "balanced_reasoning"]) {
    const result = after(route, { continuesWebTask: true });
    assert.deepEqual([result.route, result.useBrowser, result.continues, result.why], ["realtime", true, true, "continues the browser task"], route);
  }
  assert.equal(after("live_web", { continuesWebTask: true }, mac, "yes please").continues, true, "agreeing to Vox's offer");
  // It said no: an ordinary request, routed as usual.
  assert.equal(after("live_web", { continuesWebTask: false }).continues, undefined);
  assert.equal(after("live_web", { continuesWebTask: false }).route, "live_web");
  // It could not be asked: the words decide.
  assert.equal(after("live_web", { continuesWebTask: null }).continues, true);
  assert.equal(after("live_web", {}, mac, "再找一次").continues, true);
  assert.equal(after("live_web", {}, mac, "what's the weather tomorrow").continues, undefined);
  // No task a moment ago, no browser, a named Mac app, or a job of its own: left alone.
  assert.equal(triage({ route: "live_web", where: "public_web", whereConfidence: 0.9, text: "Search again for hotel", continuesWebTask: true }, mac).continues, undefined);
  assert.equal(after("live_web", { continuesWebTask: true }, phoneAlone).continues, undefined);
  assert.equal(after("desktop_control", { continuesWebTask: true }, mac, "search again in Safari").route, "desktop_control");
  assert.equal(after("create_reminder", { continuesWebTask: true }).route, "create_reminder");
  assert.equal(after("silence", { continuesWebTask: true }).route, "silence");
}

// Safari or Chrome guessed for a web request (nobody named it) is Vox's own browser's job.
{
  const guess = (app, source, text, where = "conversation", device = mac) => triage({ route: "desktop_control", where, whereConfidence: 0.9, text, desktopApp: app ? { id: app, source } : null }, device);
  assert.deepEqual([guess("safari", "inferred", "Search again for hotel").route, guess("safari", "inferred", "Search again for hotel").useBrowser], ["realtime", true]);
  assert.equal(guess("chrome", "inferred", "look up flights to Tokyo").route, "realtime");
  // Said by the user, or carried over from what they were just doing on the Mac: still the Mac app.
  assert.equal(guess("safari", "said", "scroll down a bit").route, "desktop_control");
  assert.equal(guess("safari", "inferred", "open Safari and go to apple.com", "public_web").route, "desktop_control");
  assert.equal(guess("music", "inferred", "pause it").route, "desktop_control");
  assert.equal(guess("safari", "inferred", "Search again for hotel", "conversation", phoneAlone).route, "desktop_control", "no browser to send it to");
}

console.log("Triage checks passed.");
