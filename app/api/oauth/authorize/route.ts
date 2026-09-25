import { requireUser } from "@/lib/auth";
import { createAuthorizationCode, getClient } from "@/lib/oauth-provider-store";

// "Sign in with Vox". A site such as Vox Flash Cards sends the user here; the
// user signs in with their existing Vox account and approves sharing who they
// are with that site (a per-site account id and their display name).
// The Vox session cookie is SameSite=Strict, so it is absent when the user
// arrives from another site. The page therefore checks the session and submits
// the decision with same-origin requests, which do carry the cookie.

type AuthorizeParams = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function redirectWith(redirectUri: string, values: Record<string, string | null>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function validate(params: URLSearchParams, origin: string) {
  const clientId = params.get("client_id") ?? "";
  const client = clientId ? await getClient(clientId) : null;
  const redirectUri = params.get("redirect_uri") ?? "";
  // Never redirect to an unregistered URI; show the error here instead.
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return { kind: "fatal", message: "This app’s sign-in request is not valid. Try connecting again from the app." } as const;
  }
  const state = params.get("state");
  const fail = (error: string, description: string) =>
    ({ kind: "redirect", url: redirectWith(redirectUri, { error, error_description: description, state, iss: origin }) }) as const;
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Use response_type=code.");
  const codeChallenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/u.test(codeChallenge)) {
    return fail("invalid_request", "PKCE with S256 is required.");
  }
  const scope = params.get("scope");
  if (scope && !scope.split(" ").every((item) => item === "identity" || item === "openid" || item === "profile")) {
    return fail("invalid_scope", "Only identity can be requested.");
  }
  return {
    kind: "ok",
    params: { clientId: client.id, clientName: client.name, redirectUri, state, codeChallenge } satisfies AuthorizeParams,
  } as const;
}

