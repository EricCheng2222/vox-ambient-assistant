import { withoutLinkMarkup } from "./answer-text.ts";
import { collectSources } from "./stage-answer.ts";
import type { StageContent } from "./stage.ts";

/** SDK answers carry links in text rather than Responses citation annotations. */
export function gptAnswer(question: string, answer: string, web: boolean) {
  const annotations: Array<{ type: string; url: string; title: string }> = [];
  if (web) {
    for (const match of answer.matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]+)\)/gu)) {
      annotations.push({ type: "url_citation", url: match[2], title: match[1] });
    }
    for (const match of answer.matchAll(/https?:\/\/[^\s<>\])]+/gu)) {
      annotations.push({ type: "url_citation", url: match[0].replace(/[.,;]+$/u, ""), title: "" });
    }
  }
  const sources = collectSources({ output: [{ type: "message", content: [{ type: "output_text", annotations }] }] });
  const stage: StageContent | undefined = sources.length ? { id: crypto.randomUUID(), title: question.trim().slice(0, 120), sources, blocks: [], createdAt: Date.now() } : undefined;
  return { answer: withoutLinkMarkup(answer), ...(stage ? { stage } : {}) };
}
