import { requireUser } from "@/lib/auth";
import { getAccessToken, isTokenAccepted, mailServerUrl } from "@/lib/mcp-client";

// A current access token for the user's Vox Mail connection, handed to the
// live voice session so OpenAI Realtime can call the mail MCP server.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const serverUrl = mailServerUrl();
  const current = (options?: { forceRefresh?: boolean }) =>
    getAccessToken(auth.user.id, serverUrl, options).catch((error) => {
      console.error("Mail token refresh failed", error);
      return null;
    });
  let token = await current();
  if (token && !(await isTokenAccepted(serverUrl, token))) token = await current({ forceRefresh: true });
  if (!token) {
    return Response.json(
      { error: "Connect your email first.", needsConnection: true },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json({ token, serverUrl }, { headers: { "Cache-Control": "no-store" } });
}
