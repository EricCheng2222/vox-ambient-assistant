import type { StagePage } from "@/lib/stage";

// A readable version of a public web page for the stage's reader view:
// checking that a URL is safe for the server to fetch, fetching it with
// redirects re-checked, decoding its charset (Big5 and other legacy
// encodings included), and pulling out the title, description, image, and
// main-text paragraphs. Pure apart from the fetch function it is given, so it
// runs the same in Workers and in the Node tests.

export const STAGE_PAGE_LIMITS = {
  maxRedirects: 3,
  timeoutMs: 8_000,
  maxBytes: 2 * 1024 * 1024,
  maxParagraphs: 40,
  maxParagraphChars: 600,
  minParagraphChars: 30,
  minHeadingChars: 2,
} as const;

export class StagePageError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

// ---- URL safety ----

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".localdomain", ".home.arpa", ".arpa", ".onion", ".test", ".invalid", ".example"];

function ipv4Parts(host: string) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part <= 255) ? parts : null;
}

function isPublicIpv4([a, b, c]: number[]) {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast, reserved
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, documentation
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  return true;
}

/** Only global unicast (2000::/3), minus documentation, 6to4, and Teredo. */
function isPublicIpv6(host: string) {
  const address = host.slice(1, -1).toLowerCase();
  if (address.includes(".")) return false; // embedded IPv4 forms
  const [first = "", second = ""] = address.split(":");
  const a = first ? Number.parseInt(first, 16) : 0;
  const b = second ? Number.parseInt(second, 16) : 0;
  if ((a & 0xe000) !== 0x2000) return false;
  if (a === 0x2002) return false;
  if (a === 0x2001 && (b === 0 || b === 0x0db8)) return false;
  return true;
}

/**
 * Checks a URL the server is about to fetch: https (or http to a named
 * public host), no credentials, ports 80/443 only, and no local, private,
 * loopback, or link-local hosts. Returns the parsed URL or an error.
 */
export function validateStageUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value || value.length > 2048) return { ok: false, error: "Give a web address." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "That isn't a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Only web pages can be opened." };
  if (url.username || url.password) return { ok: false, error: "Addresses with a user name or password can't be opened." };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, error: "That address uses an unusual port." };
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (!host) return { ok: false, error: "That address has no host." };
  if (host.startsWith("[")) {
    if (url.protocol !== "https:" || !isPublicIpv6(host)) return { ok: false, error: "That address is not a public web page." };
    return { ok: true, url };
  }
  // The URL parser has already turned forms like 0x7f.1 or 2130706433 into
  // dotted IPv4.
  const ipv4 = ipv4Parts(host);
  if (ipv4) {
    if (url.protocol !== "https:" || !isPublicIpv4(ipv4)) return { ok: false, error: "That address is not a public web page." };
    return { ok: true, url };
  }
  if (
    host === "localhost" ||
    !host.includes(".") ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    !/^[a-z0-9.-]+$/u.test(host) ||
    /(^|\.)-|-(\.|$)|\.\./u.test(host) ||
    /^[0-9.]+$/u.test(host)
  ) {
    return { ok: false, error: "That address is not a public web page." };
  }
  return { ok: true, url };
}

// ---- Charset ----

const CHARSET_ALIASES: Record<string, string> = {
  big5: "big5",
  "big5-hkscs": "big5",
  "x-big5": "big5",
  "cn-big5": "big5",
  "x-x-big5": "big5",
  cp950: "big5",
  ms950: "big5",
  "windows-950": "big5",
  utf8: "utf-8",
  "unicode-1-1-utf-8": "utf-8",
};

