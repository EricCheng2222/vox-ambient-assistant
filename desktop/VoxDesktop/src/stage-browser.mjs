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
