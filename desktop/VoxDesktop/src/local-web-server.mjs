import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const cloudApiMethods = new Map([
  ["/api/auth", new Set(["GET", "POST", "DELETE"])],
  ["/api/conversation", new Set(["GET", "POST", "PATCH", "DELETE"])],
  ["/api/device-commands", new Set(["GET", "POST", "PATCH"])],
  ["/api/device-pairing", new Set(["GET", "POST", "DELETE"])],
  ["/api/files", new Set(["GET", "POST", "DELETE"])],
  ["/api/connections/flashcards", new Set(["GET", "POST", "DELETE"])],
  ["/api/flashcards/study-token", new Set(["POST"])],
  ["/api/invites", new Set(["GET", "POST"])],
  ["/api/jev-presence", new Set(["POST"])],
  ["/api/jev-route", new Set(["POST"])],
  ["/api/memories", new Set(["GET", "POST", "PATCH", "DELETE"])],
  ["/api/phone-assistant", new Set(["GET", "POST", "PATCH", "DELETE"])],
  ["/api/preferences", new Set(["GET", "PATCH"])],
  ["/api/realtime-token", new Set(["POST"])],
  ["/api/reason", new Set(["POST"])],
  ["/api/reminders", new Set(["GET", "POST", "PATCH", "DELETE"])],
  ["/api/reminders/due", new Set(["POST"])],
]);

const strippedRequestHeaders = new Set([
  "accept-encoding",
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "transfer-encoding",
  "upgrade",
]);

const strippedResponseHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "content-security-policy",
  "set-cookie",
  "transfer-encoding",
]);

function safeAssetPath(clientRoot, pathname) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  const resolvedRoot = path.resolve(clientRoot);
  const resolved = path.resolve(resolvedRoot, decoded);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)
    ? resolved
    : null;
}

function assetBinding(clientRoot) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const filePath = safeAssetPath(clientRoot, url.pathname);
      if (!filePath) return new Response("Not found", { status: 404 });
      try {
        const details = await stat(filePath);
        if (!details.isFile()) return new Response("Not found", { status: 404 });
        return new Response(await readFile(filePath), {
          headers: {
            "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };
}

async function nodeRequest(request, origin) {
  const url = new URL(request.url || "/", origin);
  const method = request.method || "GET";
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : await new Promise((resolve, reject) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => resolve(Buffer.concat(chunks)));
        request.on("error", reject);
      });
  return new Request(url, {
    method,
    headers: request.headers,
    ...(body ? { body, duplex: "half" } : {}),
  });
}

async function writeResponse(response, target) {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (!response.body) {
    target.end();
    return;
  }
  for await (const chunk of response.body) target.write(Buffer.from(chunk));
  target.end();
}

function desktopApiError(error, status) {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );
}

function desktopSessionMatches(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes);
}

function cloudApiRequest(webRequest, cloudOrigin, desktopSessionHeader) {
  const sourceUrl = new URL(webRequest.url);
  const targetUrl = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, cloudOrigin);
  const headers = new Headers();
  webRequest.headers.forEach((value, name) => {
    if (
      name.toLowerCase() !== desktopSessionHeader.name.toLowerCase() &&
      !strippedRequestHeaders.has(name.toLowerCase())
    ) {
      headers.set(name, value);
    }
  });
  headers.set("Origin", new URL(cloudOrigin).origin);
  headers.set("Referer", cloudOrigin);

  const method = webRequest.method.toUpperCase();
  return new Request(targetUrl, {
    method,
    headers,
    redirect: "error",
    ...(method === "GET" || method === "HEAD"
      ? {}
      : { body: webRequest.body, duplex: "half" }),
  });
}

function safeCloudApiResponse(response) {
  const headers = new Headers();
  response.headers.forEach((value, name) => {
    if (!strippedResponseHeaders.has(name.toLowerCase())) headers.set(name, value);
  });
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function startLocalVoxServer(webRoot, options = {}) {
  const {
    cloudOrigin = "",
    cloudFetch,
    desktopSessionHeader = { name: "x-vox-desktop-session", value: "" },
    getConnectionMode = () => "personal",
  } = options;
  const serverModule = await import(pathToFileURL(path.join(webRoot, "server", "index.js")).href);
  const worker = serverModule.default;
  if (!worker?.fetch) throw new Error("The bundled Vox web interface is incomplete.");
  const assets = assetBinding(path.join(webRoot, "client"));
  let origin = "";
  const server = createServer(async (request, response) => {
    try {
      const webRequest = await nodeRequest(request, origin);
      const requestUrl = new URL(webRequest.url);
      if (requestUrl.pathname.startsWith("/api/")) {
        if (
          !desktopSessionHeader.value ||
          !desktopSessionMatches(
            webRequest.headers.get(desktopSessionHeader.name),
            desktopSessionHeader.value,
          )
        ) {
          await writeResponse(desktopApiError("This desktop session is not authorized.", 401), response);
          return;
        }
        if (getConnectionMode() !== "cloud") {
          await writeResponse(desktopApiError("Vox Cloud APIs are disabled in Personal mode.", 403), response);
          return;
        }
        const allowedMethods = cloudApiMethods.get(requestUrl.pathname);
        if (!allowedMethods) {
          await writeResponse(desktopApiError("That Vox Cloud endpoint is not available to the desktop app.", 404), response);
          return;
        }
        if (!allowedMethods.has(webRequest.method.toUpperCase())) {
          await writeResponse(desktopApiError("That request method is not allowed.", 405), response);
          return;
        }
        if (!cloudOrigin || typeof cloudFetch !== "function") {
          await writeResponse(desktopApiError("Vox Cloud is temporarily unavailable.", 503), response);
          return;
        }
        const cloudResponse = await cloudFetch(
          cloudApiRequest(webRequest, cloudOrigin, desktopSessionHeader),
        );
        await writeResponse(safeCloudApiResponse(cloudResponse), response);
        return;
      }
      if (webRequest.method === "GET") {
        const assetResponse = await assets.fetch(webRequest);
        if (assetResponse.status !== 404) {
          await writeResponse(assetResponse, response);
          return;
        }
      }
      const webResponse = await worker.fetch(webRequest, { ASSETS: assets }, {
        waitUntil(promise) {
          Promise.resolve(promise).catch(() => undefined);
        },
      });
      await writeResponse(webResponse, response);
    } catch {
      await writeResponse(new Response("Vox Desktop could not load its local interface.", { status: 500 }), response);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The local Vox interface could not start.");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    url: `${origin}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
