import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CwManageClient } from "../api-client.js";
import { READ, titled } from "./annotations.js";
import {
  shapeList,
  type SummaryFn,
} from "../_shared/response-shaper.js";
import { toolErrorFromCatch } from "../_shared/error-envelope.js";

const boardSummary: SummaryFn = (b) => ({
  id: b["id"],
  name: b["name"],
  inactiveFlag: b["inactiveFlag"],
});

const prioritySummary: SummaryFn = (p) => ({
  id: p["id"],
  name: p["name"],
  color: p["color"],
  defaultFlag: p["defaultFlag"],
});

const statusSummary: SummaryFn = (s) => ({
  id: s["id"],
  name: s["name"],
  closedStatus: s["closedStatus"],
  defaultFlag: s["defaultFlag"],
});

export function registerServiceTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_list_boards",
    "List service boards in ConnectWise Manage. Returns board IDs and names needed for cw_list_statuses and cw_create_ticket. Returns a compact summary by default; pass full=true or fields=[...] for more.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string (e.g. \"name like '%Service%'\")"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: list boards", READ),
    async ({ conditions, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/service/boards", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], boardSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_list_boards", err, {
          hint: "Verify CW_MANAGE_* credentials.",
        });
      }
    },
  );

  server.tool(
    "cw_list_priorities",
    "List ticket priority levels in ConnectWise Manage. Returns priority IDs and names needed for cw_create_ticket and cw_update_ticket. Returns a compact summary by default; pass full=true for more.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: list priorities", READ),
    async ({ conditions, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/service/priorities", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], prioritySummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_list_priorities", err, {
          hint: "Verify CW_MANAGE_* credentials.",
        });
      }
    },
  );

  server.tool(
    "cw_list_statuses",
    "List ticket statuses for a specific ConnectWise Manage service board (boardId required). Returns status IDs and names needed for cw_create_ticket and cw_update_ticket.",
    {
      boardId: z.number().describe("Integer service board ID (from cw_list_boards)"),
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: list statuses", READ),
    async ({ boardId, conditions, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>(`/service/boards/${boardId}/statuses`, {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], statusSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_list_statuses", err, {
          hint: "Verify boardId from cw_list_boards and CW_MANAGE_* credentials.",
        });
      }
    },
  );
}
