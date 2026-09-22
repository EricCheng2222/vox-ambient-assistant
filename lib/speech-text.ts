/** Remove web references from speech while leaving the displayed answer intact. */
export function speechText(text: string): string {
  return text
    .replace(/\\([()[\]_])/g, "$1")
    .replace(/【\d+[^】]*†[^】]*】|cite[^]*/g, "")
    // Citation labels are not prose. Ordinary descriptive links keep their label.
    .replace(/\[([^\]]*)\]\(https?:\/\/[^\s]*?\)(?=\s|[).,，。；;！!？?]|$)/gi,
      (_, label: string) => /^(?:https?:\/\/|www\.)|^[\w.-]+\.[a-z]{2,}(?:\/.*)?$|^\d+$/i.test(label.trim()) ? "" : label)
    .replace(/(?:https?:\/\/|www\.)[^\s<>()[\]，。；！？]+/gi, "")
    .replace(/\[\s*\]|\(\s*\)|（\s*）/g, "")
    .replace(/\(\s*\)|（\s*）/g, "")
    .replace(/[ \t]+([，。；！？,.!?;])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
