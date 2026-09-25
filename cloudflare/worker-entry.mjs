import application from "./index.js";

export { SipCallDurableObject } from "./sip-call-durable-object.mjs";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://api.openai.com wss://api.openai.com",
].join("; ");

function securedResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), hid=()");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function runApplication(request, env, context) {
  return typeof application?.fetch === "function"
    ? application.fetch(request, env, context)
    : application(request, env, context);
}

function schedulerToken() {
  // Random values cannot be generated at global scope in Workers, so mint the
  // in-isolate token on first use. It never leaves this isolate.
  if (typeof globalThis.__voxSchedulerToken !== "string") {
    globalThis.__voxSchedulerToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  }
  return globalThis.__voxSchedulerToken;
}

async function dispatchReminderCalls(env, context) {
  const response = await runApplication(
    new Request("https://vox.internal/api/reminders/call-dispatch", {
      method: "POST",
      headers: { "x-vox-scheduler": schedulerToken() },
    }),
    env,
    context,
  );
  if (!response.ok) console.error("Reminder call dispatch returned", response.status);
}

// "Sign in with Vox" discovery lives at a fixed /.well-known path (RFC 8414);
// serve it from an API route.
function wellKnownRewrite(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/.well-known/")) return request;
  let target = null;
  if (
    url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
    url.pathname.startsWith("/.well-known/openid-configuration")
  ) {
    target = "/api/oauth/authorization-server";
  }
  if (!target) return request;
  return new Request(new URL(target, url.origin), { method: request.method, headers: request.headers });
}

const worker = {
  async fetch(request, env, context) {
    return securedResponse(await runApplication(wellKnownRewrite(request), env, context));
  },
  async scheduled(_event, env, context) {
    context.waitUntil(dispatchReminderCalls(env, context));
  },
};

export default worker;
