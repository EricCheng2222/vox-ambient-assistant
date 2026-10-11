import { requireUser } from "@/lib/auth";
import { extractCode, parseMailSearch, recentFromSite, registrableDomain } from "@/lib/email-code";
import { callMcpTool, McpCallError } from "@/lib/mcp-call";
import { mailServerUrl } from "@/lib/mcp-client";

// The verification code a website just emailed the signed-in user, for the
// Vox app to write into that website's code field. The answer goes to the
// app, never to the live model. A code is only returned for an email sent by
// the site named in the request, in the last 15 minutes, so asking on behalf
// of one site can never produce another service's code.

const noStore = { "Cache-Control": "no-store" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403, headers: noStore });
  const body = (await request.json().catch(() => ({}))) as { host?: unknown };
  const host = typeof body.host === "string" ? body.host.trim().toLowerCase().slice(0, 200) : "";
  if (!registrableDomain(host)) return Response.json({ error: "Which site?" }, { status: 400, headers: noStore });

  try {
    const search = await callMcpTool(auth.user.id, mailServerUrl(), "search_email", { query: "newer_than:1d", max_results: 15 });
    if (!search) return Response.json({ result: "not_connected" }, { headers: noStore });
    if (search.isError) return Response.json({ result: "no_email" }, { headers: noStore });
    const candidates = recentFromSite(parseMailSearch(search.text), host, Date.now()).slice(0, 3);
    if (!candidates.length) return Response.json({ result: "no_email" }, { headers: noStore });
    for (const message of candidates) {
      let code = extractCode(`${message.subject}. ${message.snippet}`);
      if (!code) {
        const full = await callMcpTool(auth.user.id, mailServerUrl(), "read_email", { id: message.id }).catch(() => null);
        if (full && !full.isError) code = extractCode(full.text.slice(0, 6_000));
      }
      if (code) return Response.json({ result: "found", code }, { headers: noStore });
    }
    return Response.json({ result: "no_code" }, { headers: noStore });
  } catch (error) {
    if (!(error instanceof McpCallError)) console.error("Email code lookup failed", error instanceof Error ? error.message : "");
    return Response.json({ result: "no_email" }, { headers: noStore });
  }
}
