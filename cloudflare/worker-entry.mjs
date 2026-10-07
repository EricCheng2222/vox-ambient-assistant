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
  // https: for map tiles and pictures from the pages Vox shows on the stage.
  "img-src 'self' data: blob: https:",
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

// Must match the hourly entry in scripts/prepare-cloudflare-deploy.mjs.
const PROFILE_CRON = "0 * * * *";

// Hourly: for each account that is inside its sleep window (03:00-05:00 on the
// owner's own clock) and has not been done today, fold the day's conversation
// into the owner profile. The route decides who is due.
async function updateOwnerProfiles(env, context) {
  const response = await runApplication(
    new Request("https://vox.internal/api/profile/nightly", {
      method: "POST",
      headers: { "x-vox-scheduler": schedulerToken() },
    }),
    env,
    context,
  );
  if (!response.ok) console.error("Nightly profile update returned", response.status);
  else console.log("Nightly profile update", await response.text());
}

// Every 15 minutes, off the every-minute cron: "Vox reaches you when it's
// closed". The route decides who may be texted and whether anything is worth
// sending (a nudge, the morning briefing, the evening review).
const PROACTIVE_EVERY_MINUTES = 15;

function proactiveTickDue(event) {
  const scheduled = Number(event?.scheduledTime);
  const at = new Date(Number.isFinite(scheduled) && scheduled > 0 ? scheduled : Date.now());
  return at.getUTCMinutes() % PROACTIVE_EVERY_MINUTES === 0;
}

async function runProactiveTick(env, context) {
  const response = await runApplication(
    new Request("https://vox.internal/api/proactive/tick", {
      method: "POST",
      headers: { "x-vox-scheduler": schedulerToken() },
    }),
    env,
    context,
  );
  if (!response.ok) console.error("Proactive text check returned", response.status);
  else console.log("Proactive text check", await response.text());
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
  async scheduled(event, env, context) {
    // Each cron expression arrives as its own event.
    if (event?.cron === PROFILE_CRON) {
      context.waitUntil(
        updateOwnerProfiles(env, context).catch((error) => {
          console.error("Nightly profile update failed", error instanceof Error ? error.message : "");
        }),
      );
      return;
    }
    context.waitUntil(dispatchReminderCalls(env, context));
    // On its own promise, so neither job can hold up or fail the other.
    if (proactiveTickDue(event)) {
      context.waitUntil(
        runProactiveTick(env, context).catch((error) => {
          console.error("Proactive text check failed", error instanceof Error ? error.message : "");
        }),
      );
    }
  },
};

export default worker;
