// How a written reply is laid out on screen. Vox's replies are plain text;
// when one lists options or steps it puts each on its own line starting with
// "- ", name first, then " — " and the details. This reads that back into
// paragraphs and lists, so a list of hotels looks like a list and not a wall
// of prose. Anything that does not follow the convention is shown as it is.

export type AnswerItem = {
  /** The name of the thing, when the line leads with one ("Waterfront Hotel"). */
  lead: string;
  /** The rest of the line. */
  detail: string;
};

export type AnswerBlock =
  | { kind: "text"; text: string }
  | { kind: "list"; ordered: boolean; items: AnswerItem[] }
  // Things the user can choose, each written as what they would say; tapping one says it.
  | { kind: "choices"; choices: string[] };

/** A line that offers a choice starts with this. */
export const CHOICE_MARK = "→";
const CHOICE = /^\s*(?:→|->|➜)\s*(.+)$/u;
/** What a text message says to bring the user into the app; inside the app it is noise. */
const COME_TO_VOX = /\s*(?:打開 Vox 處理。|Open Vox to deal with (?:it|them)\.)?\s*https:\/\/\S*workers\.dev\S*/gu;

const BULLET = /^\s*(?:[-•*·]|(\d{1,2})[.)])\s+(.*)$/u;
/** The longest a line's opening can be and still count as a name. */
const MAX_LEAD = 64;

function item(line: string): AnswerItem {
  const text = line.replace(/\*\*(.+?)\*\*/gu, "$1").trim();
  // "Name — details" or "Name: details". A colon inside a time or a ratio is not a separator.
  const dash = /\s[—–]\s/u.exec(text);
  const colon = /:\s|：\s?/u.exec(text);
  const cut = dash && dash.index <= MAX_LEAD ? { at: dash.index, size: dash[0].length } : colon && colon.index <= MAX_LEAD && colon.index > 0 ? { at: colon.index, size: colon[0].length } : null;
  if (!cut) return { lead: "", detail: text };
  const detail = text.slice(cut.at + cut.size).trim();
  return detail ? { lead: text.slice(0, cut.at).trim(), detail } : { lead: "", detail: text };
}

/** A reply as blocks to draw. */
export function answerBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const text = paragraph.join(" ").replace(/\*\*(.+?)\*\*/gu, "$1").replace(/\s+/gu, " ").trim();
    if (text) blocks.push({ kind: "text", text });
    paragraph = [];
  };
  for (const line of answer.replace(/\r/gu, "").replace(COME_TO_VOX, "").split("\n")) {
    const choice = CHOICE.exec(line);
    if (choice) {
      flush();
      const said = choice[1].replace(/\*\*(.+?)\*\*/gu, "$1").trim().slice(0, 160);
      const last = blocks.at(-1);
      if (last?.kind === "choices") {
        if (last.choices.length < 4) last.choices.push(said);
      } else {
        blocks.push({ kind: "choices", choices: [said] });
      }
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet && bullet[2].trim()) {
      flush();
      const ordered = bullet[1] !== undefined;
      const last = blocks.at(-1);
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item(bullet[2]));
      else blocks.push({ kind: "list", ordered, items: [item(bullet[2])] });
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  // One "list" of a single unnamed line is just a sentence that began with a dash.
  return blocks.map((block) => (block.kind === "list" && block.items.length === 1 && !block.items[0].lead ? { kind: "text", text: block.items[0].detail } : block));
}

const NUMBER = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const MONEY = new RegExp(String.raw`(?:NT\$|US\$|HK\$|[$£€¥])\s?${NUMBER}|${NUMBER}\s?(?:元|円|TWD|USD|NTD)`, "gu");

/** A line cut into plain runs and amounts of money, so the amounts can be made to stand out. */
export function withAmounts(text: string): Array<{ text: string; amount: boolean }> {
  const runs: Array<{ text: string; amount: boolean }> = [];
  let at = 0;
  for (const match of text.matchAll(MONEY)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index), amount: false });
    runs.push({ text: match[0], amount: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), amount: false });
  return runs;
}

/** Told to whatever writes a reply that will be read rather than heard. */
export const WRITTEN_LAYOUT_INSTRUCTION =
  "This reply will be read on a screen, not spoken. Write plain text laid out for reading: a short opening sentence, then, when you give options, results, or steps, one per line starting with “- ”, with the name first, then “ — ” and the key facts (price, rating, the one reason it matters), kept to a line or two each. Put any caveat or next question in a short closing line. Leave a blank line between parts. No headings, tables, bold, links, or other markup. A simple answer stays a sentence or two with no list. When you ask the user to choose, or tell them about something they can act on, do not leave it as an open question: under it give two or three choices, each on its own line starting with “→ ” and written as the short thing the user would say to have you do it (“→ Read it to me”, “→ Draft a reply saying yes”, “→ Remind me tonight”). Offer only what you can actually do, and make each choice the one that gets the thing resolved.";
