import path from "node:path";

import { app, ipcMain, safeStorage, session, shell, WebContentsView } from "electron";

import { browserLanguages, browserUserAgent } from "./browser-identity.mjs";
import { lookForRelay } from "./stage-browser-relay.mjs";
import { createVault, fieldKind, vaultHost } from "./secure-vault.mjs";

// The stage's built-in browser: a real web view Vox opens beside the
// conversation to show the page it is talking about. The page it shows is the
// open web, so it runs in its own sandboxed profile with no access to Vox, no
// device permissions, and no downloads. The Vox page decides where it sits
// (a rectangle inside the stage) and hides it whenever anything overlaps it.

const PARTITION = "persist:vox-browser";
const MAX_READ_CHARACTERS = 20_000;

export function isBrowsableUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** A rectangle from the Vox page, in its own CSS pixels. */
export function sanitizeBounds(value) {
  const number = (key) => {
    const parsed = Number(value?.[key]);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  };
  return {
    x: Math.max(0, number("x")),
    y: Math.max(0, number("y")),
    width: Math.max(0, Math.min(number("width"), 10_000)),
    height: Math.max(0, Math.min(number("height"), 10_000)),
  };
}

/**
 * The most room the page gets while it is not shown on the stage. It sits
 * inside the window, exactly underneath the Vox page, which covers it; so it
 * is never larger than that page. (Put outside the window's edge instead, it
 * counts as hidden and draws nothing.)
 */
const PARKED = { x: 0, y: 0, width: 1_100, height: 800 };
/** Left alone this long while out of sight, the page is put to sleep until it is next used. */
const REST_AFTER_MS = 3 * 60_000;

/** How many things on a page are listed for the model at once. */
const MAX_ELEMENTS = 110;

