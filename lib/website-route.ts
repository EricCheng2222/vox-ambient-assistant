// "Open YouTube", "打開 Gmail", "在 YouTube 搜尋 lo-fi": requests to open a
// website (or search on one). Only well-known sites and domains the user
// actually said become links, and only as https.

export type WebsiteRequest = {
  name: string;
  url: string;
  /** Set when the user asked to search on the site. */
  query?: string;
};

type Site = {
  name: string;
  pattern: RegExp;
  url: string;
  search?: (query: string) => string;
};

const q = encodeURIComponent;

const sites: Site[] = [
  { name: "YouTube", pattern: /you\s*tube|油管/iu, url: "https://www.youtube.com/", search: (s) => `https://www.youtube.com/results?search_query=${q(s)}` },
  { name: "YouTube Music", pattern: /youtube\s*music/iu, url: "https://music.youtube.com/", search: (s) => `https://music.youtube.com/search?q=${q(s)}` },
  { name: "Gmail", pattern: /\bgmail\b|谷歌信箱/iu, url: "https://mail.google.com/" },
  { name: "Google", pattern: /\bgoogle\b(?!\s*(?:maps?|地圖|drive|docs?|sheets?|calendar|chrome))|谷歌(?!地圖)/iu, url: "https://www.google.com/", search: (s) => `https://www.google.com/search?q=${q(s)}` },
  { name: "Google Maps", pattern: /google\s*(?:maps?|地圖)|谷歌地圖/iu, url: "https://maps.google.com/", search: (s) => `https://www.google.com/maps/search/${q(s)}` },
  { name: "Google Drive", pattern: /google\s*drive|雲端硬碟/iu, url: "https://drive.google.com/" },
  { name: "Google Docs", pattern: /google\s*docs?/iu, url: "https://docs.google.com/" },
  { name: "Google Calendar", pattern: /google\s*calendar|谷歌日曆/iu, url: "https://calendar.google.com/" },
  { name: "Netflix", pattern: /netflix|網飛/iu, url: "https://www.netflix.com/", search: (s) => `https://www.netflix.com/search?q=${q(s)}` },
  { name: "Facebook", pattern: /facebook|\bfb\b|臉書/iu, url: "https://www.facebook.com/" },
  { name: "Instagram", pattern: /instagram|\big\b/iu, url: "https://www.instagram.com/" },
  { name: "X", pattern: /\btwitter\b|推特/iu, url: "https://x.com/" },
  { name: "Threads", pattern: /\bthreads\b/iu, url: "https://www.threads.net/" },
  { name: "Reddit", pattern: /reddit/iu, url: "https://www.reddit.com/", search: (s) => `https://www.reddit.com/search/?q=${q(s)}` },
  { name: "Wikipedia", pattern: /wikipedia|維基百科/iu, url: "https://www.wikipedia.org/", search: (s) => `https://zh.wikipedia.org/w/index.php?search=${q(s)}` },
  { name: "GitHub", pattern: /github/iu, url: "https://github.com/", search: (s) => `https://github.com/search?q=${q(s)}` },
  { name: "ChatGPT", pattern: /chat\s*gpt/iu, url: "https://chatgpt.com/" },
  { name: "Claude", pattern: /\bclaude\b/iu, url: "https://claude.ai/" },
  { name: "LinkedIn", pattern: /linked\s*in/iu, url: "https://www.linkedin.com/" },
  { name: "Amazon", pattern: /amazon|亞馬遜/iu, url: "https://www.amazon.com/", search: (s) => `https://www.amazon.com/s?k=${q(s)}` },
  { name: "Shopee", pattern: /shopee|蝦皮/iu, url: "https://shopee.tw/", search: (s) => `https://shopee.tw/search?keyword=${q(s)}` },
  { name: "PChome", pattern: /pchome/iu, url: "https://24h.pchome.com.tw/", search: (s) => `https://ecshweb.pchome.com.tw/search/v3.3/?q=${q(s)}` },
  { name: "momo", pattern: /\bmomo\b/iu, url: "https://www.momoshop.com.tw/" },
  { name: "Spotify", pattern: /spotify/iu, url: "https://open.spotify.com/", search: (s) => `https://open.spotify.com/search/${q(s)}` },
  { name: "Twitch", pattern: /twitch/iu, url: "https://www.twitch.tv/" },
  { name: "Bilibili", pattern: /bilibili|b站|嗶哩嗶哩/iu, url: "https://www.bilibili.com/", search: (s) => `https://search.bilibili.com/all?keyword=${q(s)}` },
  { name: "Dcard", pattern: /dcard/iu, url: "https://www.dcard.tw/" },
  { name: "PTT", pattern: /\bptt\b/iu, url: "https://www.ptt.cc/bbs/" },
  { name: "Notion", pattern: /notion/iu, url: "https://www.notion.so/" },
  { name: "Outlook", pattern: /outlook/iu, url: "https://outlook.live.com/" },
];

const openVerb = /\b(?:open|launch|go to|bring up|pull up|show me|visit|take me to)\b|打開|打开|開啟|开启|開一下|開個|開|进入|進入|去|上|播放/iu;
const searchVerb = /(?:\bsearch(?:\s+for)?\b|\blook up\b|\bfind\b|搜尋|搜索|找一下|找)/iu;
// A domain the user spoke or typed, like "example.com" or "news.ycombinator.com".
const domainPattern = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|ai|app|dev|tw|com\.tw|jp|co|me|tv|edu|gov|so|gg|cc))\b/iu;
// Asking about a site rather than asking to open it.
const aboutSite = /\b(?:what is|who owns|how (?:does|do)|why)\b|是什麼|怎麼|為什麼|介紹/iu;

/** The search terms in "search lo-fi music on YouTube" / "在 YouTube 搜尋 lo-fi 音樂". */
function searchTerms(text: string, site: Site): string {
  const withoutSite = text.replace(site.pattern, " ");
  const after = withoutSite.split(searchVerb).slice(1).join(" ");
  return after
    .replace(/\b(?:on|in|at|please|for me)\b|在|上|幫我|帮我|給我|一下|吧|的影片|影片|的/giu, " ")
    .replace(/[。！？!?.,，]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectWebsiteRequest(rawText: string): WebsiteRequest | null {
  const text = rawText.trim();
  if (!text || text.length > 200 || aboutSite.test(text)) return null;
  const wantsSearch = searchVerb.test(text);
  if (!openVerb.test(text) && !wantsSearch) return null;

  // The most specific site wins ("YouTube Music" over "YouTube").
  const site = sites
    .filter((candidate) => candidate.pattern.test(text))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (site) {
    if (wantsSearch && site.search) {
      const query = searchTerms(text, site);
      if (query) return { name: site.name, url: site.search(query), query };
    }
    return { name: site.name, url: site.url };
  }

  const domain = domainPattern.exec(text)?.[1]?.toLowerCase();
  if (domain && openVerb.test(text)) return { name: domain, url: `https://${domain}/` };
  return null;
}

/** Only https links to real hostnames are ever opened. */
export function isOpenableWebsite(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
