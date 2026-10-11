import { collectSources } from "./stage-answer.ts";
import { answerLinkRanges } from "./answer-links.ts";
import type { StageContent } from "./stage.ts";

/** SDK answers carry links in text rather than Responses citation annotations. */
export function gptAnswer(question: string, answer: string, web: boolean) {
  const annotations: Array<{ type: string; url: string; title: string }> = [];
  if (web) {
    for (const link of answerLinkRanges(answer)) {
      annotations.push({ type: "url_citation", url: link.href, title: link.text });
    }
  }
  const sources = collectSources({ output: [{ type: "message", content: [{ type: "output_text", annotations }] }] });
  const stage: StageContent | undefined = sources.length ? { id: crypto.randomUUID(), title: question.trim().slice(0, 120), sources, blocks: [], createdAt: Date.now() } : undefined;
  return { answer: answer.trim(), ...(stage ? { stage } : {}) };
}