// Runs in the page: numbers what can be clicked or filled in (data-vox-ref)
// and returns it with the page's visible text. What sits in something open on
// top of the page (a calendar, a dialog) is listed first, then what appeared
// since the last look (a list of suggestions, a section that unfolded), then
// the rest: the thing just opened is what the next step is about, and on a
// long page it would otherwise fall off the end of the list.
const LOOK_SCRIPT = `(() => {
  const clean = (value, max) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
  for (const old of document.querySelectorAll("[data-vox-ref]")) old.removeAttribute("data-vox-ref");
  const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="searchbox"], [role="textbox"], [role="gridcell"], [contenteditable="true"]';
  const viewH = window.innerHeight, viewW = window.innerWidth;
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    if (box.width < 4 || box.height < 4 || box.bottom < 0 || box.top > viewH * 2 || box.right < 0 || box.left > viewW) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
  };
  const usable = (el) => {
    if (el.disabled || el.getAttribute("aria-disabled") === "true" || el.getAttribute("aria-hidden") === "true") return false;
    // A calendar day or table cell that holds its own button is listed once, as that button.
    if (el.getAttribute("role") === "gridcell" && el.querySelector('button, a[href], [role="button"]')) return false;
    return shown(el);
  };
  const pick = (root, skip) => {
    const out = [];
    for (const el of root.querySelectorAll(selector)) {
      if (out.length >= 300) break;
      if (skip && skip.contains(el)) continue;
      if (usable(el)) out.push(el);
    }
    return out;
  };
  const layer = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]')]
    .filter((el) => { const box = el.getBoundingClientRect(); return box.width > 120 && box.height > 80 && shown(el); })
    .at(-1) || null;
  const onTop = layer ? pick(layer, null) : [];
  const behind = pick(document, layer);
  if (!window.__voxSeen) Object.defineProperty(window, "__voxSeen", { value: new WeakSet(), enumerable: false });
  const seen = window.__voxSeen;
  const all = [...onTop, ...behind];
  const fresh = new Set(all.filter((el) => !seen.has(el)));
  // On a page looked at for the first time everything is new, which says nothing.
  const tellNew = fresh.size > 0 && fresh.size < all.length;
  for (const el of all) seen.add(el);
  const ordered = [...onTop, ...(tellNew ? behind.filter((el) => fresh.has(el)) : []), ...behind.filter((el) => !tellNew || !fresh.has(el))];
  const elements = [];
  for (const el of ordered) {
    if (elements.length >= ${MAX_ELEMENTS}) break;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const type = (el.getAttribute("type") || "").toLowerCase();
    let kind = "button";
    if (tag === "a" || role === "link") kind = "link";
    else if (tag === "select" || role === "combobox") kind = "menu";
    else if (type === "checkbox" || role === "checkbox" || role === "switch" || role === "menuitemcheckbox") kind = "checkbox";
    else if (type === "radio" || role === "radio" || role === "menuitemradio") kind = "option";
    else if (tag === "textarea" || el.isContentEditable || role === "textbox" || role === "searchbox" || (tag === "input" && !["button", "submit", "reset", "image", "file"].includes(type))) kind = "text field";
    else if (role === "tab") kind = "tab";
    else if (role === "menuitem" || role === "option") kind = "option";
    const labelled = el.getAttribute("aria-labelledby");
    const byId = labelled ? labelled.split(" ").map((id) => document.getElementById(id)?.innerText || "").join(" ") : "";
    const forLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.innerText : "";
    let label = clean(el.getAttribute("aria-label") || byId || forLabel || el.closest("label")?.innerText || (kind === "text field" ? el.getAttribute("placeholder") || el.getAttribute("name") : el.innerText || el.value) || el.getAttribute("title") || el.querySelector("img[alt]")?.getAttribute("alt") || "", 100);
    const cell = el.closest('[role="gridcell"], td, [data-iso], [data-date]');
    // A bare number or an icon says little. A calendar day reads "31" on the
    // button and "Saturday, 31 October 2026" just inside or around it.
    if (label.length < 4) {
      const inner = el.querySelector("[aria-label]")?.getAttribute("aria-label");
      const around = cell && cell !== el ? cell.getAttribute("aria-label") || cell.getAttribute("data-iso") || cell.getAttribute("data-date") || cell.getAttribute("title") : el.getAttribute("data-iso") || el.getAttribute("data-date");
      const fuller = clean(inner || around || el.getAttribute("title") || "", 100);
      if (fuller) label = label && !fuller.includes(label) ? clean(label + " (" + fuller + ")", 100) : fuller;
    }
    const chosen = [el, cell].some((item) => item && (item.getAttribute("aria-selected") === "true" || item.getAttribute("aria-pressed") === "true" || ["true", "date", "page", "step"].includes(item.getAttribute("aria-current") || "")));
    const ref = elements.length;
    el.setAttribute("data-vox-ref", String(ref));
    // Never read back: passwords, card fields, codes, and anything filled from the private box.
    const secret = type === "password" || el.hasAttribute("data-vox-private") || /cc-|one-time-code/.test(el.getAttribute("autocomplete") || "");
    elements.push({
      ref, kind, label,
      value: kind === "text field" && !secret ? clean(el.value ?? el.innerText, 80) : kind === "checkbox" || kind === "option" ? String(el.checked ?? el.getAttribute("aria-checked") ?? el.getAttribute("aria-selected") ?? "") : tag === "select" ? clean(el.selectedOptions?.[0]?.innerText, 60) : chosen ? "selected" : "",
      hint: clean([type, el.getAttribute("autocomplete"), el.getAttribute("name"), el.getAttribute("inputmode")].filter(Boolean).join(" "), 80),
      where: layer && layer.contains(el) ? "on top" : tellNew && fresh.has(el) ? "new" : "",
    });
  }
  const main = document.querySelector('[role="main"], main') || document.body;
  // A "confirm you are human" widget in plain view (not the small badge some sites keep in a corner).
  const challenge = [...document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"], iframe[src*="challenges.cloudflare.com"], iframe[src*="arkoselabs"], iframe[src*="geetest"]')].some((frame) => {
    const box = frame.getBoundingClientRect();
    return box.width >= 240 && box.height >= 64 && box.bottom > 0 && box.top < viewH && getComputedStyle(frame).visibility !== "hidden";
  });
  return {
    challenge,
    url: location.href,
    title: document.title,
    text: (main ? main.innerText : "").slice(0, 6000),
    // What the open calendar, menu or dialog says, when it is not part of the page's own text.
    overlay: layer && !(main && main.contains(layer)) ? clean((layer.getAttribute("aria-label") || "") + " " + layer.innerText, 400) : "",
    elements,
  };
})()`;

