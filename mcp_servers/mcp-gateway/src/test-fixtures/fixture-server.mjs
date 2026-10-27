// Stdio MCP server with one tool per effect class, used by the integration
// tests to exercise a real Backend over a real child process.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fixture", version: "1.0.0" });
const echo = (name) => async (args) => ({
  content: [{ type: "text", text: `${name} ok ${JSON.stringify(args)}` }],
});

server.registerTool(
  "fx_read",
  { description: "read fixture", inputSchema: { q: z.string().optional() }, annotations: { readOnlyHint: true } },
  echo("fx_read"),
);
server.registerTool(
  "fx_write",
  {
    description: "write fixture",
    inputSchema: { value: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  echo("fx_write"),
);
server.registerTool(
  "fx_delete",
  {
    description: "destructive fixture",
    inputSchema: { id: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  echo("fx_delete"),
);

await server.connect(new StdioServerTransport());
