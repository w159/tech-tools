import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CwManageClient } from "../api-client.js";
import { READ, WRITE_CREATE, titled } from "./annotations.js";
import {
  shapeList,
  shapeItem,
  shapeRaw,
  type SummaryFn,
} from "../_shared/response-shaper.js";
import { toolErrorFromCatch } from "../_shared/error-envelope.js";

const activitySummary: SummaryFn = (a) => ({
  id: a["id"],
  name: a["name"],
  type: (a["type"] as Record<string, unknown> | undefined)?.name,
  status: (a["status"] as Record<string, unknown> | undefined)?.name,
  company: (a["company"] as Record<string, unknown> | undefined)?.name,
  assignTo: (a["assignTo"] as Record<string, unknown> | undefined)?.name,
  dateStart: a["dateStart"],
  dateEnd: a["dateEnd"],
});

export function registerActivityTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_activities",
    "Search sales/schedule activities in ConnectWise Manage; use CW conditions to filter (e.g. \"assignTo/identifier = 'jsmith'\"). Returns a compact summary (id, name, type, status, company, assignTo, dates) by default — pass full=true or fields=[...] for more.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search activities", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/sales/activities", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], activitySummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_activities", err);
      }
    },
  );

  server.tool(
    "cw_get_activity",
    "Get a ConnectWise Manage sales activity by ID (required). Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object.",
    {
      id: z.number().describe("Activity ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get activity", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/sales/activities/${id}`);
        return shapeItem(result, activitySummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_activity", err, {
          hint: "Verify activity id with cw_search_activities first.",
        });
      }
    },
  );

  server.tool(
    "cw_create_activity",
    "Create a ConnectWise Manage sales activity (name required). Optionally associate with typeId, companyId, contactId, memberId, and schedule via dateStart/dateEnd (ISO 8601).",
    {
      name: z.string().describe("Activity name/subject"),
      typeId: z.number().optional().describe("Activity type ID"),
      companyId: z.number().optional().describe("Company ID"),
      contactId: z.number().optional().describe("Contact ID"),
      memberId: z.number().optional().describe("Assigned member ID"),
      notes: z.string().optional().describe("Activity notes"),
      dateStart: z.string().optional().describe("Start date (ISO 8601)"),
      dateEnd: z.string().optional().describe("End date (ISO 8601)"),
    },
    titled("CW Manage: create activity", WRITE_CREATE),
    async ({ name, typeId, companyId, contactId, memberId, notes, dateStart, dateEnd }) => {
      try {
        const body: Record<string, unknown> = { name };
        if (typeId) body.type = { id: typeId };
        if (companyId) body.company = { id: companyId };
        if (contactId) body.contact = { id: contactId };
        if (memberId) body.assignTo = { id: memberId };
        if (notes) body.notes = notes;
        if (dateStart) body.dateStart = dateStart;
        if (dateEnd) body.dateEnd = dateEnd;
        const result = await client.post<Record<string, unknown>>("/sales/activities", body);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_create_activity", err);
      }
    },
  );
}