/** Fields Vox never types into; the page-side rules repeat this check. */
const SECRET_FIELD = /password|passcode|one-time-code|otp|cc-|card|cvc|cvv|csc|security code|ssn|pin\b|密碼|驗證碼|卡號|安全碼|身分證/iu;

function actScript(request) {
  return `((request) => {
    const scroll = request.action === "scroll_down" ? 1 : request.action === "scroll_up" ? -1 : 0;
    if (scroll) { window.scrollBy({ top: scroll * Math.round(window.innerHeight * 0.8), behavior: "instant" }); return { ok: true, message: "Scrolled." }; }
    const el = document.querySelector('[data-vox-ref="' + request.ref + '"]');
    if (!el || !el.isConnected) return { ok: false, message: "That element is gone; look at the page again." };
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const fire = (type, init) => el.dispatchEvent(new (init?.key ? KeyboardEvent : Event)(type, { bubbles: true, cancelable: true, ...init }));
    if (request.action === "show") return { ok: true, message: "Shown." };
    if (request.action === "click") {
      const box = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, view: window, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, button: 0 };
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, at));
      el.click();
      return { ok: true, message: "Clicked." };
    }
    if (request.action === "type") {
      el.focus();
      if (el.isContentEditable) {
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, request.text);
      } else {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, request.text); else el.value = request.text;
        fire("input", { inputType: "insertText", data: request.text });
        fire("change");
      }
      return { ok: true, message: "Typed." };
    }
    if (request.action === "select") {
      if (el.tagName !== "SELECT") return { ok: false, message: "That isn't a menu with fixed options; click it and pick from what appears." };
      const want = request.text.trim().toLowerCase();
      const option = [...el.options].find((item) => item.innerText.trim().toLowerCase() === want) || [...el.options].find((item) => item.innerText.toLowerCase().includes(want));
      if (!option) return { ok: false, message: "No such option. Options: " + [...el.options].slice(0, 20).map((item) => item.innerText.trim()).join(", ") };
      el.value = option.value;
      fire("input"); fire("change");
      return { ok: true, message: "Chose " + option.innerText.trim() + "." };
    }
    if (request.action === "press_enter") {
      el.focus();
      const key = { key: "Enter", code: "Enter", keyCode: 13, which: 13 };
      const went = fire("keydown", key);
      fire("keypress", key); fire("keyup", key);
      if (went && el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
      return { ok: true, message: "Pressed Enter." };
    }
    return { ok: false, message: "Unknown action." };
  })(${JSON.stringify(request)})`;
}

