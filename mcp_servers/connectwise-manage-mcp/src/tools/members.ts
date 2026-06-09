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

const memberSummary: SummaryFn = (m) => ({
  id: m["id"],
  identifier: m["identifier"],
  firstName: m["firstName"],
  lastName: m["lastName"],
  licenseClass: m["licenseClass"],
  inactiveFlag: m["inactiveFlag"],
});

export function registerMemberTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_members",
    "Search ConnectWise Manage members (technicians/users). Returns a compact summary (id, identifier, firstName, lastName, licenseClass) by default — pass full=true or fields=[...] for more. Filter with CW conditions (e.g. \"identifier = 'jsmith'\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string (e.g. \"identifier = 'jsmith'\")"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search members", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/system/members", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], memberSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_members", err);
      }
    },
  );

  server.tool(
    "cw_get_member",
    "Get a ConnectWise Manage member (technician/user) by ID (required). Returns a compact summary by default; pass full=true or fields=[...] for role, work schedule, and license type details.",
    {
      id: z.number().describe("Member ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get member", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/system/members/${id}`);
        return shapeItem(result, memberSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_member", err, {
          hint: "Verify member id with cw_search_members first.",
        });
      }
    },
  );
}
