import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CwManageClient, getConfig } from "../api-client.js";
import { READ, titled } from "./annotations.js";
import { shapeRaw } from "../_shared/response-shaper.js";
import { toolErrorFromCatch } from "../_shared/error-envelope.js";

export function registerHealthTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_status",
    "Show ConnectWise Manage MCP server configuration status: which environment variables are set and what base URL is in use. Always works, even with missing credentials.",
    {},
    titled("CW Manage: status", READ),
    async () => {
      const config = getConfig();
      const status = {
        configured: !!config,
        baseUrl: config?.baseUrl ?? process.env.CW_MANAGE_URL ?? process.env.CW_MANAGE_BASE_URL ?? "https://api-na.myconnectwise.net (default)",
        credentials: {
          CW_MANAGE_COMPANY_ID: process.env.CW_MANAGE_COMPANY_ID ? "set" : "NOT SET — required",
          CW_MANAGE_PUBLIC_KEY: process.env.CW_MANAGE_PUBLIC_KEY ? "set" : "NOT SET — required",
          CW_MANAGE_PRIVATE_KEY: process.env.CW_MANAGE_PRIVATE_KEY ? "set" : "NOT SET — required",
          CW_MANAGE_CLIENT_ID: process.env.CW_MANAGE_CLIENT_ID ? "set" : "NOT SET — required",
          CW_MANAGE_URL: process.env.CW_MANAGE_URL ?? process.env.CW_MANAGE_BASE_URL ?? "(not set — using default)",
        },
      };
      return shapeRaw(status);
    },
  );

  server.tool(
    "cw_test_connection",
    "Verify ConnectWise Manage API connectivity by fetching system info. Returns API version and licensing details. Use to confirm credentials are working.",
    {},
    titled("CW Manage: test connection", READ),
    async () => {
      try {
        const result = await client.get<Record<string, unknown>>("/system/info");
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_test_connection", err, {
          hint: "Verify CW_MANAGE_COMPANY_ID, CW_MANAGE_PUBLIC_KEY, CW_MANAGE_PRIVATE_KEY, CW_MANAGE_CLIENT_ID, and CW_MANAGE_URL are correct.",
        });
      }
    },
  );
}
