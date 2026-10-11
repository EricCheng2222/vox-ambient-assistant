import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/** Only this task's Codex child can call these tools. No browser origin is accepted. */
export async function startGptToolServer(tools) {
  const token = randomBytes(32).toString("base64url");
  const connections = new Set();
  let origin;
  const server = createServer(async (request, response) => {
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(String(request.headers.authorization ?? ""));
    if (request.headers.origin || request.headers.host !== new URL(origin).host || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      response.writeHead(401).end();
      return;
    }
    if (request.url !== "/mcp" || request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let mcp;
    let transport;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 64_000) { response.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      mcp = new McpServer({ name: "vox-task-tools", version: "1.0.0" });
      for (const tool of tools) {
        mcp.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema, annotations: { readOnlyHint: tool.name === "browser_look", openWorldHint: tool.name !== "task_finish" } }, async (input) => {
          try {
            const result = await tool.execute(input);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
          } catch {
            return { isError: true, content: [{ type: "text", text: "The Vox tool could not complete. Read the page again or report what is missing." }] };
          }
        });
      }
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      connections.add(transport);
      response.on("close", () => {
        connections.delete(transport);
        void transport.close().catch(() => undefined);
        void mcp.close().catch(() => undefined);
      });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) response.writeHead(400).end();
      else response.end();
      if (transport) connections.delete(transport);
      await transport?.close();
      await mcp?.close();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    config: {
      url: `${origin}/mcp`, http_headers: { Authorization: `Bearer ${token}` }, required: true,
      // These are task-scoped Vox tools. Their executor enforces the user's
      // existing approval level; Codex must not prompt for each ordinary step.
      default_tools_approval_mode: "approve",
      tools: Object.fromEntries(tools.map((tool) => [tool.name, { approval_mode: "approve" }])),
    },
    async close() {
      await Promise.allSettled([...connections].map((transport) => transport.close()));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