export function registerStageBrowser({ requireTrustedVoxSender, getWindow, getVoxView, restAfterMs = REST_AFTER_MS }) {
  let view = null;
  let visible = false;
  let lastBounds = { x: 0, y: 0, width: 0, height: 0 };
  // Asleep: out of the window and throttled, after a while with nobody using it.
  let resting = false;
  let restTimer = null;
  // While the user works the page from a phone, it is laid out at the phone's
  // size, so what they see is what the page really shows, at a size a finger can hit.
  let handSize = null;
  let handSizeUntil = 0;

  function profile() {
    const browserSession = session.fromPartition(PARTITION);
    if (!browserSession.__voxConfigured) {
      browserSession.__voxConfigured = true;
      browserSession.setUserAgent(browserUserAgent(browserSession.getUserAgent()), browserLanguages(app.getPreferredSystemLanguages?.() ?? []));
      // No camera, microphone, location, notifications, or anything else.
      browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      browserSession.setPermissionCheckHandler(() => false);
      browserSession.on("will-download", (event, item) => {
        event.preventDefault();
        const url = item.getURL();
        if (isBrowsableUrl(url)) void shell.openExternal(url);
      });
    }
    return browserSession;
  }

  function sendState() {
    try {
      sendStateNow();
    } catch {
      // A view was closed between the event and now; there is nobody to tell.
    }
  }

  function sendStateNow() {
    const vox = getVoxView();
    if (!vox || !vox.webContents || vox.webContents.isDestroyed()) return;
    const contents = view?.webContents;
    vox.webContents.send("vox-browser:state", contents && !contents.isDestroyed()
      ? {
          url: contents.getURL(),
          title: contents.getTitle(),
          loading: contents.isLoading(),
          canGoBack: contents.navigationHistory.canGoBack(),
          canGoForward: contents.navigationHistory.canGoForward(),
        }
      : null);
  }

  function ensureView() {
    if (view && !view.webContents.isDestroyed()) return view;
    view = new WebContentsView({
      webPreferences: {
        session: profile(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        // Vox works on pages nobody is looking at (a task sent from the phone,
        // the window minimised). A page that believes it is hidden stops
        // drawing, and then its menus, calendars and lazy lists never appear.
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor("#ffffff");
    // A size before it is first placed, so the page lays out even while out of sight.
    view.setBounds(PARKED);
    park();
    // The page sits inside the stage's browser frame as a rounded card.
    view.setBorderRadius?.(10);
    const contents = view.webContents;
    // Links that would open a new tab open here instead. A pop-up a page
    // opens for itself ("Continue with Google", a payment step) gets a small
    // window of its own, in the same profile, so it can hand its result back.
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === "new-window" && (url === "about:blank" || url === "" || isBrowsableUrl(url))) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 520,
            height: 700,
            parent: getWindow() ?? undefined,
            autoHideMenuBar: true,
            title: "Vox",
            webPreferences: { session: profile(), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
          },
        };
      }
      if (isBrowsableUrl(url)) void contents.loadURL(url);
      return { action: "deny" };
    });
    contents.on("did-create-window", (popup) => {
      const child = popup.webContents;
      // A pop-up stays one window: anything it opens loads in it.
      child.setWindowOpenHandler(({ url }) => {
        if (isBrowsableUrl(url)) void child.loadURL(url);
        return { action: "deny" };
      });
      for (const name of ["will-navigate", "will-redirect"]) {
        child.on(name, (event, url) => {
          if (!isBrowsableUrl(url) && url !== "about:blank") event.preventDefault();
        });
      }
    });
    contents.on("will-navigate", (event, url) => {
      if (!isBrowsableUrl(url)) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (!isBrowsableUrl(url)) event.preventDefault();
    });
    for (const name of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]) {
      contents.on(name, sendState);
    }
    for (const name of ["did-start-loading", "did-navigate", "dom-ready"]) contents.on(name, () => keepAwake(contents));
    return view;
  }

  function place() {
    const window = getWindow();
    const vox = getVoxView();
    if (!window || !vox || !view) return;
    const attached = window.contentView.children.includes(view);
    const show = visible && lastBounds.width > 20 && lastBounds.height > 20;
    if (!show) {
      if (!resting) park();
      return;
    }
    resting = false;
    // Back on top of the Vox page (it may be parked underneath).
    if (attached && window.contentView.children.at(-1) !== view) window.contentView.removeChildView(view);
    const onTop = window.contentView.children.includes(view);
    const origin = vox.getBounds();
    view.setBounds({
      x: origin.x + lastBounds.x,
      y: origin.y + lastBounds.y,
      width: Math.min(lastBounds.width, Math.max(1, origin.width - lastBounds.x)),
      height: Math.min(lastBounds.height, Math.max(1, origin.height - lastBounds.y)),
    });
    // Added last, so it sits above the Vox page.
    if (!onTop) window.contentView.addChildView(view);
  }

  // Out of sight but still part of the window: underneath the Vox page. Taken
  // out of the window, the page would count as hidden and stop drawing; kept
  // in it, it is as live as a page on screen (when the window itself is not
  // visible, keepAwake below is what keeps its timers running).
  function park() {
    const window = getWindow();
    if (!window || !view) return;
    const children = window.contentView.children;
    if (children[0] !== view) {
      if (children.includes(view)) window.contentView.removeChildView(view);
      window.contentView.addChildView(view, 0);
    }
    // Never wider or taller than the Vox page above it: the window's own
    // toolbar and side panel are not covered by that page.
    const cover = getVoxView()?.getBounds?.() ?? PARKED;
    const want = handSize && Date.now() < handSizeUntil ? handSize : PARKED;
    view.setBounds({
      x: cover.x,
      y: cover.y,
      width: Math.max(1, Math.min(want.width, cover.width)),
      height: Math.max(1, Math.min(want.height, cover.height)),
    });
  }

  // The page is about to be used: make sure it is awake, and start the clock
  // on putting it back to sleep. A page left running underneath the window
  // would otherwise go on animating, playing, and using the battery for good.
  function wake() {
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    if (resting) {
      resting = false;
      place();
    } else if (handSize && Date.now() >= handSizeUntil) {
      // Nobody is working it by hand any more: back to its usual size.
      handSize = null;
      place();
    }
    keepAwake(contents);
    clearTimeout(restTimer);
    restTimer = setTimeout(rest, restAfterMs);
  }

  function rest() {
    const window = getWindow();
    if (!view || view.webContents.isDestroyed()) return;
    // On the stage the user is looking at it: it stays as it is.
    if (visible && lastBounds.width > 20 && lastBounds.height > 20) return;
    resting = true;
    if (window && window.contentView.children.includes(view)) window.contentView.removeChildView(view);
    try {
      view.webContents.setBackgroundThrottling(true);
    } catch {
      // Closed in the meantime.
    }
  }

  ipcMain.handle("vox-browser:open", async (event, url) => {
    requireTrustedVoxSender(event);
    if (!isBrowsableUrl(url)) throw new Error("Vox only opens web pages here.");
    const contents = ensureView().webContents;
    wake();
    if (contents.getURL() !== url) await contents.loadURL(url).catch(() => undefined);
    sendState();
    return true;
  });

  ipcMain.handle("vox-browser:layout", (event, request) => {
    requireTrustedVoxSender(event);
    visible = request?.visible === true;
    lastBounds = sanitizeBounds(request?.bounds);
    if (view) place();
    return true;
  });

  ipcMain.handle("vox-browser:command", (event, action) => {
    requireTrustedVoxSender(event);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) return false;
    if (action === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    else if (action === "forward" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    else if (action === "reload") contents.reload();
    else if (action === "stop") contents.stop();
    else if (action === "external") {
      const url = contents.getURL();
      if (isBrowsableUrl(url)) void shell.openExternal(url);
    } else return false;
    return true;
  });

  /** The page's visible text, for Vox to read and explain. Untrusted. */
  ipcMain.handle("vox-browser:read", async (event) => {
    requireTrustedVoxSender(event);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed() || !isBrowsableUrl(contents.getURL())) return null;
    const text = await contents
      .executeJavaScript(
        `(() => { const main = document.querySelector("main, article, [role=main]") || document.body; return (main ? main.innerText : "").slice(0, ${MAX_READ_CHARACTERS}); })()`,
        true,
      )
      .catch(() => "");
    return {
      url: contents.getURL(),
      title: contents.getTitle().slice(0, 300),
      text: typeof text === "string" ? text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_READ_CHARACTERS) : "",
    };
  });

  /** The page as a numbered list of what can be clicked or filled in. Untrusted. */
  ipcMain.handle("vox-browser:look", (event) => {
    requireTrustedVoxSender(event);
    return lookAtPage();
  });

  // Said again each time the page is used: a page loaded while out of sight
  // starts throttled whatever the setting it was created with says.
  function keepAwake(contents) {
    if (resting) return;
    try {
      contents.setBackgroundThrottling(false);
    } catch {
      // Closed in the meantime.
    }
  }

  async function lookAtPage() {
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed() || !isBrowsableUrl(contents.getURL())) return null;
    wake();
    const look = await contents.executeJavaScript(LOOK_SCRIPT, true).catch(() => null);
    if (!look || !Array.isArray(look.elements)) return null;
    return {
      url: contents.getURL(),
      title: contents.getTitle().slice(0, 300),
      text: typeof look.text === "string" ? look.text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 6_000) : "",
      overlay: typeof look.overlay === "string" ? look.overlay.slice(0, 400) : "",
      challenge: look.challenge === true,
      elements: look.elements.slice(0, MAX_ELEMENTS).map((element, index) => ({
        ref: index,
        kind: String(element?.kind ?? "button").slice(0, 20),
        label: String(element?.label ?? "").slice(0, 100),
        value: String(element?.value ?? "").slice(0, 80),
        hint: String(element?.hint ?? "").slice(0, 80),
        // "on top": inside an open calendar, menu or dialog. "new": appeared since the last look.
        where: element?.where === "on top" || element?.where === "new" ? element.where : "",
      })),
    };
  }

  /** One action on the page. Passwords, card numbers, and codes are never typed here. */
  ipcMain.handle("vox-browser:act", (event, request) => {
    requireTrustedVoxSender(event);
    return actOnPage(request);
  });

  async function actOnPage(request) {
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed() || !isBrowsableUrl(contents.getURL())) return { ok: false, message: "No web page is open." };
    const action = ["click", "type", "select", "press_enter", "scroll_down", "scroll_up", "show"].includes(request?.action) ? request.action : "";
    if (!action) return { ok: false, message: "Unknown action." };
    wake();
    const ref = Number.isInteger(request?.ref) && request.ref >= 0 && request.ref < 200 ? request.ref : -1;
    const text = typeof request?.text === "string" ? request.text.slice(0, 500) : "";
    if (action === "type") {
      const about = await contents
        .executeJavaScript(
          `(() => { const el = document.querySelector('[data-vox-ref="${ref}"]'); return el ? [el.getAttribute("type"), el.getAttribute("autocomplete"), el.getAttribute("name"), el.getAttribute("aria-label"), el.getAttribute("placeholder")].filter(Boolean).join(" ") : ""; })()`,
          true,
        )
        .catch(() => "");
      if (SECRET_FIELD.test(String(about))) {
        return { ok: false, message: "Vox doesn't type passwords, card numbers, or codes. Use ask_user_to_fill so the user can type it privately." };
      }
    }
    const result = await contents.executeJavaScript(actScript({ action, ref, text }), true).catch(() => null);
    // Let the page react before it is looked at again.
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      ok: result?.ok === true,
      message: typeof result?.message === "string" ? result.message.slice(0, 400) : "The page didn't respond.",
      url: contents.isDestroyed() ? "" : contents.getURL(),
    };
  }

  /**
   * The same look and act, asked for by the user's paired iPhone or iPad
   * (see main.mjs, performRemoteCommand). The page is used here, on this Mac,
   * where the user signed in; only what the page shows travels back, cut to
   * fit the relay. The same refusals apply: no passwords, cards, or codes.
   */
  async function remote(command) {
    if (command?.op === "look") {
      if (typeof command.open === "string" && command.open) {
        if (!isBrowsableUrl(command.open)) throw new Error("Vox only opens web pages there.");
        const contents = ensureView().webContents;
        wake();
        await contents.loadURL(command.open.slice(0, 2_000)).catch(() => undefined);
        sendState();
        // Pages built in the browser fill in after they load.
        await new Promise((resolve) => setTimeout(resolve, 2_500));
      }
      return JSON.stringify(lookForRelay(await lookAtPage()));
    }
    if (command?.op === "act") return JSON.stringify(await actOnPage(command.request));
    // What the user typed in the private box on their phone or tablet. It
    // arrived encrypted with the pairing key; it goes into the page (and, if
    // they asked, this Mac's encrypted store) and is never logged or echoed.
    if (command?.op === "fill") return JSON.stringify(await fillFields({ entries: command.entries, remember: command.remember === true }));
    if (command?.op === "saved") return JSON.stringify(await savedFields(command.refs));
    // The page as a picture, for the user to work with their own hands from
    // the phone (a "confirm you are human" check, a step Vox must not take).
    if (command?.op === "view") return JSON.stringify(await viewForRemote(command.input, command.size));
    throw new Error("That browser request is not supported.");
  }

  const unit = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * What the user did on the picture of the page, done to the page as real
   * input: a tap, a drag (for slider puzzles), typing, a key, a scroll.
   * Positions are fractions of the page's width and height.
   */
  async function userInput(contents, input) {
    const size = view.getBounds();
    const at = (point) => ({ x: Math.round(unit(point?.[0]) * size.width), y: Math.round(unit(point?.[1]) * size.height) });
    // The page takes the keyboard while the user works it from afar: typing goes where they tapped.
    contents.focus();
    if (input?.type === "tap") {
      const spot = at([input.x, input.y]);
      contents.sendInputEvent({ type: "mouseMove", ...spot });
      contents.sendInputEvent({ type: "mouseDown", ...spot, button: "left", clickCount: 1 });
      await pause(60);
      contents.sendInputEvent({ type: "mouseUp", ...spot, button: "left", clickCount: 1 });
    } else if (input?.type === "drag") {
      const from = at(input.from);
      const to = at(input.to);
      contents.sendInputEvent({ type: "mouseMove", ...from });
      contents.sendInputEvent({ type: "mouseDown", ...from, button: "left", clickCount: 1 });
      const steps = 16;
      for (let step = 1; step <= steps; step += 1) {
        await pause(22);
        contents.sendInputEvent({ type: "mouseMove", x: Math.round(from.x + ((to.x - from.x) * step) / steps), y: Math.round(from.y + ((to.y - from.y) * step) / steps), button: "left" });
      }
      await pause(80);
      contents.sendInputEvent({ type: "mouseUp", ...to, button: "left", clickCount: 1 });
    } else if (input?.type === "text" && typeof input.text === "string" && input.text) {
      await contents.insertText(input.text.slice(0, 500));
    } else if (input?.type === "key" && ["Enter", "Backspace", "Tab", "Escape"].includes(input.key)) {
      contents.sendInputEvent({ type: "keyDown", keyCode: input.key });
      // Enter and Tab also arrive as a character, which is what submits a form.
      if (input.key === "Enter" || input.key === "Tab") contents.sendInputEvent({ type: "char", keyCode: input.key });
      contents.sendInputEvent({ type: "keyUp", keyCode: input.key });
    } else if (input?.type === "scroll") {
      contents.sendInputEvent({ type: "mouseWheel", x: Math.round(size.width / 2), y: Math.round(size.height / 2), deltaX: 0, deltaY: input.down === false ? 480 : -480, wheelTicksY: input.down === false ? 4 : -4, canScroll: true });
    } else {
      return false;
    }
    return true;
  }

  /** Does what the user did (if anything), then sends back the page as it looks now, small enough for the relay. */
  async function viewForRemote(input, size) {
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed() || !isBrowsableUrl(contents.getURL())) throw new Error("No web page is open on the Mac.");
    wake();
    if (Array.isArray(size) && size.every((value) => Number.isFinite(value))) {
      const next = { width: Math.round(Math.max(320, Math.min(900, size[0]))), height: Math.round(Math.max(360, Math.min(1_000, size[1]))) };
      const changed = !handSize || handSize.width !== next.width || handSize.height !== next.height;
      handSize = next;
      handSizeUntil = Date.now() + 60_000;
      if (changed && !(visible && lastBounds.width > 20)) {
        park();
        // The page lays itself out again at its new size.
        await pause(700);
      }
    }
    if (input && (await userInput(contents, input))) await pause(input.type === "drag" ? 1_100 : 750);
    const shot = await contents.capturePage().catch(() => null);
    if (!shot || shot.isEmpty()) throw new Error("The Mac could not picture the page. Its Vox window has to be open on the screen (not minimised).");
    const full = shot.getSize();
    // Small enough to travel, large enough to read: never wider than a phone needs.
    let image = full.width > 760 ? shot.resize({ width: 760, quality: "good" }) : shot;
    let jpeg = image.toJPEG(62);
    for (const quality of [50, 40, 30]) {
      if (jpeg.length <= 150_000) break;
      jpeg = image.toJPEG(quality);
    }
    if (jpeg.length > 150_000) {
      image = shot.resize({ width: 520, quality: "good" });
      jpeg = image.toJPEG(40);
    }
    const sent = image.getSize();
    return { image: jpeg.toString("base64"), width: sent.width, height: sent.height, url: contents.getURL().slice(0, 500), title: contents.getTitle().slice(0, 160) };
  }

  const vault = createVault({ file: path.join(app.getPath("userData"), "vox-saved-details.bin"), safeStorage });

  /** What a numbered field on the page is, read from the page itself (not from Vox's window). */
  async function describeField(contents, ref) {
    const about = await contents
      .executeJavaScript(
        `(() => { const el = document.querySelector('[data-vox-ref="${ref}"]'); if (!el) return null; const label = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.innerText : ""; return { type: (el.getAttribute("type") || "").toLowerCase(), about: [el.getAttribute("type"), el.getAttribute("autocomplete"), el.getAttribute("name"), el.getAttribute("inputmode"), el.getAttribute("aria-label") || label || el.closest("label")?.innerText || el.getAttribute("placeholder")].filter(Boolean).join(" ").slice(0, 300) }; })()`,
        true,
      )
      .catch(() => null);
    return about ? { type: String(about.type ?? ""), kind: fieldKind(about.about) } : null;
  }

  const cleanRef = (value) => (Number.isInteger(value) && value >= 0 && value < 200 ? value : -1);
  /** A saved password only ever goes into a masked password field. */
  const savedAllowed = (field) => field.kind !== "password" || field.type === "password";

  /** Which of these fields have a saved value for the page's site. Yes or no only. */
  ipcMain.handle("vox-browser:saved", (event, rawRefs) => {
    requireTrustedVoxSender(event);
    return savedFields(rawRefs);
  });

  async function savedFields(rawRefs) {
    const contents = view?.webContents;
    const host = contents && !contents.isDestroyed() ? vaultHost(contents.getURL()) : "";
    const saved = {};
    if (!host || !vault.available()) return { canRemember: Boolean(host) && vault.available(), saved };
    for (const ref of (Array.isArray(rawRefs) ? rawRefs : []).slice(0, 6).map(cleanRef)) {
      if (ref < 0) continue;
      const field = await describeField(contents, ref);
      if (field && savedAllowed(field) && vault.get(host, field.kind)) saved[ref] = true;
    }
    return { canRemember: true, saved };
  }

  /**
   * Fills page fields from Vox's private box: what the user just typed, or
   * what they saved on this Mac earlier. Unlike vox-browser:act, this accepts
   * password and card fields. The values go nowhere but the page (and, when
   * the user asks, the encrypted file on this Mac); they are never logged,
   * and only counts are reported back. Filled fields are marked so a later
   * look at the page doesn't read them out.
   */
  ipcMain.handle("vox-browser:fill", (event, request) => {
    requireTrustedVoxSender(event);
    return fillFields(request);
  });

  async function fillFields(request) {
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed() || !isBrowsableUrl(contents.getURL())) return { filled: 0, remembered: 0 };
    const host = vaultHost(contents.getURL());
    const remember = request?.remember === true && Boolean(host) && vault.available();
    let filled = 0;
    let remembered = 0;
    for (const entry of (Array.isArray(request?.entries) ? request.entries : []).slice(0, 6)) {
      const ref = cleanRef(entry?.ref);
      if (ref < 0) continue;
      const field = await describeField(contents, ref);
      if (!field) continue;
      const typed = typeof entry?.value === "string" ? entry.value.slice(0, 200) : "";
      const text = typed || (entry?.saved === true && host && savedAllowed(field) ? vault.get(host, field.kind) : "");
      if (!text) continue;
      const result = await contents.executeJavaScript(actScript({ action: "type", ref, text }), true).catch(() => null);
      if (result?.ok !== true) continue;
      filled += 1;
      await contents.executeJavaScript(`document.querySelector('[data-vox-ref="${ref}"]')?.setAttribute("data-vox-private", "1")`, true).catch(() => undefined);
      if (remember && typed && vault.remember(host, field.kind, typed)) remembered += 1;
    }
    return { filled, remembered };
  }

  ipcMain.handle("vox-vault:list", (event) => {
    requireTrustedVoxSender(event);
    return vault.list();
  });

  ipcMain.handle("vox-vault:forget", (event, target) => {
    requireTrustedVoxSender(event);
    return vault.forget(typeof target === "string" ? target.slice(0, 120) : "");
  });

  return {
    remote,
    // For a task the Mac carries out by itself (see browser-task.mjs).
    page: {
      open: async (url) => {
        if (!isBrowsableUrl(url)) throw new Error("Vox only opens web pages there.");
        ensureView();
        wake();
        await view.webContents.loadURL(String(url).slice(0, 2_000)).catch(() => undefined);
        sendState();
      },
      look: lookAtPage,
      act: actOnPage,
    },
    relayout: place,
    close() {
      clearTimeout(restTimer);
      resting = false;
      if (!view) return;
      const window = getWindow();
      if (window && window.contentView.children.includes(view)) window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
      view = null;
    },
  };
}
