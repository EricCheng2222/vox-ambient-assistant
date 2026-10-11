import assert from "node:assert/strict";

const { decisionProvider, decisionKey, openAiDecisionRequest, answersFromOpenAi, decisionFetch } = await import("../lib/decision.ts");

// JEV unless told otherwise; the key follows the provider.
assert.equal(decisionProvider({}), "jev");
assert.equal(decisionProvider({ DECISION_PROVIDER: " OpenAI " }), "openai");
assert.equal(decisionProvider({ DECISION_PROVIDER: "something" }), "jev");
assert.equal(decisionKey({ TYPESAFE_API_KEY: "t", OPENAI_API_KEY: "o" }), "t");
assert.equal(decisionKey({ DECISION_PROVIDER: "openai", TYPESAFE_API_KEY: "t", OPENAI_API_KEY: "o" }), "o");
assert.equal(decisionKey({ DECISION_PROVIDER: "openai" }), "");

const body = {
  model: "jev-latest",
  state: { utterance: "check my orders", browser: true },
  questions: {
    route: { type: "choice", instructions: "Route it.", criteria: { realtime: "The assistant.", live_web: "Web search." } },
    turn_state: { type: "choice", instructions: "Complete?", criteria: { complete: "Done.", wait: "More coming." } },
  },
};
// The same questions, in OpenAI's shape: the state is the evidence, criteria become described choices.
assert.deepEqual(openAiDecisionRequest(body), {
  model: "gpt-6-luna",
  input: JSON.stringify(body.state),
  questions: [
    { type: "choice", name: "route", instructions: "Route it.", choices: [{ value: "realtime", description: "The assistant." }, { value: "live_web", description: "Web search." }] },
    { type: "choice", name: "turn_state", instructions: "Complete?", choices: [{ value: "complete", description: "Done." }, { value: "wait", description: "More coming." }] },
  ],
});
// Answers come back keyed by name, as JEV's do; a refusal or a malformed answer is left out.
assert.deepEqual(
  answersFromOpenAi({ answers: [{ type: "choice", name: "route", choice: "realtime", confidence: 0.98, probabilities: [] }, { type: "refusal", name: "turn_state" }, { type: "choice", name: 7, choice: "x" }, null] }),
  { route: { choice: "realtime", confidence: 0.98 } },
);
assert.deepEqual(answersFromOpenAi(null), {});

// One call site, two providers: the caller reads the same thing either way.
{
  const calls = [];
  const jev = await decisionFetch({ body: JSON.stringify(body) }, { TYPESAFE_API_KEY: "t" }, async (url, init) => { calls.push({ url, init }); return Response.json({ answers: { route: { choice: "live_web", confidence: 0.7 } } }); });
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].init.headers.Authorization, "Bearer t");
  assert.equal(calls[0].init.body, JSON.stringify(body), "JEV gets the request untouched");
  assert.deepEqual(await jev.json(), { answers: { route: { choice: "live_web", confidence: 0.7 } } });

  const openai = await decisionFetch({ body: JSON.stringify(body) }, { DECISION_PROVIDER: "openai", OPENAI_API_KEY: "o", TYPESAFE_API_KEY: "t" }, async (url, init) => { calls.push({ url, init }); return Response.json({ answers: [{ type: "choice", name: "route", choice: "realtime", confidence: 0.98 }] }); });
  assert.equal(calls[1].url, "https://api.openai.com/v1/decisions");
  assert.equal(calls[1].init.headers.Authorization, "Bearer o", "never the other provider's key");
  assert.equal(JSON.parse(calls[1].init.body).model, "gpt-6-luna");
  assert.deepEqual(await openai.json(), { answers: { route: { choice: "realtime", confidence: 0.98 } } });

  const failed = await decisionFetch({ body: JSON.stringify(body) }, { DECISION_PROVIDER: "openai", OPENAI_API_KEY: "o" }, async () => Response.json({ error: { message: "secret detail" } }, { status: 429 }));
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 429);
  assert.equal(await failed.text(), "", "an error body is not passed on");
}

console.log("Decision checks passed.");
