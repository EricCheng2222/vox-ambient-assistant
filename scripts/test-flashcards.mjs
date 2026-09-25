import assert from "node:assert/strict";

const { scheduleReview, isFlashcardRating } = await import("../flashcards-site/src/srs.ts");
const { isFlashcardStudyRequest, isStudyStopRequest, studyOpeningInstructions } = await import("../lib/flashcard-study.ts");
const { isAllowedRedirectUri, authorizationServerMetadata, clientSector } = await import("../lib/oauth.ts");
const site = await import("../flashcards-site/src/oauth.ts");

// Spaced repetition
const now = new Date("2026-09-26T00:00:00.000Z");
const fresh = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 };
const good1 = scheduleReview(fresh, "good", now);
assert.equal(good1.intervalDays, 1);
assert.equal(good1.dueAt, "2026-09-27T00:00:00.000Z");
const good2 = scheduleReview(good1, "good", now);
assert.equal(good2.intervalDays, 3);
const good3 = scheduleReview(good2, "good", now);
assert.equal(good3.intervalDays, 7.5);
const again = scheduleReview(good3, "again", now);
assert.deepEqual([again.reps, again.lapses, again.intervalDays, again.ease], [0, 1, 0, 2.3]);
assert.equal(again.dueAt, "2026-09-26T00:01:00.000Z");
assert.equal(scheduleReview(fresh, "easy", now).intervalDays, 4);
assert.equal(scheduleReview(fresh, "hard", now).ease, 2.35);
assert.ok(scheduleReview({ ease: 1.3, intervalDays: 1, reps: 1, lapses: 0 }, "again", now).ease >= 1.3);
assert.equal(isFlashcardRating("good"), true);
assert.equal(isFlashcardRating("perfect"), false);

// Starting a study session
for (const text of ["let's review my flash cards", "Can you quiz me on my Japanese flashcards?", "quiz me", "考我單字卡", "我們來複習閃卡", "幫我練習字卡", "go through my flash cards"]) {
  assert.equal(isFlashcardStudyRequest(text), true, text);
}
for (const text of ["what is a flash card", "I bought some cards", "remind me to study tomorrow", "考試是什麼時候"]) {
  assert.equal(isFlashcardStudyRequest(text), false, text);
}

// Stopping
for (const text of ["stop", "Let's stop here.", "that's enough for today", "I'm done", "okay, let's call it", "結束", "先到這裡吧", "今天就到這裡", "不練了"]) {
  assert.equal(isStudyStopRequest(text), true, text);
}
for (const text of ["stop sign", "I think the answer is to stop being late", "cat", "結束的英文是 end"]) {
  assert.equal(isStudyStopRequest(text), false, text);
}
assert.match(studyOpeningInstructions("quiz me", "Japanese"), /"Japanese"/u);

// OAuth redirect URIs and resource indicators
for (const uri of ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:33418/callback", "http://localhost:6274/oauth/callback", "cursor://anysphere.cursor-retrieval/oauth/callback"]) {
  assert.equal(isAllowedRedirectUri(uri), true, uri);
}
for (const uri of ["http://evil.example/cb", "javascript:alert(1)", "data:text/html,x", "https://ok.example/cb#frag", "not a url"]) {
  assert.equal(isAllowedRedirectUri(uri), false, uri);
}
// "Sign in with Vox" provider metadata
const vox = authorizationServerMetadata("https://vox.example");
assert.equal(vox.userinfo_endpoint, "https://vox.example/api/oauth/userinfo");
assert.deepEqual(vox.scopes_supported, ["identity"]);
assert.deepEqual(vox.code_challenge_methods_supported, ["S256"]);
assert.equal(clientSector(["https://cards.example/auth/callback"]), "cards.example");

// The flash-card site's own MCP authorization server
const origin = "https://cards.example";
assert.equal(site.isOurResource(null, origin), true);
assert.equal(site.isOurResource("https://cards.example/mcp", origin), true);
assert.equal(site.isOurResource("https://cards.example/", origin), true);
assert.equal(site.isOurResource("https://other.example/mcp", origin), false);
assert.equal(site.protectedResourceMetadata(origin).resource, "https://cards.example/mcp");
assert.equal(site.isAllowedRedirectUri("https://vox.example/api/connections/callback"), true);
assert.equal(site.isAllowedRedirectUri("http://evil.example/cb"), false);

console.log("Flash-card checks passed.");
