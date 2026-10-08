// Websites the user can sign in to inside Vox's built-in browser (Mac app),
// so Vox can look things up and act there for them. The user always types
// their own password on the site itself; Vox only knows whether a sign-in
// is present, never what it is. Banks and payment services are left out on
// purpose: Vox doesn't move money.

export type WebAccountCategory = "Shopping" | "Rides and food" | "Travel" | "Social" | "Messages" | "Watch and listen" | "Work and study";

export type WebAccountService = {
  id: string;
  name: string;
  category: WebAccountCategory;
  /** Where signing in starts. */
  url: string;
  /** Cookie domains that belong to the service. */
  domains: string[];
  /** Cookies the site sets only for a signed-in visitor, when known. */
  cookies?: string[];
};

const service = (id: string, name: string, category: WebAccountCategory, url: string, domains: string[], cookies?: string[]): WebAccountService => ({
  id,
  name,
  category,
  url,
  domains,
  ...(cookies ? { cookies } : {}),
});

export const WEB_ACCOUNT_SERVICES: WebAccountService[] = [
  service("amazon", "Amazon", "Shopping", "https://www.amazon.com/gp/css/homepage.html", ["amazon.com"], ["at-main", "x-main", "sess-at-main"]),
  service("amazon-jp", "Amazon Japan", "Shopping", "https://www.amazon.co.jp/gp/css/homepage.html", ["amazon.co.jp"], ["at-acbjp", "x-acbjp", "sess-at-acbjp"]),
  service("ebay", "eBay", "Shopping", "https://www.ebay.com/mye/myebay/summary", ["ebay.com"]),
  service("shopee", "Shopee", "Shopping", "https://shopee.tw/buyer/login", ["shopee.tw"], ["SPC_ST", "SPC_U"]),
  service("momo", "momo", "Shopping", "https://www.momoshop.com.tw/customer/login.jsp", ["momoshop.com.tw"]),
  service("pchome", "PChome 24h", "Shopping", "https://ecvip.pchome.com.tw/login/v3/login.htm", ["pchome.com.tw"]),
  service("rakuten", "Rakuten", "Shopping", "https://www.rakuten.com.tw/member/signin/", ["rakuten.com.tw"]),
  service("costco", "Costco", "Shopping", "https://www.costco.com.tw/login", ["costco.com.tw"]),
  service("ikea", "IKEA", "Shopping", "https://www.ikea.com.tw/zh/profile/login", ["ikea.com.tw"]),
  service("apple", "Apple Store", "Shopping", "https://secure.store.apple.com/shop/account/home", ["apple.com"]),

  service("uber", "Uber", "Rides and food", "https://m.uber.com/go/home", ["uber.com"], ["sid", "csid"]),
  service("uber-eats", "Uber Eats", "Rides and food", "https://www.ubereats.com/login-redirect/", ["ubereats.com"], ["sid", "uev2.id.session"]),
  service("foodpanda", "foodpanda", "Rides and food", "https://www.foodpanda.com.tw/login", ["foodpanda.com.tw"], ["token", "refresh_token"]),
  service("grab", "Grab", "Rides and food", "https://food.grab.com/", ["grab.com"]),
  service("lyft", "Lyft", "Rides and food", "https://ride.lyft.com/", ["lyft.com"]),
  service("doordash", "DoorDash", "Rides and food", "https://www.doordash.com/consumer/login/", ["doordash.com"]),

  service("airbnb", "Airbnb", "Travel", "https://www.airbnb.com/login", ["airbnb.com"], ["_aat", "_airbed_session_id"]),
  service("booking", "Booking.com", "Travel", "https://account.booking.com/sign-in", ["booking.com"]),
  service("agoda", "Agoda", "Travel", "https://www.agoda.com/account/signin.html", ["agoda.com"]),
  service("expedia", "Expedia", "Travel", "https://www.expedia.com/login", ["expedia.com"]),
  service("trip", "Trip.com", "Travel", "https://www.trip.com/account/signin", ["trip.com"]),
  service("klook", "Klook", "Travel", "https://www.klook.com/signin/", ["klook.com"]),
  service("kkday", "KKday", "Travel", "https://www.kkday.com/zh-tw/member/login", ["kkday.com"]),
  service("thsr", "Taiwan High Speed Rail", "Travel", "https://www.thsrc.com.tw/", ["thsrc.com.tw"]),
  service("tra", "Taiwan Railway", "Travel", "https://www.railway.gov.tw/tra-tip-web/tip/tip008/tip811/memberLogin", ["railway.gov.tw"]),

  service("instagram", "Instagram", "Social", "https://www.instagram.com/accounts/login/", ["instagram.com"], ["sessionid"]),
  service("facebook", "Facebook", "Social", "https://www.facebook.com/login", ["facebook.com"], ["c_user"]),
  service("x", "X (Twitter)", "Social", "https://x.com/i/flow/login", ["x.com", "twitter.com"], ["auth_token"]),
  service("threads", "Threads", "Social", "https://www.threads.net/login", ["threads.net", "threads.com"], ["sessionid"]),
  service("linkedin", "LinkedIn", "Social", "https://www.linkedin.com/login", ["linkedin.com"], ["li_at"]),
  service("reddit", "Reddit", "Social", "https://www.reddit.com/login/", ["reddit.com"], ["reddit_session", "token_v2"]),
  service("dcard", "Dcard", "Social", "https://www.dcard.tw/signin", ["dcard.tw"]),
  service("ptt", "PTT", "Social", "https://term.ptt.cc/", ["ptt.cc"]),

  service("messenger", "Messenger", "Messages", "https://www.messenger.com/login/", ["messenger.com"], ["c_user"]),
  service("whatsapp", "WhatsApp", "Messages", "https://web.whatsapp.com/", ["whatsapp.com"]),
  service("telegram", "Telegram", "Messages", "https://web.telegram.org/a/", ["telegram.org"]),
  service("discord", "Discord", "Messages", "https://discord.com/login", ["discord.com"]),
  service("slack", "Slack", "Messages", "https://slack.com/signin", ["slack.com"], ["d"]),

  service("youtube", "YouTube", "Watch and listen", "https://www.youtube.com/account", ["youtube.com"], ["SAPISID", "__Secure-3PAPISID", "LOGIN_INFO"]),
  service("netflix", "Netflix", "Watch and listen", "https://www.netflix.com/login", ["netflix.com"], ["NetflixId", "SecureNetflixId"]),
  service("spotify", "Spotify", "Watch and listen", "https://accounts.spotify.com/login", ["spotify.com"], ["sp_dc"]),
  service("disney", "Disney+", "Watch and listen", "https://www.disneyplus.com/login", ["disneyplus.com"]),
  service("twitch", "Twitch", "Watch and listen", "https://www.twitch.tv/login", ["twitch.tv"], ["auth-token"]),
  service("kkbox", "KKBOX", "Watch and listen", "https://kkid.kkbox.com/login", ["kkbox.com"]),

  service("github", "GitHub", "Work and study", "https://github.com/login", ["github.com"], ["user_session", "__Host-user_session_same_site"]),
  service("notion", "Notion", "Work and study", "https://www.notion.so/login", ["notion.so", "notion.com"], ["token_v2"]),
  service("dropbox", "Dropbox", "Work and study", "https://www.dropbox.com/login", ["dropbox.com"]),
  service("canva", "Canva", "Work and study", "https://www.canva.com/login", ["canva.com"]),
  service("coursera", "Coursera", "Work and study", "https://www.coursera.org/?authMode=login", ["coursera.org"], ["CAUTH"]),
  service("chatgpt", "ChatGPT", "Work and study", "https://chatgpt.com/auth/login", ["chatgpt.com", "openai.com"], ["__Secure-next-auth.session-token"]),
];