function charsetFrom(value: string | null | undefined) {
  const match = /charset\s*=\s*["']?([\w.:-]+)/iu.exec(value ?? "");
  if (!match) return null;
  const label = match[1].toLowerCase();
  return CHARSET_ALIASES[label] ?? label;
}

/** The charset a page declares in its first bytes (a BOM or a meta tag). */
export function sniffCharset(bytes: Uint8Array) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  // Latin-1 keeps every byte as one character, enough to read ASCII markup.
  let head = "";
  const end = Math.min(bytes.length, 4096);
  for (let index = 0; index < end; index += 1) head += String.fromCharCode(bytes[index]);
  for (const tag of head.match(/<meta\b[^>]*>/giu) ?? []) {
    const direct = /\bcharset\s*=\s*["']?([\w.:-]+)/iu.exec(tag);
    if (direct) {
      const label = direct[1].toLowerCase();
      return CHARSET_ALIASES[label] ?? label;
    }
  }
  return null;
}

function decoderFor(label: string | null) {
  if (label) {
    try {
      return new TextDecoder(label);
    } catch {
      // An unknown label: fall back to UTF-8.
    }
  }
  return new TextDecoder("utf-8");
}

/** Decodes a page using its Content-Type charset, else its meta charset, else UTF-8. */
export function decodeHtml(bytes: Uint8Array, contentType: string | null) {
  // A BOM wins over the header, as in browsers.
  const bom = bytes[0] === 0xef || bytes[0] === 0xff || bytes[0] === 0xfe ? sniffCharset(bytes.subarray(0, 3)) : null;
  return decoderFor(bom ?? charsetFrom(contentType) ?? sniffCharset(bytes)).decode(bytes);
}

// ---- Text ----

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  shy: "", zwj: "", zwnj: "", lrm: "", rlm: "",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  copy: "©", reg: "®", trade: "™", deg: "°", plusmn: "±", times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾",
  sup2: "²", sup3: "³", micro: "µ", para: "¶", sect: "§", cent: "¢", pound: "£", yen: "¥", euro: "€",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", hearts: "♥", star: "☆", check: "✓",
  prime: "′", Prime: "″", permil: "‰", dagger: "†", Dagger: "‡", iexcl: "¡", iquest: "¿",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", yuml: "ÿ", szlig: "ß",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Auml: "Ä", Ccedil: "Ç", Eacute: "É", Egrave: "È", Ntilde: "Ñ", Ouml: "Ö", Uuml: "Ü",
};

export function decodeEntities(text: string) {
  return text.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});?/gu, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function collapse(text: string) {
  return text.replace(/[\u200b-\u200d\u2060\ufeff]/gu, "").replace(/[\s\u00a0\u3000\ue000]+/gu, " ").trim();
}

function clip(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Length for the paragraph threshold: CJK characters carry about two Latin ones' worth. */
function readableLength(text: string) {
  const wide = text.match(/[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/gu)?.length ?? 0;
  return text.length + wide;
}

// ---- HTML ----

type Tag = { name: string; closing: boolean; selfClosing: boolean; attributes: Record<string, string> };

const TAG_PATTERN =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?|\s*\/(?!>))*)\s*(\/?)>/gu;
const ATTRIBUTE_PATTERN = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gu;

