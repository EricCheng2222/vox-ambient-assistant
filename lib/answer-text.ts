// Answers from the web-search model come with link markup meant for a
// rendered page: "([site.com](https://site.com/page?utm_source=openai))".
// For plain-text contexts that cannot render citation links.

/** The answer as plain words: citation links removed, named links reduced to their names. */
export function withoutLinkMarkup(text: string) {
  return text
    // A parenthetical that is nothing but citations: gone, with the space before it.
    .replace(/\s*\((?:\s*\[[^\]\n]{1,200}\]\(https?:\/\/[^)\s]+\)\s*[,;]?\s*)+\)/gu, "")
    // A link whose label is just the site or address: a citation, gone.
    .replace(/\s*\[(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}(?:\/[^\]\s]*)?\]\(https?:\/\/[^)\s]+\)/giu, "")
    // A named link keeps its name.
    .replace(/\[([^\]\n]{1,200})\]\(https?:\/\/[^)\s]+\)/gu, "$1")
    .replace(/[ \t]+([,.;:!?。，；：！？])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}
