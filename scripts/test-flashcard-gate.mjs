import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { FlashcardStore } from "../flashcards-site/src/store.ts";
import { callTool, handleMcpMessage } from "../flashcards-site/src/mcp.ts";

// Execute the production SQL and migrations; D1 batches are atomic transactions.
const sqlite = new DatabaseSync(":memory:");
for (const name of readdirSync("flashcards-site/migrations").sort()) sqlite.exec(readFileSync(`flashcards-site/migrations/${name}`, "utf8"));
const database = {
  prepare(sql) {
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async first() { return sqlite.prepare(sql).get(...params) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...params) }; },
      run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }; },
    };
  },
  async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = statements.map((statement) => statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const stamp = new Date(Date.now() - 86400_000).toISOString();
for (const owner of ["one", "two"]) {
  sqlite.prepare("INSERT INTO users (id,name,created_at,last_login_at) VALUES (?,?,?,?)").run(owner, owner, stamp, stamp);
  for (const deck of ["a", "b"]) {
    sqlite.prepare("INSERT INTO decks (id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").run(owner + deck, owner, deck, stamp, stamp);
    for (let i = 0; i < 12; i++) sqlite.prepare("INSERT INTO cards (id,owner_id,deck_id,front,back,due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(`${owner}${deck}${i}`, owner, owner + deck, `Question ${i}`, `Answer ${i}`, stamp, stamp, stamp);
  }
}
const store = () => new FlashcardStore(database, "one");
const count = () => sqlite.prepare("SELECT count(*) AS n FROM reviews").get().n;
const grade = (card, rating = "good") => ({ card_id: card.card_id, review_id: card.review_id, rating });
try {
  // Concurrent independent MCP requests cannot prefetch ten different cards.
  const fetched = await Promise.all(Array.from({ length: 10 }, () => callTool(store(), "next_card", { deck: "a" })));
  const first = fetched[0].card;
  assert.equal(new Set(fetched.map((result) => result.card.card_id)).size, 1);
  assert.equal(new Set(fetched.map((result) => result.card.review_id)).size, 1);
  assert.equal(count(), 0, "fetching does not pretend to review a card");
  assert.deepEqual((await callTool(store(), "next_card", { deck: "b", focus: "hard" })).card, first, "changing scope cannot bypass the pending card");
  const other = await callTool(new FlashcardStore(database, "two"), "next_card", {});
  assert.notEqual(other.card.card_id, first.card_id, "accounts have independent gates");
  const wrong = sqlite.prepare("SELECT id FROM cards WHERE owner_id='one' AND id<>? LIMIT 1").get(first.card_id).id;
  await assert.rejects(callTool(store(), "grade_card", { ...grade(first), card_id: wrong }), /only the active card/u);
  await assert.rejects(callTool(store(), "grade_card", { card_id: first.card_id, rating: "good" }), /review_id/u);
  await assert.rejects(callTool(store(), "grade_card", grade(first, "perfect")), /Rating/u);
  await assert.rejects(callTool(store(), "grade_cards", { review_id: first.review_id, reviews: [grade(first), grade(first)] }), /Bulk grading/u);
  assert.equal(count(), 0);

  // Grade versus skip races settle once, in the same transaction as scheduling.
  const competing = await Promise.allSettled([
    callTool(store(), "grade_card", grade(first)),
    callTool(store(), "skip_card", { card_id: first.card_id, review_id: first.review_id }),
  ]);
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(count(), 1);
  const next = competing.find((result) => result.status === "fulfilled").value.next;
  assert.notEqual(next.card.card_id, first.card_id);
  await assert.rejects(callTool(store(), "grade_card", grade(first)), /active card|already completed/u);
  assert.equal(count(), 1, "a duplicate grade never adds a review");

  const skipped = await callTool(store(), "skip_card", { card_id: next.card.card_id, review_id: next.card.review_id });
  assert.equal(count(), 1, "skip changes order without a grade");
  assert.notEqual(skipped.next.card.card_id, next.card.card_id);
  const resumed = await callTool(store(), "next_card", {});
  assert.deepEqual(resumed.card, skipped.next.card, "a fresh request resumes the stored turn");
  const batch = await callTool(store(), "grade_cards", { review_id: resumed.card.review_id, reviews: [grade(resumed.card)] });
  assert.equal(batch.graded.length, 1);
  assert.equal(count(), 2);

  // A failure midway rolls back the grade and leaves the same card pending.
  const pending = batch.next.card;
  sqlite.exec("CREATE TRIGGER fail_review BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  await assert.rejects(callTool(store(), "grade_card", grade(pending)), /fixture failure/u);
  sqlite.exec("DROP TRIGGER fail_review");
  assert.equal(count(), 2);
  assert.deepEqual((await callTool(store(), "next_card", {})).card, pending);

  const rpc = await handleMcpMessage(store(), { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "grade_card", arguments: grade(first) } });
  assert.equal(rpc.result.isError, true);
  assert.equal(count(), 2);
  // Deleting the active card unblocks study without fabricating a review.
  await store().deleteCard(pending.card_id);
  const afterDelete = await callTool(store(), "next_card", {});
  assert.notEqual(afterDelete.card.card_id, pending.card_id);
  assert.equal(count(), 2);

  // With only one card, skip re-presents it with a new token; an old skip cannot advance it.
  sqlite.prepare("INSERT INTO users (id,name,created_at,last_login_at) VALUES ('solo','Solo',?,?)").run(stamp, stamp);
  const solo = new FlashcardStore(database, "solo");
  const deck = await solo.createDeck("Solo");
  await solo.addCards(deck.id, [{ front: "One question", back: "One answer" }]);
  const single = await callTool(solo, "next_card", {});
  const singleSkip = await callTool(solo, "skip_card", { card_id: single.card.card_id, review_id: single.card.review_id });
  assert.equal(singleSkip.next.only_card_left, true);
  assert.equal(singleSkip.next.card.card_id, single.card.card_id);
  assert.notEqual(singleSkip.next.card.review_id, single.card.review_id);
  await assert.rejects(callTool(solo, "skip_card", { card_id: single.card.card_id, review_id: single.card.review_id }), /active card/u);
  const missed = await callTool(solo, "grade_card", grade(singleSkip.next.card, "again"));
  assert.equal(missed.next.done, true);
  assert.equal(count(), 3);
  const repeated = await solo.nextStudyCard(undefined, new Date(Date.now() + 120_000));
  assert.equal(repeated.card.id, single.card.card_id);
  assert.equal(repeated.repeat, true);
  assert.notEqual(repeated.reviewId, singleSkip.next.card.review_id);
} finally { sqlite.close(); }
console.log("Durable single-card gate, concurrent fetch/grade/skip, token validation and atomic rollback: ok");
