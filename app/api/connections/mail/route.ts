import { requireUser } from "@/lib/auth";
import {
  beginConnection,
  connectionStatus,
  disconnect,
  mailServerUrl,
  McpConnectionError,
} from "@/lib/mcp-client";
import { callMcpTools } from "@/lib/mcp-call";
import { parseMailAccountDetails, type MailAccountDetail } from "@/lib/today-parse";

// Vox's connection to Vox Mail, the MCP server for the user's email accounts.
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const serverUrl = mailServerUrl();
  const status = await connectionStatus(auth.user.id, serverUrl);
  // The accounts behind the connection and what Vox may use in each; null if they can't be listed now.
  let accounts: MailAccountDetail[] | null = null;
  if (status.connected) {
    try {
      const [listed] = (await callMcpTools(auth.user.id, serverUrl, [{ name: "list_accounts" }])) ?? [];
      if (listed?.status === "fulfilled" && !listed.value.isError) accounts = parseMailAccountDetails(listed.value.text);
    } catch {
      // The sheet still shows that Vox is connected.
    }
  }
  return Response.json({ ...status, accounts, serverUrl, siteUrl: new URL(serverUrl).origin }, { headers: noStore });
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    const started = new URL(await beginConnection(auth.user.id, mailServerUrl(), new URL(request.url).origin));
    // "Connect Gmail" goes straight to Google's consent, with no chooser.
    const body = (await request.json().catch(() => ({}))) as { provider?: unknown; add?: unknown; loginHint?: unknown };
    // Preselects the address on the provider's sign-in page.
    if (typeof body.loginHint === "string" && /^[^\s@]{1,64}@[^\s@]{1,190}$/u.test(body.loginHint)) {
      started.searchParams.set("login_hint", body.loginHint);
    }
    if (body.provider === "google" || body.provider === "microsoft" || body.provider === "imap") {
      started.searchParams.set("provider", body.provider);
    }
    if (body.add === true) started.searchParams.set("add", "1");
    return Response.json({ authorizeUrl: started.toString() }, { headers: noStore });
  } catch (error) {
    if (!(error instanceof McpConnectionError)) console.error("Mail connection failed", error);
    return Response.json(
      { error: error instanceof McpConnectionError ? error.message : "Vox Mail is unavailable right now." },
      { status: 502, headers: noStore },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  await disconnect(auth.user.id, mailServerUrl());
  return Response.json({ connected: false }, { headers: noStore });
}
