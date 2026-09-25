import { requireUser } from "@/lib/auth";
import { flashcardsServerUrl, getAccessToken, isTokenAccepted } from "@/lib/mcp-client";

// A current access token for the user's Vox Flash Cards connection, handed to
// the live voice session so OpenAI Realtime can call the flash-card MCP server.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const serverUrl = flashcardsServerUrl();
  const current = (options?: { forceRefresh?: boolean }) =>
    getAccessToken(auth.user.id, serverUrl, options).catch((error) => {
      console.error("Flash-card token refresh failed", error);
      return null;
    });
  let token = await current();
  // If the user disconnected Vox on the flash-card site, the stored token is
  // rejected; refreshing then fails too and Vox shows "Connect" again.
  if (token && !(await isTokenAccepted(serverUrl, token))) token = await current({ forceRefresh: true });
  if (!token) {
    return Response.json(
      { error: "Connect Vox Flash Cards first.", needsConnection: true },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json({ token, serverUrl }, { headers: { "Cache-Control": "no-store" } });
}
