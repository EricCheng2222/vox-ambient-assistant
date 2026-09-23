import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startLocalVoxServer } from "../src/local-web-server.mjs";

const desktopSessionHeader = {
  name: "x-vox-desktop-session",
  value: "test-desktop-session-secret",
};

async function fixture() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "vox-local-web-"));
  const serverRoot = path.join(webRoot, "server");
  const assetRoot = path.join(webRoot, "client", "_next", "static", "chunks");
  await mkdir(serverRoot, { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  await writeFile(
    path.join(serverRoot, "index.js"),
    'module.exports = { fetch: async () => new Response("<main>Bundled Vox</main>", { headers: { "Content-Type": "text/html" } }) };\n',
  );
  await writeFile(path.join(assetRoot, "app.js"), "globalThis.voxLoaded = true;\n");
  return webRoot;
}

test("the desktop always serves its bundled interface and blocks Personal-mode cloud APIs", async () => {
  const webRoot = await fixture();
  const server = await startLocalVoxServer(webRoot, {
    desktopSessionHeader,
    getConnectionMode: () => "personal",
  });
  try {
    const asset = await fetch(new URL("/_next/static/chunks/app.js", server.url));
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(await asset.text(), "globalThis.voxLoaded = true;\n");

    const page = await fetch(server.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<main>Bundled Vox<\/main>/u);

    const unauthorized = await fetch(new URL("/api/auth", server.url));
    assert.equal(unauthorized.status, 401);

    const personalApi = await fetch(new URL("/api/auth", server.url), {
      headers: { [desktopSessionHeader.name]: desktopSessionHeader.value },
    });
    assert.equal(personalApi.status, 403);
  } finally {
    await server.close();
    await rm(webRoot, { recursive: true, force: true });
  }
});

test("Cloud mode proxies only allowlisted APIs through its per-process desktop binding", async () => {
  const webRoot = await fixture();
  const proxied = [];
  const server = await startLocalVoxServer(webRoot, {
    cloudOrigin: "https://vox.example/",
    desktopSessionHeader,
    getConnectionMode: () => "cloud",
    cloudFetch: async (request) => {
      proxied.push(request);
      return Response.json(
        { authenticated: true },
        { headers: { "Set-Cookie": "vox_session=cloud-secret; HttpOnly; Secure" } },
      );
    },
  });

  try {
    const unauthorized = await fetch(new URL("/api/auth", server.url));
    assert.equal(unauthorized.status, 401);
    assert.equal(proxied.length, 0);

    const headers = { [desktopSessionHeader.name]: desktopSessionHeader.value };
    const response = await fetch(new URL("/api/auth?device=desktop", server.url), { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: true });
    assert.equal(proxied.length, 1);
    assert.equal(proxied[0].url, "https://vox.example/api/auth?device=desktop");
    assert.equal(proxied[0].headers.get(desktopSessionHeader.name), null);
    assert.equal(proxied[0].headers.get("cookie"), null);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/u);

    const pairing = await fetch(new URL("/api/device-pairing", server.url), {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "heartbeat" }),
    });
    assert.equal(pairing.status, 200);
    assert.equal(proxied.at(-1).url, "https://vox.example/api/device-pairing");

    const command = await fetch(new URL("/api/device-commands", server.url), {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    assert.equal(command.status, 200);
    assert.equal(proxied.at(-1).url, "https://vox.example/api/device-commands");

    const unknown = await fetch(new URL("/api/not-a-desktop-endpoint", server.url), { headers });
    assert.equal(unknown.status, 404);
    assert.equal(proxied.length, 3);

    const wrongMethod = await fetch(new URL("/api/preferences", server.url), {
      method: "POST",
      headers,
    });
    assert.equal(wrongMethod.status, 405);
    assert.equal(proxied.length, 3);
  } finally {
    await server.close();
    await rm(webRoot, { recursive: true, force: true });
  }
});
