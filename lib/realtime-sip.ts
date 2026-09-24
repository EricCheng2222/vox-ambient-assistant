import { boundedRecentMessages, formatConversationCarryover } from "@/lib/conversation-context";
import type { ConversationMessage } from "@/lib/conversation";
import { buildVoiceInstructions, type MemoryRecord } from "@/lib/memory";
import { replyLengthInstruction, type ReplyLength } from "@/lib/reply-length";

export const OPENAI_REALTIME_SIP_MODEL = "gpt-realtime-2.1";

export function openAiSipProjectId() {
  const value = process.env.OPENAI_SIP_PROJECT_ID?.trim() ?? "";
  return /^proj_[A-Za-z0-9_-]{6,}$/u.test(value) ? value : null;
}

export function openAiSipUri(projectId: string) {
  if (!/^proj_[A-Za-z0-9_-]{6,}$/u.test(projectId)) {
    throw new Error("Invalid OpenAI SIP project ID.");
  }
  return `sip:${projectId}@sip.api.openai.com;transport=tls`;
}

export function extractSipCaller(
  sipHeaders: Array<{ name?: unknown; value?: unknown }> | undefined,
) {
  const value = sipHeaders?.find(
    (header) => String(header.name ?? "").toLowerCase() === "from",
  )?.value;
  return typeof value === "string" ? value.slice(0, 500) : "";
}

export function phoneRealtimeAuthInstructions() {
  return [
    "You are Vox at the locked entrance to a private voice call.",
    "Do not answer questions, continue a conversation, reveal private context, or execute tools before the server confirms authentication.",
    "Ask the caller once, in natural Taiwan Mandarin, to say their private authentication sentence.",
    "Never repeat the sentence back, hint at it, or claim that authentication succeeded on your own.",
    "The server will explicitly update your instructions after verification.",
  ].join(" ");
}

export function phoneRealtimeConversationInstructions(
  memories: MemoryRecord[],
  replyLength: ReplyLength,
) {
  return [
    buildVoiceInstructions(memories),
    replyLengthInstruction(replyLength),
    "This is a direct, continuous telephone conversation. No per-turn external social-routing decision is supplied, so choose the socially natural next move yourself: listen, acknowledge, joke, ask, share, answer, advise only when wanted, repair a mismatch, or remain briefly quiet. Do not default to advice or end every reply with a question.",
    "Allow interruptions and thinking pauses. Keep phone replies easy to follow aloud. Do not read URLs, Markdown, citation syntax, or raw tool output aloud; summarize sources naturally when relevant.",
    "Use search_web whenever the caller asks about current weather, today's news, live schedules, prices, public events, or other information that may have changed. For current questions, never answer from memory or say that live data is unavailable before trying the tool. Briefly acknowledge that you are checking if the search may take a moment, then speak the result naturally and mention source names only when useful.",
    "Execution routing starts on Vox Cloud for every call. If the caller says to use, switch to, or route to their Mac, call set_execution_route with mac and confirm the change. If they say to return to cloud, call it with cloud. The choice lasts for this call until changed. If a route switch and an action are spoken together, switch first and then perform the action.",
    "While the route is mac, use run_on_mac for every actionable request that needs an installed app, the visible Mac interface, files, local Codex, Computer Use, or locally connected smart-home devices. The caller does not need to say the app name when the visible or recent app context makes the target clear; preserve references such as ‘it’, ‘that tab’, or ‘the video’ in the prompt so the Mac can resolve them. Briefly acknowledge receipt before waiting for the Mac. Do not pretend the Mac completed something until the tool returns success. Ordinary conversation and cloud tools stay available regardless of route.",
    "Phone safety boundary: ordinary conversation, factual help, live web search, reminders, and explicitly routed Mac requests are allowed. Mac-side policy still blocks or confirms sensitive actions. Never bypass its result, claim success after an error, contact another person, send or post a message, purchase, delete, log in, enter credentials, install, download, or change sensitive settings on your own.",
    "The caller has already passed Vox's private-sentence check. Never ask for that sentence again during this call and never reveal it.",
  ].join("\n\n");
}

export function phoneRealtimeCarryover(messages: ConversationMessage[]) {
  return formatConversationCarryover(boundedRecentMessages(messages));
}
