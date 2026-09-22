import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startLocalVoxServer } from "../src/local-web-server.mjs";

test("the local desktop server serves bundled client assets before the web worker", async () => {
  const webRoot = await mkdtemp(path.join(tmpdir(), "vox-local-web-"));
  const serverRoot = path.join(webRoot, "server");
  const assetRoot = path.join(webRoot, "client", "_next", "static", "chunks");
  await mkdir(serverRoot, { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  await writeFile(
    path.join(serverRoot, "index.js"),
    'module.exports = { fetch: async () => new Response("<main>Vox</main>", { headers: { "Content-Type": "text/html" } }) };\n',
  );
  await writeFile(path.join(assetRoot, "app.js"), "globalThis.voxLoaded = true;\n");

  const server = await startLocalVoxServer(webRoot);
  try {
    const asset = await fetch(new URL("/_next/static/chunks/app.js", server.url));
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(await asset.text(), "globalThis.voxLoaded = true;\n");

    const page = await fetch(server.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<main>Vox<\/main>/u);

    const api = await fetch(new URL("/api/auth", server.url));
    assert.equal(api.status, 403);
  } finally {
    await server.close();
    await rm(webRoot, { recursive: true, force: true });
  }
});
