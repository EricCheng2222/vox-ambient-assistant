import { getAccessToken, serverFetch } from "@/lib/mcp-client";

// Vox calling one tool on a connected MCP server from the server side (for
// example to build the Today briefing). Both Vox servers (Flash Cards and
// Mail) are stateless Streamable HTTP servers that answer tools/call without
// an initialize handshake or a session id, so one POST is enough.

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CALL_TIMEOUT_MS = 8_000;

export type McpToolResult = {
  /** The tool's text content, joined. */
  text: string;
  /** True when the server reports that the tool failed; text says why. */
  isError: boolean;
};

export class McpCallError extends Error {}

type JsonRpcResponse = {
  id?: unknown;
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  error?: { code?: number; message?: string };
};

/** Reads a JSON-RPC reply sent as JSON or as a server-sent event stream. */
async function readRpcResponse(response: Response, id: string): Promise<JsonRpcResponse> {
  const raw = await response.text();
  const candidates = (response.headers.get("Content-Type") ?? "").includes("text/event-stream")
    ? raw
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
    : [raw];
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const messages = (Array.isArray(parsed) ? parsed : [parsed]) as JsonRpcResponse[];
    const match = messages.find((message) => message && typeof message === "object" && message.id === id);
    if (match) return match;
  }
  throw new McpCallError("The server sent an unreadable reply.");
}

async function post(serverUrl: string, token: string, id: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
  return serverFetch(serverUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    signal,
  });
}

type ToolCall = { name: string; args?: Record<string, unknown> };

async function runCall(
  serverUrl: string,
  token: () => Promise<string | null>,
  refreshedToken: () => Promise<string | null>,
  call: ToolCall,
  signal: AbortSignal,
): Promise<McpToolResult | null> {
  const id = `vox-${crypto.randomUUID()}`;
  const args = call.args ?? {};
  try {
    let current = await token();
    if (!current) return null;
    let response = await post(serverUrl, current, id, call.name, args, signal);
    if (response.status === 401 || response.status === 403) {
      // Rejected (expired early or revoked there): refresh once. A failed
      // refresh disconnects, so the user sees "Connect" again.
      await response.body?.cancel();
      current = await refreshedToken();
      if (!current) return null;
      response = await post(serverUrl, current, id, call.name, args, signal);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new McpCallError(`The server answered ${response.status}.`);
    }
    const reply = await readRpcResponse(response, id);
    if (reply.error) throw new McpCallError(reply.error.message?.slice(0, 200) || "The server could not run that tool.");
    const text = (reply.result?.content ?? [])
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
    return { text, isError: reply.result?.isError === true };
  } catch (error) {
    if (error instanceof McpCallError) throw error;
    if (signal.aborted) throw new McpCallError("The server took too long to answer.");
    throw new McpCallError("The server could not be reached.");
  }
}

function once<T>(load: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => (pending ??= load());
}

/**
 * Calls several tools on one server in parallel for a Vox user, sharing one
 * token lookup (and at most one refresh, since refresh tokens may rotate).
 * Resolves to null when the user has not connected the server (or must
 * connect again); otherwise each call settles on its own, rejecting with
 * McpCallError when the server cannot be reached or answers with a protocol
 * error. Everything is abandoned after 8 seconds.
 */
export async function callMcpTools(
  ownerId: string,
  serverUrl: string,
  calls: ToolCall[],
): Promise<Array<PromiseSettledResult<McpToolResult>> | null> {
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const token = once(() => getAccessToken(ownerId, serverUrl));
  const refreshedToken = once(() => getAccessToken(ownerId, serverUrl, { forceRefresh: true }));
  try {
    if (!(await token())) return null;
  } catch {
    throw new McpCallError("Vox could not read this connection.");
  }
  const settled = await Promise.allSettled(calls.map((call) => runCall(serverUrl, token, refreshedToken, call, signal)));
  // A call that found the connection gone means the user must connect again.
  if (settled.some((result) => result.status === "fulfilled" && result.value === null)) return null;
  return settled as Array<PromiseSettledResult<McpToolResult>>;
}

/**
 * Calls one tool for a Vox user and returns its text content. Returns null
 * when the user has not connected the server; throws McpCallError when the
 * server cannot be reached or answers with a protocol error.
 */
export async function callMcpTool(
  ownerId: string,
  serverUrl: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult | null> {
  const results = await callMcpTools(ownerId, serverUrl, [{ name, args }]);
  if (!results) return null;
  const [result] = results;
  if (result.status === "rejected") throw result.reason;
  return result.value;
}
