export type ResponsePosture = "flow" | "reflect" | "answer" | "advise";

const RESPONSE_POSTURES = new Set<ResponsePosture>([
  "flow",
  "reflect",
  "answer",
  "advise",
]);

export const responsePostureChoices: readonly ResponsePosture[] = [
  "flow",
  "reflect",
  "answer",
  "advise",
];

export function fallbackResponsePosture(text: string): ResponsePosture {
  const value = text.trim().toLocaleLowerCase();
  if (
    /\b(?:what should i|what do you recommend|any advice|give me advice|help me decide|help me plan|suggest|recommend)\b/iu.test(
      value,
    ) ||
    /(?:我該怎麼|我應該怎麼|你覺得我應該|你建議|給我建議|幫我決定|幫我規劃|有什麼建議|怎麼辦)/u.test(
      value,
    )
  ) {
    return "advise";
  }

  if (
    /\b(?:i feel|i'm feeling|i am feeling|i've been feeling|i am upset|i'm upset|i am sad|i'm sad|i am tired|i'm tired|i am anxious|i'm anxious|i am lonely|i'm lonely)\b/iu.test(
      value,
    ) ||
    /(?:我覺得|我感覺|有點難過|有點累|很累|焦慮|壓力很大|很孤單|很開心|很興奮)/u.test(
      value,
    )
  ) {
    return "reflect";
  }

  if (
    /[?？]\s*$/u.test(value) ||
    /^(?:what|why|when|where|who|which|how|is|are|can|could|do|does|did|will|would)\b/iu.test(
      value,
    ) ||
    /^(?:什麼|為什麼|何時|哪裡|誰|哪個|怎麼|如何|是不是|能不能|可不可以|有沒有)/u.test(
      value,
    )
  ) {
    return "answer";
  }

  return "flow";
}

export function parseResponsePosture(
  value: unknown,
  fallback: ResponsePosture = "flow",
): ResponsePosture {
  return typeof value === "string" &&
    RESPONSE_POSTURES.has(value as ResponsePosture)
    ? (value as ResponsePosture)
    : fallback;
}

export function responsePostureInstruction(value: ResponsePosture) {
  const instructions: Record<ResponsePosture, string> = {
    flow:
      "Conversation stance: go with the flow. Treat this as a natural conversation, not a problem to solve. Respond to what the person actually shared with an apt reaction, observation, gentle curiosity, humor, or a small related thought. Do not offer recommendations, action steps, strategies, lessons, or coaching unless they ask. Do not force a question at the end; a warm statement is often more natural.",
    reflect:
      "Conversation stance: listen and reflect. The person is sharing feelings, uncertainty, or an experience rather than requesting a solution. Acknowledge the emotional meaning in a natural, non-clinical way and give them room to continue. Do not diagnose, reframe it as a task, or offer advice and action steps unless they explicitly ask.",
    answer:
      "Conversation stance: answer the actual question directly. Stay conversational and give the requested information or explanation, but do not expand into unsolicited life advice, coaching, recommendations, or next steps. Ask a follow-up only if it is genuinely needed.",
    advise:
      "Conversation stance: advice is invited or necessary on this turn. Offer proportionate, practical guidance that fits what the person asked, while staying collaborative rather than preachy. Do not turn a small request into an elaborate program unless they want that depth.",
  };
  return instructions[value];
}