function page(params: AuthorizeParams, query: string) {
  const data = JSON.stringify({ query }).replace(/</g, "\\u003c");
  const name = escapeHtml(params.clientName);
  let redirectHost = params.redirectUri;
  try {
    redirectHost = new URL(params.redirectUri).host || params.redirectUri;
  } catch {
    // Keep the raw value.
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in with Vox</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
    font: 15px/1.5 "Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif; color: #f3f3f7; background: #0b0c14; }
  main { width: min(100%, 420px); padding: 28px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 20px; background: #12131d; }
  h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: -0.02em; }
  p { margin: 0 0 14px; color: rgb(255 255 255 / 62%); }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; font-weight: 600; letter-spacing: 0.08em; }
  .dot { width: 30px; height: 30px; border-radius: 10px; background: #f4ff74; }
  label { display: block; margin: 12px 0 6px; font-size: 13px; color: rgb(255 255 255 / 70%); }
  input { width: 100%; padding: 11px 13px; border: 1px solid rgb(255 255 255 / 14%); border-radius: 12px; font: inherit; color: inherit; background: rgb(255 255 255 / 5%); }
  input:focus { outline: 2px solid #f4ff74; outline-offset: 1px; }
  button { width: 100%; margin-top: 16px; padding: 12px; border: 0; border-radius: 999px; font: inherit; font-weight: 600; cursor: pointer; }
  .primary { color: #10111b; background: #f4ff74; }
  .secondary { margin-top: 10px; color: #f3f3f7; background: rgb(255 255 255 / 8%); }
  button:disabled { opacity: 0.6; cursor: default; }
  ul { margin: 0 0 16px; padding-left: 18px; color: rgb(255 255 255 / 70%); }
  .error { color: #ffaaa4; min-height: 1.5em; margin: 10px 0 0; }
  .muted { font-size: 13px; color: rgb(255 255 255 / 45%); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <div class="brand"><span class="dot" aria-hidden="true"></span>VOX</div>
  <section id="loading"><p>Checking your Vox account…</p></section>

  <section id="signin" hidden>
    <h1>Sign in to Vox</h1>
    <p><strong>${name}</strong> wants you to sign in with your Vox account.</p>
    <form id="signin-form">
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" required>
      <label for="code">Activation code</label>
      <input id="code" type="password" autocomplete="current-password" required>
      <button class="primary" type="submit">Sign in</button>
      <p class="error" id="signin-error" role="alert"></p>
    </form>
  </section>

  <section id="consent" hidden>
    <h1>Sign in to ${name}?</h1>
    <p>Signed in to Vox as <strong id="who"></strong>.</p>
    <p>${name} will learn only your Vox display name and an account id made just for it.</p>
    <p class="muted">It gets no access to your conversations, memories, reminders, files, or Mac. You’ll return to ${escapeHtml(redirectHost)}.</p>
    <button class="primary" id="allow" type="button">Continue</button>
    <button class="secondary" id="deny" type="button">Cancel</button>
    <p class="error" id="consent-error" role="alert"></p>
  </section>
</main>
<script type="application/json" id="request">${data}</script>
<script>
(() => {
  const { query } = JSON.parse(document.getElementById("request").textContent);
  const show = (id) => {
    for (const section of ["loading", "signin", "consent"]) {
      document.getElementById(section).hidden = section !== id;
    }
  };
  async function check() {
    const response = await fetch("/api/auth", { cache: "no-store" });
    const status = await response.json().catch(() => ({}));
    if (status.authenticated) {
      document.getElementById("who").textContent = status.user?.displayName || "your account";
      show("consent");
    } else {
      show("signin");
    }
  }
  document.getElementById("signin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("signin-error");
    const button = event.target.querySelector("button");
    error.textContent = "";
    button.disabled = true;
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("email").value,
          code: document.getElementById("code").value,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Sign-in failed.");
      await check();
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      button.disabled = false;
    }
  });
  async function decide(approve) {
    const error = document.getElementById("consent-error");
    error.textContent = "";
    for (const button of document.querySelectorAll("#consent button")) button.disabled = true;
    try {
      const response = await fetch("/api/oauth/authorize?" + query, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.redirect) throw new Error(result.error || "Could not finish connecting.");
      window.location.replace(result.redirect);
    } catch (failure) {
      error.textContent = failure.message;
      for (const button of document.querySelectorAll("#consent button")) button.disabled = false;
    }
  }
  document.getElementById("allow").addEventListener("click", () => decide(true));
  document.getElementById("deny").addEventListener("click", () => decide(false));
  check().catch(() => show("signin"));
})();
</script>
</body>
</html>`;
}

function errorPage(message: string) {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vox</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:15px/1.5 system-ui,sans-serif;color:#f3f3f7;background:#0b0c14}main{max-width:420px}</style></head>
<body><main><h1>Can’t connect</h1><p>${escapeHtml(message)}</p></main></body></html>`,
    400,
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await validate(url.searchParams, url.origin);
  if (result.kind === "fatal") return errorPage(result.message);
  if (result.kind === "redirect") return Response.redirect(result.url, 302);
  return html(page(result.params, url.searchParams.toString()));
}

// Called by the page above with the user's decision.
export async function POST(request: Request) {
  const url = new URL(request.url);
  // Only this site's own page may submit a decision.
  if (request.headers.get("origin") !== url.origin) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }
  const auth = await requireUser(request);
  if ("response" in auth) return Response.json({ error: "Sign in to Vox first." }, { status: 401 });
  const result = await validate(url.searchParams, url.origin);
  if (result.kind === "fatal") return Response.json({ error: result.message }, { status: 400 });
  if (result.kind === "redirect") return Response.json({ redirect: result.url });

  const body = (await request.json().catch(() => ({}))) as { approve?: unknown };
  const { clientId, redirectUri, state, codeChallenge } = result.params;
  if (body.approve !== true) {
    return Response.json({
      redirect: redirectWith(redirectUri, {
        error: "access_denied",
        error_description: "The user declined.",
        state,
        iss: url.origin,
      }),
    });
  }
  const code = await createAuthorizationCode({ clientId, ownerId: auth.user.id, redirectUri, codeChallenge });
  return Response.json({ redirect: redirectWith(redirectUri, { code, state, iss: url.origin }) });
}
