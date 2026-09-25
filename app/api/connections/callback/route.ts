import { requireUser } from "@/lib/auth";
import { finishConnection, McpConnectionError } from "@/lib/mcp-client";

// The MCP server's sign-in returns here. The connection is completed only from
// a browser signed in to the Vox account that started it: the page submits the
// code with a same-origin request (the Vox cookie is SameSite=Strict, so it is
// absent on this cross-site redirect), and the server checks that account.

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const data = JSON.stringify({
    code: params.get("code") ?? "",
    state: params.get("state") ?? "",
    error: params.get("error") ?? "",
  }).replace(/</g, "\\u003c");
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Connecting Vox</title>
<style>
  :root { color-scheme: dark; } * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; font: 15px/1.5 "Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif; color: #f3f3f7; background: #0b0c14; }
  main { width: min(100%, 420px); padding: 28px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 20px; background: #12131d; }
  h1 { margin: 0 0 8px; font-size: 22px; } p { margin: 0 0 14px; color: rgb(255 255 255 / 62%); }
  label { display: block; margin: 12px 0 6px; font-size: 13px; color: rgb(255 255 255 / 70%); }
  input { width: 100%; padding: 11px 13px; border: 1px solid rgb(255 255 255 / 14%); border-radius: 12px; font: inherit; color: inherit; background: rgb(255 255 255 / 5%); }
  button, a.button { display: block; width: 100%; margin-top: 16px; padding: 12px; border: 0; border-radius: 999px; font: inherit; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; color: #10111b; background: #f4ff74; }
  .error { color: #ffaaa4; } [hidden] { display: none !important; }
</style></head>
<body><main>
  <section id="working"><h1>Connecting…</h1><p>Finishing the connection to Vox Flash Cards.</p></section>
  <section id="signin" hidden>
    <h1>Sign in to Vox</h1>
    <p>Sign in with the Vox account you’re connecting.</p>
    <form id="signin-form">
      <label for="email">Email</label><input id="email" type="email" autocomplete="email" required>
      <label for="code">Activation code</label><input id="code" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in and connect</button>
      <p class="error" id="signin-error" role="alert"></p>
    </form>
  </section>
  <section id="done" hidden><h1>Connected</h1><p>Vox can now study your flash cards with you. You can close this tab and return to Vox, then say “let’s review my flash cards.”</p><a class="button" href="/">Open Vox</a></section>
  <section id="failed" hidden><h1>Not connected</h1><p id="failure"></p><a class="button" href="/">Back to Vox</a></section>
</main>
<script type="application/json" id="request">${data}</script>
<script>
(() => {
  const request = JSON.parse(document.getElementById("request").textContent);
  const show = (id) => { for (const section of ["working", "signin", "done", "failed"]) document.getElementById(section).hidden = section !== id; };
  const fail = (message) => { document.getElementById("failure").textContent = message; show("failed"); };
  async function finish() {
    const status = await fetch("/api/auth", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    if (!status.authenticated) { show("signin"); return; }
    const response = await fetch("/api/connections/callback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: request.code, state: request.state }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) show("done"); else fail(result.error || "The connection could not be completed.");
  }
  document.getElementById("signin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: document.getElementById("email").value, code: document.getElementById("code").value }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { document.getElementById("signin-error").textContent = result.error || "Sign-in failed."; return; }
    show("working");
    finish().catch(() => fail("The connection could not be completed."));
  });
  if (request.error) fail("The connection was cancelled.");
  else if (!request.code || !request.state) fail("This link is incomplete.");
  else finish().catch(() => fail("The connection could not be completed."));
})();
</script>
</body></html>`;
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }
  const auth = await requireUser(request);
  if ("response" in auth) return Response.json({ error: "Sign in to Vox first." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { code?: unknown; state?: unknown };
  const code = typeof body.code === "string" ? body.code : "";
  const state = typeof body.state === "string" ? body.state : "";
  if (!code || !state) return Response.json({ error: "This link is incomplete." }, { status: 400 });
  try {
    await finishConnection(auth.user.id, state, code);
    return Response.json({ connected: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof McpConnectionError)) console.error("Finishing a connection failed", error);
    return Response.json(
      { error: error instanceof McpConnectionError ? error.message : "The connection could not be completed." },
      { status: 400 },
    );
  }
}
