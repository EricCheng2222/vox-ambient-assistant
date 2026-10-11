import { routeForLookup, routeForOwnAccountTask, type LookupMode } from "./browser-agent.ts";
import { asksToRetry } from "./web-task-memory.ts";

// Triage: which part of Vox handles a request. The decision model answers
// two questions about the request (what kind of thing is being asked for,
// and where its answer lives); this file turns those answers, plus what this
// device can actually do, into a route. Keeping that last step in code means
// it can be read, tested, and measured, and a new capability changes a rule
// here instead of a paragraph of instructions to a model.

/** Where the information or the work for a request lives. */
export type RequestSource = "conversation" | "own_data" | "own_account_on_site" | "site" | "public_web" | "deep_thought" | "mac";

export const REQUEST_SOURCES: Record<RequestSource, string> = {
  conversation:
    "Nothing outside the conversation is needed: chat, opinions, advice, explanations, jokes, translation, the time and date, something the assistant already knows or was just told, or logging something the user did.",
  own_data:
    "The user's own records that the assistant keeps or is connected to: their email, calendar, to-dos, contacts, files in their drive, reminders, notes, workout and meal notebook, flash cards.",
  own_account_on_site:
    "Something inside the user's own account on a website or app: their orders, bookings, miles or points, messages, balance, profile; or signing in to a site for them.",
  site:
    "What one particular website or service currently shows to anyone: stays, flights, rides, products, listings, prices, availability, or posts on a named site (Airbnb, Amazon, an airline, a shop).",
  public_web:
    "Current public information not tied to one site: news, weather, scores, stock prices, opening hours, recent events, facts that may have changed, or anything the user asks to be looked up or checked online.",
  deep_thought:
    "No outside information is needed, but the problem is genuinely hard: a proof, a long derivation, a careful multi-step analysis or comparison of ideas.",
  mac: "Files, folders, apps, or code on the user's Mac.",
};

export const REQUEST_SOURCE_INSTRUCTIONS =
  "Where does the information or the work for the complete utterance live? Judge by what is being asked for, not by the words used. A request about the user's own things (my email, my orders, my miles, my calendar) is never public_web. A request that names a website or service and wants what that site shows is site, even when phrased as a search. Only choose deep_thought for problems a knowledgeable person would need to sit down and work through. When the utterance is small talk, a reaction, or a follow-up that needs nothing new, choose conversation.";

export function isRequestSource(value: unknown): value is RequestSource {
  return typeof value === "string" && value in REQUEST_SOURCES;
}

const ASKS_FOR_BROWSER =
  /\bcomputer[- ]use[d]?\b|\buse (?:the |your |my )?(?:computer|browser|mac)\b|\b(?:in|on|with|using|via) (?:the |your |my )?(?:browser|computer)\b|\bopen (?:the |a |its )?(?:site|website|web ?page|browser)\b|\bbrowse (?:to|the)\b|用電腦|用瀏覽器|開瀏覽器|打開網站|電腦操作|用\s*computer\s*use/iu;

/** Whether the user said to do this by operating the browser or the computer. */
export function asksForBrowser(text: string) {
  return ASKS_FOR_BROWSER.test(text);
}

const MAC_APPS = /\b(safari|chrome|finder|preview|notes|calculator|textedit|vs ?code|visual studio code|terminal|xcode|mail app|calendar app|photos|music|messages app|system settings)\b|備忘錄|計算機|訪達|預覽程式/iu;

/** Whether the user named an app on the Mac to work in. */
export function namesMacApp(text: string) {
  return MAC_APPS.test(text);
}

export type TriageInput = {
  /** What the decision model chose for "which part of Vox". */
  route: string;
  /** Where it says the answer lives; absent when the model was unavailable. */
  where?: RequestSource | null;
  whereConfidence?: number | null;
  text: string;
  /** A website task was carried out (or tried) from this device a short while ago. */
  recentWebTask?: boolean;
  /** Whether the decision model says this utterance repeats, retries, or adjusts that task; absent when it was not asked. */
  continuesWebTask?: boolean | null;
  /** The Mac app a desktop-control request would drive, and how it was arrived at. */
  desktopApp?: { id: string; source: "said" | "inferred" } | null;
};

/** Apps whose whole job is the web: with a browser of its own, Vox does not need to drive them. */
const WEB_BROWSER_APPS = new Set(["safari", "chrome"]);
/** Routes a follow-up on a website task may take over: the ones that answer, and the ones that work on the Mac. */
const FOLLOW_UP_FROM = new Set(["realtime", "live_web", "balanced_reasoning", "expert_reasoning", "desktop_control", "local_codex"]);

