// Shared test helpers: a fetch mock with routes, a D1 in memory, and an env.
import { fileURLToPath } from "node:url";

import { createD1 } from "./d1.mjs";

export const ORIGIN = "https://mail.example";
export const b64url = (text) => Buffer.from(text, "utf8").toString("base64url");

/** Splits a built message into unfolded headers and the raw body. */
export function parseBuilt(raw) {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const headers = {};
  for (const line of head.replace(/\r\n /g, " ").split("\r\n")) {
    const index = line.indexOf(":");
    headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim();
  }
  return { headers, body: rest.join("\r\n\r\n") };
}

// ---- fetch ----
export const calls = [];
const routes = [];

/** Handles "METHOD https://host/path" (prefix match, longest first) with handler(call). */
export function route(method, prefix, handler) {
  const key = `${method} ${prefix}`;
  const existing = routes.findIndex((item) => item.key === key);
  if (existing >= 0) routes.splice(existing, 1);
  routes.push({ key, method, prefix, handler });
  routes.sort((a, b) => b.prefix.length - a.prefix.length);
}

export function unroute(method, prefix) {
  const index = routes.findIndex((item) => item.key === `${method} ${prefix}`);
  if (index >= 0) routes.splice(index, 1);
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const body = input instanceof Request ? await input.text() : init.body;
  const headers = new Headers(input instanceof Request ? input.headers : init.headers);
  const call = { url, method: (input instanceof Request ? input.method : init.method) ?? "GET", body: body == null ? "" : String(body), headers };
  calls.push(call);
  const href = `${url.origin}${url.pathname}`;
  const match = routes.find((item) => item.method === call.method && href.startsWith(item.prefix));
  if (!match) return Response.json({ error: { code: 404, message: `No mock for ${call.method} ${href}` } }, { status: 404 });
  return match.handler(call);
};

export const callsTo = (prefix) => calls.filter((call) => `${call.url.origin}${call.url.pathname}`.startsWith(prefix));

// ---- D1 and env ----
export const migrations = fileURLToPath(new URL("../migrations", import.meta.url));

export function makeEnv(overrides = {}) {
  return {
    DB: createD1(migrations),
    VOX_URL: "https://vox.example",
    GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "shh",
    MS_CLIENT_ID: "ms-client",
    MS_CLIENT_SECRET: "ms-shh",
    MAIL_TOKEN_SECRET: "test-secret",
    ...overrides,
  };
}

/** Silences console.error while `work` runs (for expected failures). */
export async function quietly(work) {
  const original = console.error;
  console.error = () => {};
  try {
    return await work();
  } finally {
    console.error = original;
  }
}
