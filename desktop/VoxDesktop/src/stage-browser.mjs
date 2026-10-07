import { ipcMain, session, shell, WebContentsView } from "electron";

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

// Runs in the page: numbers what can be clicked or filled in (data-vox-ref)
// and returns it with the page's visible text.
const LOOK_SCRIPT = `(() => {
  const clean = (value, max) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
  for (const old of document.querySelectorAll("[data-vox-ref]")) old.removeAttribute("data-vox-ref");
  const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="searchbox"], [role="textbox"], [contenteditable="true"]';
  const elements = [];
  const viewH = window.innerHeight, viewW = window.innerWidth;
  for (const el of document.querySelectorAll(selector)) {
    if (elements.length >= 90) break;
    if (el.disabled || el.getAttribute("aria-disabled") === "true" || el.getAttribute("aria-hidden") === "true") continue;
    const box = el.getBoundingClientRect();
    if (box.width < 4 || box.height < 4 || box.bottom < 0 || box.top > viewH * 2 || box.right < 0 || box.left > viewW) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const type = (el.getAttribute("type") || "").toLowerCase();
    let kind = "button";
    if (tag === "a" || role === "link") kind = "link";
    else if (tag === "select" || role === "combobox") kind = "menu";
    else if (type === "checkbox" || role === "checkbox" || role === "switch") kind = "checkbox";
    else if (type === "radio" || role === "radio") kind = "option";
    else if (tag === "textarea" || el.isContentEditable || role === "textbox" || role === "searchbox" || (tag === "input" && !["button", "submit", "reset", "image", "file"].includes(type))) kind = "text field";
    else if (role === "tab") kind = "tab";
    else if (role === "menuitem" || role === "option") kind = "option";
    const labelled = el.getAttribute("aria-labelledby");
    const byId = labelled ? labelled.split(" ").map((id) => document.getElementById(id)?.innerText || "").join(" ") : "";
    const forLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.innerText : "";
    const label = clean(el.getAttribute("aria-label") || byId || forLabel || el.closest("label")?.innerText || (kind === "text field" ? el.getAttribute("placeholder") || el.getAttribute("name") : el.innerText || el.value) || el.getAttribute("title") || el.querySelector("img[alt]")?.getAttribute("alt") || "", 100);
    const ref = elements.length;
    el.setAttribute("data-vox-ref", String(ref));
    const secret = type === "password";
    elements.push({
      ref, kind, label,
      value: kind === "text field" && !secret ? clean(el.value ?? el.innerText, 80) : kind === "checkbox" || kind === "option" ? String(el.checked ?? el.getAttribute("aria-checked") ?? "") : tag === "select" ? clean(el.selectedOptions?.[0]?.innerText, 60) : "",
      hint: clean([type, el.getAttribute("autocomplete"), el.getAttribute("name"), el.getAttribute("inputmode")].filter(Boolean).join(" "), 80),
    });
  }
  const main = document.querySelector('[role="main"], main') || document.body;
  return { url: location.href, title: document.title, text: (main ? main.innerText : "").slice(0, 6000), elements };
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

export function registerStageBrowser({ requireTrustedVoxSender, getWindow, getVoxView }) {
  let view = null;
  let visible = false;
  let lastBounds = { x: 0, y: 0, width: 0, height: 0 };

  function profile() {
    const browserSession = session.fromPartition(PARTITION);
    if (!browserSession.__voxConfigured) {
      browserSession.__voxConfigured = true;
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
    const vox = getVoxView();
    if (!vox || vox.webContents.isDestroyed()) return;
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
      },
    });
    view.setBackgroundColor("#ffffff");
    // A size before it is first placed, so the page lays out even while hidden.
    view.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
    const contents = view.webContents;
    // Links that would open a new window open here instead.
    contents.setWindowOpenHandler(({ url }) => {
      if (isBrowsableUrl(url)) void contents.loadURL(url);
      return { action: "deny" };
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
    return view;
  }

  function place() {
    const window = getWindow();
    const vox = getVoxView();
    if (!window || !vox || !view) return;
    const attached = window.contentView.children.includes(view);
    const show = visible && lastBounds.width > 20 && lastBounds.height > 20;
    if (!show) {
      if (attached) window.contentView.removeChildView(view);
      return;
    }
    const origin = vox.getBounds();
    view.setBounds({
      x: origin.x + lastBounds.x,
      y: origin.y + lastBounds.y,
      width: Math.min(lastBounds.width, Math.max(1, origin.width - lastBounds.x)),
      height: Math.min(lastBounds.height, Math.max(1, origin.height - lastBounds.y)),
    });
    // Added last, so it sits above the Vox page.
    if (!attached) window.contentView.addChildView(view);
  }

  ipcMain.handle("vox-browser:open", async (event, url) => {
    requireTrustedVoxSender(event);
    if (!isBrowsableUrl(url)) throw new Error("Vox only opens web pages here.");
    const contents = ensureView().webContents;
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
  ipcMain.handle("vox-browser:look", async (event) => {
    requireTrustedVoxSender(event);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed() || !isBrowsableUrl(contents.getURL())) return null;
    const look = await contents.executeJavaScript(LOOK_SCRIPT, true).catch(() => null);
    if (!look || !Array.isArray(look.elements)) return null;
    return {
      url: contents.getURL(),
      title: contents.getTitle().slice(0, 300),
      text: typeof look.text === "string" ? look.text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 6_000) : "",
      elements: look.elements.slice(0, 90).map((element, index) => ({
        ref: index,
        kind: String(element?.kind ?? "button").slice(0, 20),
        label: String(element?.label ?? "").slice(0, 100),
        value: String(element?.value ?? "").slice(0, 80),
        hint: String(element?.hint ?? "").slice(0, 80),
      })),
    };
  });

  /** One action on the page. Passwords, card numbers, and codes are never typed here. */
  ipcMain.handle("vox-browser:act", async (event, request) => {
    requireTrustedVoxSender(event);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed() || !isBrowsableUrl(contents.getURL())) return { ok: false, message: "No web page is open." };
    const action = ["click", "type", "select", "press_enter", "scroll_down", "scroll_up"].includes(request?.action) ? request.action : "";
    if (!action) return { ok: false, message: "Unknown action." };
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
        return { ok: false, message: "Vox doesn't type passwords, card numbers, or codes. Ask the user to type it on the page themselves." };
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
  });

  return {
    relayout: place,
    close() {
      if (!view) return;
      const window = getWindow();
      if (window && window.contentView.children.includes(view)) window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
      view = null;
    },
  };
}
