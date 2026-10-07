import type { JevAnswers, JevQuestions } from "./today-moments.ts";

// Asking JEV (typesafe.ai) the Today briefing's choice questions. One request
// may carry several questions; the answers come back by question name.

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_TIMEOUT_MS = 6_000;

/**
 * JEV's answers, or null when JEV is not configured, too slow, or failed.
 * Callers have a plain rule to fall back on, so this never throws.
 */
export async function askJev(request: JevQuestions, timeoutMs = JEV_TIMEOUT_MS): Promise<JevAnswers> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || !Object.keys(request.questions).length) return null;
  try {
    const response = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model: "jev-latest", state: request.state, questions: request.questions }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`JEV returned ${response.status}`);
    }
    const payload = (await response.json()) as { answers?: unknown };
    const answers = payload?.answers;
    return answers && typeof answers === "object" && !Array.isArray(answers) ? (answers as NonNullable<JevAnswers>) : null;
  } catch (error) {
    console.error("Today: JEV failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