function parseAttributes(source: string) {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    if (!(name in attributes)) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/** Walks the document as text runs and tags. Raw-text elements are skipped whole. */
function* tokens(html: string): Generator<{ text: string } | Tag> {
  let last = 0;
  TAG_PATTERN.lastIndex = 0;
  for (let match = TAG_PATTERN.exec(html); match; match = TAG_PATTERN.exec(html)) {
    if (match.index > last) yield { text: html.slice(last, match.index) };
    last = TAG_PATTERN.lastIndex;
    if (!match[2]) continue; // comment, doctype, CDATA, processing instruction
    const name = match[2].toLowerCase();
    const tag: Tag = { name, closing: match[1] === "/", selfClosing: match[4] === "/", attributes: parseAttributes(match[3] ?? "") };
    if (!tag.closing && RAW_TEXT.has(name)) {
      // Skip to the matching end tag without reading markup inside.
      const closer = new RegExp(`</${name}[\\s/>]`, "giu");
      closer.lastIndex = last;
      const end = closer.exec(html)?.index ?? -1;
      const close = end < 0 ? -1 : html.indexOf(">", end);
      last = close < 0 ? html.length : close + 1;
      TAG_PATTERN.lastIndex = last;
      if (name === "title") yield { ...tag, attributes: { text: html.slice(match.index + match[0].length, end < 0 ? html.length : end) } };
      continue;
    }
    yield tag;
  }
  if (last < html.length) yield { text: html.slice(last) };
}

const RAW_TEXT = new Set(["script", "style", "title", "textarea", "noscript", "template", "xmp", "iframe", "noembed", "noframes", "plaintext"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Left out with everything inside them. */
const SKIPPED = new Set(["nav", "footer", "header", "aside", "form", "button", "select", "svg", "math", "canvas", "video", "audio", "object", "dialog", "menu", "figure", "picture", "map"]);
/** Start or end a paragraph. */
const BLOCKS = new Set([
  "p", "div", "section", "article", "main", "li", "ul", "ol", "dl", "dt", "dd", "blockquote", "pre", "table", "thead", "tbody", "tfoot",
  "tr", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "address", "details", "summary", "center", "body", "caption",
]);
const HEADINGS = new Set(["h1", "h2", "h3"]);
// A private-use marker for a pending <br>; collapse() turns it into a space.
const LINE_BREAK = "\ue000";
// Class or id words that mark page furniture rather than the article.
const FURNITURE =
  /(?:^|[\s_-])(?:nav|navbar|menu|breadcrumbs?|sidebar|footer|header|masthead|share|sharing|social|comments?|related|recommend(?:ed|ations)?|advert(?:isement)?|ads?|sponsor(?:ed)?|promo|cookie|consent|banner|popup|modal|newsletter|subscribe|signup|login|toolbar|pagination|pager|tags|skip-link|visually-hidden|sr-only|hatnote|navbox|noprint|mw-editsection|catlinks|toc)(?:$|[\s_-])/iu;

type Paragraph = { text: string; heading: boolean; region: number; inMain: boolean };

type Extracted = {
  meta: Record<string, string>;
  title: string;
  baseHref: string | null;
  paragraphs: Paragraph[];
  /** Text length per <article>, by region number (0 is outside any article). */
  articleText: Map<number, number>;
};

function scan(html: string, useFurniture: boolean): Extracted {
  const meta: Record<string, string> = {};
  let title = "";
  let baseHref: string | null = null;
  const paragraphs: Paragraph[] = [];
  const articleText = new Map<number, number>();

  // Skipping: the element that started it and how deep in it we are.
  let skipName = "";
  let skipDepth = 0;
  // The article (an <article>, or an element marked as the article body)
  // and main column we are in: the element's name and how deep in it we are.
  let article: { name: string; nest: number } | null = null;
  let main: { name: string; nest: number } | null = null;
  let articleCount = 0;
  let region = 0;
  let headingDepth = 0;
  let cellOpen = false;
  // A table row made only of header cells reads like a heading.
  let headerCells = 0;
  let dataCells = 0;
  let buffer = "";
  let bufferHeading = false;

  const flush = () => {
    const text = collapse(decodeEntities(buffer));
    buffer = "";
    const heading = bufferHeading || (headerCells > 0 && dataCells === 0);
    bufferHeading = headingDepth > 0;
    cellOpen = false;
    headerCells = 0;
    dataCells = 0;
    if (!text) return;
    paragraphs.push({ text, heading, region: article ? region : 0, inMain: main !== null });
    if (article) articleText.set(region, (articleText.get(region) ?? 0) + readableLength(text));
  };

  for (const token of tokens(html)) {
    if ("text" in token) {
      if (!skipDepth) buffer += token.text;
      continue;
    }
    const { name, closing, attributes } = token;
    if (skipDepth) {
      if (name === skipName && !VOID.has(name) && !token.selfClosing) skipDepth += closing ? -1 : 1;
      continue;
    }
    if (!closing) {
      if (name === "meta") {
        const key = (attributes.property || attributes.name || "").toLowerCase();
        if (key && attributes.content !== undefined && !(key in meta)) meta[key] = attributes.content;
        continue;
      }
      if (name === "title") {
        if (!title) title = collapse(decodeEntities(attributes.text ?? ""));
        continue;
      }
      if (name === "base" && attributes.href && baseHref === null) baseHref = attributes.href;
      if (VOID.has(name) && name !== "br" && name !== "hr") continue;
      const furniture =
        useFurniture &&
        !["article", "main", "body", "html"].includes(name) &&
        (FURNITURE.test(attributes.class ?? "") || FURNITURE.test(attributes.id ?? "") || /^(?:navigation|banner|contentinfo|complementary|search|menu|menubar|dialog)$/u.test(attributes.role ?? ""));
      const hidden = "hidden" in attributes || attributes["aria-hidden"] === "true" || /display\s*:\s*none/iu.test(attributes.style ?? "");
      if ((SKIPPED.has(name) || furniture || hidden) && !token.selfClosing) {
        flush();
        skipName = name;
        skipDepth = 1;
        continue;
      }
    }
    const opens = !closing && !token.selfClosing && !VOID.has(name);
    if (article && name === article.name && (opens || closing)) {
      article.nest += closing ? -1 : 1;
      if (article.nest === 0) {
        flush();
        article = null;
      }
    } else if (!article && opens && (name === "article" || attributes.role === "article" || attributes.itemprop?.toLowerCase() === "articlebody")) {
      flush();
      articleCount += 1;
      region = articleCount;
      article = { name, nest: 1 };
    }
    if (main && name === main.name && (opens || closing)) {
      main.nest += closing ? -1 : 1;
      if (main.nest === 0) {
        flush();
        main = null;
      }
    } else if (!main && opens && name !== "body" && (name === "main" || attributes.role === "main")) {
      flush();
      main = { name, nest: 1 };
    }
    if (name === "td" || name === "th") {
      if (!closing) {
        if (cellOpen) buffer += " · ";
        cellOpen = true;
        if (name === "th") headerCells += 1;
        else dataCells += 1;
      } else {
        buffer += " ";
      }
      continue;
    }
    if (!BLOCKS.has(name)) continue;
    if (name === "br") {
      // One line break joins lines; two in a row end the paragraph.
      if (/\ue000\s*$/u.test(buffer)) flush();
      else buffer += LINE_BREAK;
      continue;
    }
    flush();
    if (HEADINGS.has(name)) {
      headingDepth = Math.max(0, headingDepth + (closing ? -1 : 1));
      bufferHeading = headingDepth > 0;
    }
  }
  flush();
  return { meta, title, baseHref, paragraphs, articleText };
}

function absoluteHttpsUrl(value: string | undefined, base: string) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function chooseParagraphs(extracted: Extracted, pageTitle: string) {
  const { paragraphs, articleText } = extracted;
  // The article with the most text, then <main>, then the whole page.
  let best = 0;
  let bestLength = 0;
  for (const [region, length] of articleText) {
    if (length > bestLength) {
      best = region;
      bestLength = length;
    }
  }
  const mainLength = paragraphs.filter((item) => item.inMain).reduce((sum, item) => sum + readableLength(item.text), 0);
  const chosen =
    bestLength >= 200
      ? paragraphs.filter((item) => item.region === best)
      : mainLength >= 200
        ? paragraphs.filter((item) => item.inMain)
        : paragraphs;
  const seen = new Set<string>();
  const result: Array<{ text: string; heading: boolean }> = [];
  for (const item of chosen) {
    const length = readableLength(item.text);
    if (item.heading ? length < STAGE_PAGE_LIMITS.minHeadingChars : length < STAGE_PAGE_LIMITS.minParagraphChars) continue;
    if (item.heading && item.text === pageTitle) continue;
    const text = clip(item.text, STAGE_PAGE_LIMITS.maxParagraphChars);
    if (seen.has(text)) continue;
    // Two headings in a row: the first introduced nothing.
    if (item.heading && result.at(-1)?.heading) result.pop();
    seen.add(text);
    result.push({ text, heading: item.heading });
    if (result.length >= STAGE_PAGE_LIMITS.maxParagraphs) break;
  }
  // A heading with nothing after it is not worth showing.
  while (result.at(-1)?.heading) result.pop();
  return result.map((item) => item.text);
}

export function siteName(url: URL | string) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
}

/** Title, description, image, site, and main-text paragraphs of an HTML page. */
export function extractStagePage(html: string, pageUrl: string): StagePage {
  let extracted = scan(html, true);
  const url = new URL(pageUrl);
  const base = (() => {
    try {
      return extracted.baseHref ? new URL(extracted.baseHref, url).toString() : url.toString();
    } catch {
      return url.toString();
    }
  })();
  const text = (value: string | undefined, max: number) => {
    const cleaned = collapse(decodeEntities(value ?? ""));
    return cleaned ? clip(cleaned, max) : "";
  };
  const title = text(extracted.meta["og:title"], 300) || text(extracted.title, 300) || siteName(url);
  const description = text(extracted.meta["og:description"] || extracted.meta.description || extracted.meta["twitter:description"], 500) || null;
  const image = absoluteHttpsUrl(
    extracted.meta["og:image:secure_url"] || extracted.meta["og:image"] || extracted.meta["og:image:url"] || extracted.meta["twitter:image"],
    base,
  );
  let paragraphs = chooseParagraphs(extracted, title);
  if (!paragraphs.length) {
    // Class-name heuristics can misfire (a site whose main column is called
    // "content-header"); try again without them.
    extracted = scan(html, false);
    paragraphs = chooseParagraphs(extracted, title);
  }
  return { url: url.toString(), site: siteName(url), title, description, image, paragraphs };
}

// ---- Fetching ----

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

async function readCapped(response: Response, maxBytes: number) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (size >= maxBytes) await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.min(chunk.byteLength, bytes.length - offset));
    bytes.set(part, offset);
    offset += part.byteLength;
    if (offset >= bytes.length) break;
  }
  return bytes;
}

