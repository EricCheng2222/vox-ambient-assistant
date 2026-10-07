import { requireUser } from "@/lib/auth";
import {
  beginConnection,
  connectionStatus,
  disconnect,
  veloServerUrl,
  McpConnectionError,
} from "@/lib/mcp-client";

// Vox's connection to VÉLO, the user's notebook (the velo/ Worker in the Vox family).
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const serverUrl = veloServerUrl();
  return Response.json(
    { ...(await connectionStatus(auth.user.id, serverUrl)), serverUrl, siteUrl: new URL(serverUrl).origin },
    { headers: noStore },
  );
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    const authorizeUrl = await beginConnection(auth.user.id, veloServerUrl(), new URL(request.url).origin);
    return Response.json({ authorizeUrl }, { headers: noStore });
  } catch (error) {
    if (!(error instanceof McpConnectionError)) console.error("VÉLO connection failed", error);
    return Response.json(
      { error: error instanceof McpConnectionError ? error.message : "VÉLO is unavailable right now." },
      { status: 502, headers: noStore },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  await disconnect(auth.user.id, veloServerUrl());
  return Response.json({ connected: false }, { headers: noStore });
}
