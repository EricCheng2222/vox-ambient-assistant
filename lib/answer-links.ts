export type AnswerRun = { text: string; href?: string };
type AnswerLink = { start: number; end: number; text: string; href: string };

/** Named citations and bare web addresses, without interpreting HTML or other markup. */
export function answerLinkRanges(text: string): AnswerLink[] {
  const links: AnswerLink[] = [];
  const start = /\[([^\]\n]{1,200})\]\((https?:\/\/)|https?:\/\//giu;
  let match: RegExpExecArray | null;
  while ((match = start.exec(text))) {
    const named = match[1] !== undefined;
    const from = named ? match.index + match[0].length - match[2].length : match.index;
    let end = from;
    let depth = 0;
    for (; end < text.length; end++) {
      const char = text[end];
      if (/[\s<>"\[\]`，。；！？]/u.test(char)) break;
      if (char === "(") depth++;
      if (char === ")") {
        if (depth === 0) break;
        depth--;
      }
    }
    if (named && (text[end] !== ")" || depth !== 0)) continue;
    const raw = text.slice(from, end).replace(named ? /$/u : /[.,;:!?]+$/u, "");
    if (!named) end = from + raw.length;
    let url: URL;
    try {
      url = new URL(raw);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
    } catch {
      continue;
    }
    links.push({ start: match.index, end: end + (named ? 1 : 0), text: named ? match[1] : url.hostname.replace(/^www\./u, ""), href: url.href });
    start.lastIndex = end + (named ? 1 : 0);
  }
  return links;
}

/** Visible text runs, with a source name in place of each citation's markup or address. */
export function answerLinks(text: string): AnswerRun[] {
  const runs: AnswerRun[] = [];
  let at = 0;
  for (const link of answerLinkRanges(text)) {
    if (link.start > at) runs.push({ text: text.slice(at, link.start) });
    runs.push({ text: link.text, href: link.href });
    at = link.end;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}
