// The decision model behind Vox's quick choices (which part of Vox answers,
// whether an email needs the owner, when to speak up). Two providers answer
// the same questions: JEV (typesafe.ai) and OpenAI's Decisions API. Callers
// write the request once, in JEV's shape, and read the answers in JEV's
// shape; DECISION_PROVIDER picks who is asked.

export type DecisionProvider = "jev" | "openai";

type Env = Record<string, string | undefined>;

type ChoiceQuestion = { type?: string; instructions?: string; criteria?: Record<string, string> };
export type DecisionBody = { state?: unknown; questions?: Record<string, ChoiceQuestion> };
export type DecisionAnswer = { choice?: string; confidence?: number };

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const OPENAI_URL = "https://api.openai.com/v1/decisions";
export const OPENAI_DECISION_MODEL = "gpt-6-luna";

export function decisionProvider(env: Env = process.env): DecisionProvider {
  return env.DECISION_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "jev";
}

/** The key for whoever is being asked, or "" when decisions are not set up. */
export function decisionKey(env: Env = process.env) {
  return (decisionProvider(env) === "openai" ? env.OPENAI_API_KEY : env.TYPESAFE_API_KEY)?.trim() ?? "";
}

/** The same questions, as OpenAI's Decisions API takes them. */
export function openAiDecisionRequest(body: DecisionBody) {
  return {
    model: OPENAI_DECISION_MODEL,
    // What JEV calls the state: the evidence every question is answered from.
    input: JSON.stringify(body.state ?? {}),
    questions: Object.entries(body.questions ?? {}).map(([name, question]) => ({
      type: "choice" as const,
      name,
      instructions: question.instructions ?? "",
      choices: Object.entries(question.criteria ?? {}).map(([value, description]) => ({ value, description })),
    })),
  };
}

/** OpenAI's answers, keyed by question name the way JEV returns them. A refusal is left out, so the caller's fallback applies. */
export function answersFromOpenAi(payload: unknown): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {};
  const list = (payload as { answers?: unknown })?.answers;
  for (const item of Array.isArray(list) ? list : []) {
    const answer = (item && typeof item === "object" ? item : {}) as { type?: unknown; name?: unknown; choice?: unknown; confidence?: unknown };
    if (answer.type !== "choice" || typeof answer.name !== "string" || typeof answer.choice !== "string") continue;
    answers[answer.name] = { choice: answer.choice, ...(typeof answer.confidence === "number" ? { confidence: answer.confidence } : {}) };
  }
  return answers;
}

/**
 * Asks the decision model. Takes what a JEV request takes (its JSON body as
 * `body`, and optionally a signal) and resolves to a response whose JSON is
 * `{ answers: { name: { choice, confidence } } }` whichever provider answered.
 */
export async function decisionFetch(init: { body: string; signal?: AbortSignal | null; headers?: unknown; method?: string }, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<Response> {
  const provider = decisionProvider(env);
  const key = decisionKey(env);
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (provider === "jev") {
    return fetcher(JEV_URL, { method: "POST", headers, signal: init.signal ?? undefined, body: init.body });
  }
  const response = await fetcher(OPENAI_URL, {
    method: "POST",
    headers,
    signal: init.signal ?? undefined,
    body: JSON.stringify(openAiDecisionRequest(JSON.parse(init.body) as DecisionBody)),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return new Response(null, { status: response.status });
  }
  return Response.json({ answers: answersFromOpenAi(await response.json()) });
}
