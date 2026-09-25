import { authorizationServerMetadata } from "@/lib/oauth";

// Served at /.well-known/oauth-authorization-server (see worker-entry.mjs).
export async function GET(request: Request) {
  return Response.json(authorizationServerMetadata(new URL(request.url).origin), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=300" },
  });
}
