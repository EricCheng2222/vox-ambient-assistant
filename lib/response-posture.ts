export type ResponsePosture =
  | "flow"
  | "acknowledge"
  | "listen"
  | "joke"
  | "ask"
  | "share"
  | "answer"
  | "advise"
  | "repair";

const RESPONSE_POSTURES = new Set<ResponsePosture>([
  "flow",
  "acknowledge",
  "listen",
  "joke",
  "ask",
  "share",
  "answer",
  "advise",
  "repair",
]);

export const responsePostureChoices: readonly ResponsePosture[] = [
  "flow",
  "acknowledge",
  "listen",
  "joke",
  "ask",
  "share",
  "answer",
  "advise",
  "repair",
];

export function fallbackResponsePosture(text: string): ResponsePosture {
  const value = text.trim().toLocaleLowerCase();
  if (
    /\b(?:that(?:'s| is) not what i mean|you misunderstood|not what i said|no,? that(?:'s| is) not it|you keep|stop giving me advice)\b/iu.test(
      value,
    ) ||
    /(?:不是這個意思|你誤會了|不是我說的|不是啦|你又在|不要一直給建議|我不是要你給建議)/u.test(
      value,
    )
  ) {
    return "repair";
  }

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
    return "listen";
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

  if (/\b(?:haha|lol|that's funny|so funny)\b/iu.test(value) || /(?:哈哈|笑死|好好笑)/u.test(value)) {
    return "joke";
  }

  return "acknowledge";
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
      "Conversation move: go with the flow. Treat this as a natural conversation, not a problem to solve. Respond to what the person actually shared without coaching, prescribing, or forcing a question.",
    acknowledge:
      "Conversation move: acknowledge. Give a natural, specific reaction that shows you heard what the person said. Do not turn it into a lesson, action plan, or interview, and do not force a follow-up question.",
    listen:
      "Conversation move: listen. The person is sharing feelings, uncertainty, or an experience rather than requesting a solution. Reflect the emotional meaning in a warm, non-clinical way and leave room for them to continue. Do not diagnose, fix, coach, or give action steps unless they explicitly ask.",
    joke:
      "Conversation move: be playfully responsive. Match the person's humor with one natural light remark, without performing a comedy routine, teasing a sensitive subject, or losing the thread of what they meant.",
    ask:
      "Conversation move: ask. Offer one genuinely interesting, low-pressure question because curiosity is the most natural next move. Do not interrogate, stack questions, or ask something whose answer the person already gave.",
    share:
      "Conversation move: share a thought. Add one relevant observation, association, or perspective as a conversational equal. It should feel like contributing to the moment, not reframing the person's life or sneaking in advice.",
    answer:
      "Conversation stance: answer the actual question directly. Stay conversational and give the requested information or explanation, but do not expand into unsolicited life advice, coaching, recommendations, or next steps. Ask a follow-up only if it is genuinely needed.",
    advise:
      "Conversation stance: advice is invited or necessary on this turn. Offer proportionate, practical guidance that fits what the person asked, while staying collaborative rather than preachy. Do not turn a small request into an elaborate program unless they want that depth.",
    repair:
      "Conversation move: repair a mismatch. Briefly acknowledge that the previous response missed the person's meaning, then respond again from their corrected direction. Do not defend the earlier answer, over-apologize, blame the user, or repeat the same approach in different words.",
  };
  return instructions[value];
}
