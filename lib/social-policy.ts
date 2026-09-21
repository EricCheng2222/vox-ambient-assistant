export type MemoryUse = "none" | "natural_callback" | "emotional_followup";
export type ConversationRitual = "none" | "good_morning" | "good_night";

const MEMORY_USES = new Set<MemoryUse>([
  "none",
  "natural_callback",
  "emotional_followup",
]);
const RITUALS = new Set<ConversationRitual>([
  "none",
  "good_morning",
  "good_night",
]);

export function parseMemoryUse(
  value: unknown,
  fallback: MemoryUse = "none",
): MemoryUse {
  return typeof value === "string" && MEMORY_USES.has(value as MemoryUse)
    ? (value as MemoryUse)
    : fallback;
}

export function parseConversationRitual(
  value: unknown,
  fallback: ConversationRitual = "none",
): ConversationRitual {
  return typeof value === "string" && RITUALS.has(value as ConversationRitual)
    ? (value as ConversationRitual)
    : fallback;
}

export function fallbackConversationRitual(
  text: string,
  eligibility: { morning: boolean; night: boolean },
): ConversationRitual {
  const value = text.trim().toLocaleLowerCase();
  if (
    eligibility.night &&
    (/\b(?:good ?night|going to (?:bed|sleep)|off to (?:bed|sleep)|sleep now)\b/iu.test(
      value,
    ) ||
      /(?:晚安|要睡了|去睡了|準備睡|先睡|睡覺去)/u.test(value))
  ) {
    return "good_night";
  }
  if (
    eligibility.morning &&
    (/\b(?:good morning|morning)\b/iu.test(value) || /(?:早安|早上好|早啊)/u.test(value))
  ) {
    return "good_morning";
  }
  return "none";
}

export function memoryUseInstruction(value: MemoryUse) {
  const instructions: Record<MemoryUse, string> = {
    none:
      "Memory timing: do not bring up an older personal memory or unresolved emotional thread on this turn. Stored facts may still be used silently when they are strictly necessary to answer the current request.",
    natural_callback:
      "Memory timing: one natural callback is welcome on this turn because it is directly relevant. Weave in at most one remembered detail casually, without saying you searched memory, reciting stored facts, or making the person feel monitored.",
    emotional_followup:
      "Memory timing: this is an appropriate calm moment to gently revisit one relevant unresolved emotional thread. Use tentative, low-pressure language, let the person decline or move on, and never interrupt an urgent task to do this.",
  };
  return instructions[value];
}

export function ritualInstruction(value: ConversationRitual) {
  const instructions: Record<ConversationRitual, string> = {
    none: "Ritual timing: do not add a morning or bedtime ritual on this turn.",
    good_morning:
      "Ritual timing: a brief, natural good-morning greeting fits this first meaningful interaction of the day. Weave it into the response once; do not make it ceremonial or mention scheduling.",
    good_night:
      "Ritual timing: the person is naturally winding down or going to sleep. Offer a brief, warm good-night response without starting a new topic, giving a sleep lecture, or assuming they want more conversation.",
  };
  return instructions[value];
}
