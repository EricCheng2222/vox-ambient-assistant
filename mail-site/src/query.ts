// Gmail-style search ("from:amy is:unread newer_than:7d invoice") parsed into
// parts that IMAP SEARCH and Microsoft Graph can express. Gmail itself gets
// the query as typed.

export type ParsedQuery = {
  from: string[];
  to: string[];
  subject: string[];
  text: string[];
  unread?: boolean;
  starred?: boolean;
  after?: Date;
  before?: Date;
  hasAttachment?: boolean;
  folder?: string;
};

const DAY_MS = 24 * 60 * 60_000;

function relative(value: string, now: Date) {
  const match = /^(\d{1,4})([dwmy])$/iu.exec(value);
  if (!match) return undefined;
  const days = Number(match[1]) * { d: 1, w: 7, m: 30, y: 365 }[match[2].toLowerCase() as "d" | "w" | "m" | "y"];
  return new Date(now.getTime() - days * DAY_MS);
}

function absolute(value: string) {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/u.exec(value);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseQuery(query: string, now = new Date()): ParsedQuery {
  const parsed: ParsedQuery = { from: [], to: [], subject: [], text: [] };
  for (const match of query.matchAll(/(-?)([A-Za-z_]+):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/gu)) {
    const [, negated, operator, quotedValue, plainValue, phrase, word] = match;
    if (negated) continue;
    if (phrase !== undefined || word !== undefined) {
      const text = (phrase ?? word ?? "").trim();
      if (text && !/^(AND|OR)$/u.test(text) && !text.startsWith("-")) parsed.text.push(text);
      continue;
    }
    const value = (quotedValue ?? plainValue ?? "").trim();
    if (!value) continue;
    switch (operator.toLowerCase()) {
      case "from":
        parsed.from.push(value);
        break;
      case "to":
      case "cc":
        parsed.to.push(value);
        break;
      case "subject":
        parsed.subject.push(value);
        break;
      case "is": {
        const flag = value.toLowerCase();
        if (flag === "unread") parsed.unread = true;
        else if (flag === "read") parsed.unread = false;
        else if (flag === "starred" || flag === "flagged") parsed.starred = true;
        else if (flag === "unstarred") parsed.starred = false;
        break;
      }
      case "newer_than":
        parsed.after = relative(value, now) ?? parsed.after;
        break;
      case "older_than":
        parsed.before = relative(value, now) ?? parsed.before;
        break;
      case "after":
      case "since":
        parsed.after = absolute(value) ?? parsed.after;
        break;
      case "before":
        parsed.before = absolute(value) ?? parsed.before;
        break;
      case "has":
        if (value.toLowerCase() === "attachment") parsed.hasAttachment = true;
        break;
      case "in":
      case "label":
        parsed.folder = value;
        break;
      default:
        // Gmail-only operators (category:, list:, …) are dropped elsewhere.
        break;
    }
  }
  return parsed;
}

/** IMAP's date format for SEARCH, e.g. 29-Sep-2026. */
export function imapDate(date: Date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}
