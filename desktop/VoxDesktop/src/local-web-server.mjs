import { createServer } from "node:http";
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

export async function startLocalVoxServer(webRoot) {
  const serverModule = await import(pathToFileURL(path.join(webRoot, "server", "index.js")).href);
  const worker = serverModule.default;
  if (!worker?.fetch) throw new Error("The bundled Vox web interface is incomplete.");
  const assets = assetBinding(path.join(webRoot, "client"));
  let origin = "";
  const server = createServer(async (request, response) => {
    try {
      const webRequest = await nodeRequest(request, origin);
      if (new URL(webRequest.url).pathname.startsWith("/api/")) {
        await writeResponse(
          Response.json(
            { error: "Vox Cloud APIs are disabled in Personal mode." },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          ),
          response,
        );
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
