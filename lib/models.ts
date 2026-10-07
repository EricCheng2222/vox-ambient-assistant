// The reasoning models Vox asks, strongest first. The first that answers is
// used; a later one is only a fall-back when the call itself fails (a model
// being unavailable to the account, an outage), never for a refusal or a
// budget error.

/** The hardest questions, and writing that should be good: slides and documents. */
export const EXPERT_MODELS = ["gpt-6.1-sol", "gpt-6-astra"] as const;

/**
 * Calls `ask` with each model in turn until one returns an OK response.
 * Client errors that another model would hit too (400, 401, 402, 429) are
 * returned as they are.
 */
export async function askFirstAvailable(models: readonly string[], ask: (model: string) => Promise<Response>): Promise<Response> {
  let last: Response | null = null;
  for (const model of models) {
    last = await ask(model);
    if (last.ok || [400, 401, 402, 429].includes(last.status)) return last;
    console.error("Model unavailable, trying the next", model, last.status);
  }
  return last as Response;
}
