// Stdio MCP backend for the admin end-to-end test: four tools named after the
// connector given as argv[2], one per effect class plus a secret-ish read.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const id = process.argv[2];
const server = new McpServer({ name: id, version: "1.0.0" });
const ok = (name) => async () => ({ content: [{ type: "text", text: `${name} ok` }] });
const input = { q: z.string().optional() };

server.registerTool(`${id}_list`, { description: "list", inputSchema: input, annotations: { readOnlyHint: true } }, ok(`${id}_list`));
server.registerTool(`${id}_get_secret`, { description: "read a secret", inputSchema: input, annotations: { readOnlyHint: true } }, ok(`${id}_get_secret`));
server.registerTool(`${id}_update`, { description: "update", inputSchema: input, annotations: { readOnlyHint: false, destructiveHint: false } }, ok(`${id}_update`));
server.registerTool(`${id}_delete`, { description: "delete", inputSchema: input, annotations: { readOnlyHint: false, destructiveHint: true } }, ok(`${id}_delete`));

await server.connect(new StdioServerTransport());