/**
 * Fetches a public page and extracts it. Redirects are followed by hand (at
 * most three), each target checked again. Throws StagePageError.
 */
export async function fetchStagePage(rawUrl: string, fetcher: Fetcher = fetch): Promise<StagePage> {
  const checked = validateStageUrl(rawUrl);
  if (!checked.ok) throw new StagePageError(checked.error, 400);
  let url = checked.url;
  const signal = AbortSignal.timeout(STAGE_PAGE_LIMITS.timeoutMs);
  try {
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetcher(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; VoxReader/1.0)",
        },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("Location")) {
        await response.body?.cancel().catch(() => undefined);
        if (redirects >= STAGE_PAGE_LIMITS.maxRedirects) throw new StagePageError("That page redirects too many times.", 502);
        let next: URL;
        try {
          next = new URL(response.headers.get("Location")!, url);
        } catch {
          throw new StagePageError("That page redirects somewhere invalid.", 502);
        }
        const again = validateStageUrl(next.toString());
        if (!again.ok) throw new StagePageError("That page redirects somewhere Vox can't open.", 502);
        url = again.url;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new StagePageError(`That page answered ${response.status}.`, 502);
      }
      const contentType = response.headers.get("Content-Type");
      if (!/^\s*text\/html\b/iu.test(contentType ?? "")) {
        await response.body?.cancel().catch(() => undefined);
        throw new StagePageError("That address is not a web page.", 415);
      }
      const bytes = await readCapped(response, STAGE_PAGE_LIMITS.maxBytes);
      return extractStagePage(decodeHtml(bytes, contentType), url.toString());
    }
  } catch (error) {
    if (error instanceof StagePageError) throw error;
    if (signal.aborted) throw new StagePageError("That page took too long to load.", 504);
    throw new StagePageError("That page could not be loaded.", 502);
  }
}
