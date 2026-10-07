import { BrowserWindow, ipcMain, session } from "electron";

// Watched pages: pages the user asked Vox to keep an eye on (an inbox, an
// order status, a queue). Vox keeps each one open in a hidden window of the
// built-in browser's profile, where the user signed in themselves, and reads
// its visible text when asked. Read-only: Vox never types, clicks, or submits
// anything there, and the sign-in never leaves this Mac.

const PARTITION = "persist:vox-browser";
const MAX_WATCHED = 4;
const MIN_READ_GAP_MS = 20_000;
// Pages that update themselves (web inboxes) are re-read as they are; others
// are loaded again once they are this old.
const RELOAD_AFTER_MS = 5 * 60_000;
const MAX_TEXT = 8_000;

/** An https page, with no sign-in details in the address. */
export function isWatchableUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Plain, bounded page text: one line per visible line, no control characters. */
export function pageText(value, max = MAX_TEXT) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/gu, " ")
    .split(/\n+/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, max);
}

const READ_SCRIPT = `(() => {
  const main = document.querySelector('[role="main"], main') || document.body;
  return { text: (main ? main.innerText : "").slice(0, 40000), title: document.title, url: location.href };
})()`;

export function registerPageWatch({ requireTrustedVoxSender }) {
  /** url → { window, loadedAt, last, lastAt } */
  const watched = new Map();

  function closeWatch(url) {
    const entry = watched.get(url);
    if (entry?.window && !entry.window.isDestroyed()) entry.window.destroy();
    watched.delete(url);
  }

  function openWindow() {
    const window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 900,
      webPreferences: {
        session: session.fromPartition(PARTITION),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    const contents = window.webContents;
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    // It may follow the site's own sign-in redirects, but only over https.
    const guard = (event, url) => {
      if (!isWatchableUrl(url)) event.preventDefault();
    };
    contents.on("will-navigate", guard);
    contents.on("will-redirect", guard);
    return window;
  }

  async function read(url) {
    if (!isWatchableUrl(url)) return null;
    let entry = watched.get(url);
    if (!entry) {
      // The least recently read page makes room.
      if (watched.size >= MAX_WATCHED) {
        const oldest = [...watched.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
        if (oldest) closeWatch(oldest[0]);
      }
      entry = { window: openWindow(), loadedAt: 0, last: null, lastAt: 0 };
      watched.set(url, entry);
    }
    if (entry.last && Date.now() - entry.lastAt < MIN_READ_GAP_MS) return entry.last;
    if (entry.window.isDestroyed()) {
      entry.window = openWindow();
      entry.loadedAt = 0;
    }
    const contents = entry.window.webContents;
    if (Date.now() - entry.loadedAt > RELOAD_AFTER_MS) {
      await contents.loadURL(url).catch(() => undefined);
      entry.loadedAt = Date.now();
      // Pages built in the browser fill in after they load.
      await new Promise((resolve) => setTimeout(resolve, 3_500));
    }
    const result = await contents.executeJavaScript(READ_SCRIPT, true).catch(() => null);
    const landed = typeof result?.url === "string" ? result.url : contents.getURL();
    let moved = false;
    try {
      // Sent somewhere else (usually a sign-in page): the user needs to look.
      const want = new URL(url);
      const got = new URL(landed);
      moved = got.hostname !== want.hostname || !got.pathname.startsWith(want.pathname.replace(/\/+$/u, "") || "/");
    } catch {
      moved = true;
    }
    entry.last = {
      url,
      title: typeof result?.title === "string" ? result.title.replace(/\s+/gu, " ").trim().slice(0, 200) : "",
      text: pageText(result?.text),
      moved,
      checkedAt: new Date().toISOString(),
    };
    entry.lastAt = Date.now();
    return entry.last;
  }

  ipcMain.handle("vox-watch:read", async (event, url) => {
    requireTrustedVoxSender(event);
    return read(typeof url === "string" ? url.slice(0, 2_000) : "");
  });

  ipcMain.handle("vox-watch:close", (event, url) => {
    requireTrustedVoxSender(event);
    closeWatch(typeof url === "string" ? url : "");
    return true;
  });

  return {
    closeAll() {
      for (const url of [...watched.keys()]) closeWatch(url);
    },
  };
}
