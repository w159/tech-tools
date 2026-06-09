import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CwManageClient } from "../api-client.js";
import { READ, titled } from "./annotations.js";
import {
  shapeList,
  shapeItem,
  type SummaryFn,
} from "../_shared/response-shaper.js";
import { toolErrorFromCatch } from "../_shared/error-envelope.js";

const configurationSummary: SummaryFn = (c) => ({
  id: c["id"],
  name: c["name"],
  type: (c["type"] as Record<string, unknown> | undefined)?.name,
  status: (c["status"] as Record<string, unknown> | undefined)?.name,
  company: (c["company"] as Record<string, unknown> | undefined)?.name,
  serialNumber: c["serialNumber"],
  activeFlag: c["activeFlag"],
});

export function registerConfigurationTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_configurations",
    "Search ConnectWise Manage configuration items (assets/CIs). Returns a compact summary (id, name, type, status, company, serialNumber) by default — pass full=true or fields=[...] for more. Use CW conditions to filter (e.g. \"company/name = 'Acme'\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string (e.g. \"company/name = 'Acme'\")"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search configurations", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/company/configurations", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], configurationSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_configurations", err);
      }
    },
  );

  server.tool(
    "cw_get_configuration",
    "Get a ConnectWise Manage configuration item (asset/CI) by ID (required). Returns a compact summary by default; pass full=true or fields=[...] for custom field values and the complete vendor object.",
    {
      id: z.number().describe("Configuration item ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get configuration", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/company/configurations/${id}`);
        return shapeItem(result, configurationSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_configuration", err, {
          hint: "Verify configuration id with cw_search_configurations first.",
        });
      }
    },
  );
}