export type TriageDevice = {
  /** A browser Vox can work in: this Mac's, or the paired Mac's from a phone. */
  browserAvailable: boolean;
  lookupMode: LookupMode;
};

/** Routes that produce an answer in words, which is what triage chooses between. */
const ANSWERING = new Set(["realtime", "live_web", "balanced_reasoning", "expert_reasoning"]);
/** Below this (less likely than not, among seven choices), "where" is a guess and the first decision stands. */
const TRUST = 0.5;

/**
 * The route to take, and in a few words why (for diagnostics).
 * Routes that do a specific job (a reminder, a file, the Mac, silence) are
 * left alone; among the answering routes, where the answer lives decides.
 */
export function triage(input: TriageInput, device: TriageDevice): { route: string; why: string; useBrowser?: boolean; continues?: boolean } {
  // "Search again", "try the 1st instead", "yes, go ahead": the website task
  // from a moment ago, not a new web search and not a Mac app to drive.
  if (
    device.browserAvailable &&
    input.recentWebTask &&
    FOLLOW_UP_FROM.has(input.route) &&
    !namesMacApp(input.text) &&
    (input.continuesWebTask === true || (input.continuesWebTask == null && asksToRetry(input.text)))
  ) {
    return { route: "realtime", why: "continues the browser task", useBrowser: true, continues: true };
  }
  const decided = decide(input, device);
  // The answer is to be found by working a web page, not by talking.
  return /browser/u.test(decided.why) && decided.route === "realtime" && device.browserAvailable ? { ...decided, useBrowser: true } : decided;
}

function decide(input: TriageInput, device: TriageDevice): { route: string; why: string } {
  const { route, text } = input;
  // Driving Mac apps is for Mac apps. Something to find or do on the web goes
  // to Vox's own browser, which can search, sign in, and read pages; the Mac
  // app control is read-only and refuses most of that. Naming an app keeps it.
  if ((route === "desktop_control" || route === "local_codex") && device.browserAvailable && !namesMacApp(text)) {
    const confident = input.where && (input.whereConfidence ?? 1) >= TRUST ? input.where : null;
    // A coding job may well mention the web; only the user saying "use the computer / the browser" moves that one.
    const webTask = route === "desktop_control" && (confident === "site" || confident === "public_web" || confident === "own_account_on_site");
    // The user named no app and Safari or Chrome was only the model's guess at
    // where a web request would go: that is Vox's own browser's job.
    const guessedBrowser = route === "desktop_control" && input.desktopApp?.source === "inferred" && WEB_BROWSER_APPS.has(input.desktopApp.id);
    if (asksForBrowser(text) || webTask || guessedBrowser) return { route: "realtime", why: "a web task, in the browser" };
  }
  if (!ANSWERING.has(route)) return { route, why: "a specific job" };
  // "Use computer use", "do it in the browser": the user chose how, so that is how.
  if (device.browserAvailable && asksForBrowser(text)) return { route: "realtime", why: "asked for the browser" };

  const where = input.where && (input.whereConfidence ?? 1) >= TRUST ? input.where : null;
  if (!where) {
    // No usable answer about where: the keyword rules are the safety net.
    const byAccount = routeForOwnAccountTask(route, text, device.browserAvailable);
    const byLookup = routeForLookup(byAccount, text, device.browserAvailable, device.lookupMode);
    return { route: byLookup, why: byLookup === route ? "first decision" : "keyword rule" };
  }

  switch (where) {
    case "own_data":
      // Email, calendar, notebook, cards: those tools are with the live assistant.
      return { route: "realtime", why: "the user's own data" };
    case "own_account_on_site":
      // Only the browser can get into an account; without one the live assistant explains what to connect.
      return { route: "realtime", why: device.browserAvailable ? "their account, in the browser" : "their account, no browser here" };
    case "site":
      return device.browserAvailable ? { route: "realtime", why: "a named site, in the browser" } : { route: "live_web", why: "a named site, by web search" };
    case "public_web":
      return device.browserAvailable && device.lookupMode === "browser"
        ? { route: "realtime", why: "public web, browser chosen" }
        : { route: "live_web", why: "public web" };
    case "deep_thought":
      return route === "expert_reasoning" || route === "balanced_reasoning" ? { route, why: "hard thinking" } : { route: "balanced_reasoning", why: "hard thinking" };
    case "mac":
      return { route: "realtime", why: "the Mac" };
    default:
      // Nothing outside the conversation: no search, and no heavyweight model unless it was asked for by the first decision.
      return route === "live_web" ? { route: "realtime", why: "no lookup needed" } : { route, why: "conversation" };
  }
}