export const WEB_ACCOUNT_CATEGORIES: WebAccountCategory[] = ["Shopping", "Rides and food", "Travel", "Social", "Messages", "Watch and listen", "Work and study"];

/** What the Mac app is asked to check: ids, domains, and cookie names. Nothing secret. */
export function webAccountChecks(services = WEB_ACCOUNT_SERVICES) {
  return services.map((item) => ({ id: item.id, domains: item.domains, cookies: item.cookies ?? [] }));
}

// Names sites commonly give a cookie that only a signed-in visitor has.
const SESSION_LIKE = /(^|[_.-])(sess(ion)?(_?id)?|sid|auth([_-]?token)?|token|login|logged[_-]?in|user[_-]?(id|session)|access[_-]?token|jwt|remember)([_.-]|$)/iu;
// And ones every visitor gets, signed in or not.
const VISITOR_ONLY = /csrf|xsrf|consent|locale|lang|theme|ab[_-]?test|_ga|_gid|_fbp|_gcl|visitor|device|anon|guest|tracking|cf_|__cf|optanon|cookie[_-]?(consent|banner)/iu;

/**
 * Whether a set of cookie names looks like a sign-in. With the service's own
 * known cookies that is exact; otherwise it is a careful guess from how the
 * names read, erring toward "not signed in".
 */
export function looksSignedIn(cookieNames: string[], known: string[] = []) {
  if (known.length) return cookieNames.some((name) => known.includes(name));
  return cookieNames.some((name) => SESSION_LIKE.test(name) && !VISITOR_ONLY.test(name));
}

export type WebAccountBridge = {
  /** For each service id, whether a sign-in is present in the built-in browser. */
  status: (checks: ReturnType<typeof webAccountChecks>) => Promise<Record<string, boolean>>;
  /** Removes the service's cookies and stored data from the built-in browser. */
  signOut: (domains: string[]) => Promise<boolean>;
};

export function webAccountBridge(): WebAccountBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { voxLocalCodex?: { accounts?: WebAccountBridge } }).voxLocalCodex?.accounts ?? null;
}

/** What the live model is told about the sites the user has signed in to. */
export function webAccountsInstruction(signedInIds: string[]) {
  const names = WEB_ACCOUNT_SERVICES.filter((item) => signedInIds.includes(item.id)).map((item) => item.name);
  if (!names.length) {
    return "The user can sign in to websites (Amazon, Uber, Airbnb, Instagram and others) inside Vox on this Mac: Settings, Connected accounts, Websites. If they ask you to do something on a site that needs their account, offer to open its sign-in page for them; they sign in themselves.";
  }
  return `The user is signed in to these websites inside Vox's built-in browser on this Mac: ${names.join(", ")}. When they ask for something there (check an order, find a ride, look at messages), open the site with show_on_stage and work on the page with browser_look and browser_act. For other sites they can sign in under Settings, Connected accounts, Websites.`;
}
