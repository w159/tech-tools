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

const timeEntrySummary: SummaryFn = (e) => ({
  id: e["id"],
  chargeToType: e["chargeToType"],
  chargeToId: e["chargeToId"],
  member: (e["member"] as Record<string, unknown> | undefined)?.name,
  timeStart: e["timeStart"],
  timeEnd: e["timeEnd"],
  actualHours: e["actualHours"],
  notes: typeof e["notes"] === "string" ? e["notes"].slice(0, 200) : e["notes"],
});

export function registerTimeEntryTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_time_entries",
    "Search ConnectWise Manage time entries. Returns a compact summary (id, chargeToType, chargeToId, member, times, hours, notes) by default — pass full=true or fields=[...] for more. Use CW conditions to filter (e.g. \"member/identifier = 'jsmith'\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string (e.g. \"member/identifier = 'jsmith'\")"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search time entries", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/time/entries", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], timeEntrySummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_time_entries", err);
      }
    },
  );

  server.tool(
    "cw_get_time_entry",
    "Get a ConnectWise Manage time entry by ID (required). Returns a compact summary by default; pass full=true or fields=[...] for work type, work role, and internal notes.",
    {
      id: z.number().describe("Time entry ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get time entry", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/time/entries/${id}`);
        return shapeItem(result, timeEntrySummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_time_entry", err, {
          hint: "Verify time entry id with cw_search_time_entries first.",
        });
      }
    },
  );

  server.tool(
    "cw_create_time_entry",
    "Create a ConnectWise Manage time entry (chargeToType, chargeToId, memberId, timeStart all required). Optionally provide timeEnd or actualHours, notes, workTypeId, and workRoleId.",
    {
      chargeToType: z.enum(["ServiceTicket", "ProjectTicket", "ChargeCode", "Activity"]).describe("What to charge the time to"),
      chargeToId: z.number().describe("ID of the ticket, charge code, or activity"),
      memberId: z.number().describe("Member ID for the time entry"),
      timeStart: z.string().describe("Start time (ISO 8601)"),
      timeEnd: z.string().optional().describe("End time (ISO 8601)"),
      actualHours: z.number().optional().describe("Actual hours worked (alternative to timeEnd)"),
      notes: z.string().optional().describe("Work notes"),
      internalNotes: z.string().optional().describe("Internal-only notes"),
      workTypeId: z.number().optional().describe("Work type ID"),
      workRoleId: z.number().optional().describe("Work role ID"),
    },
    titled("CW Manage: create time entry", WRITE_CREATE),
    async ({ chargeToType, chargeToId, memberId, timeStart, timeEnd, actualHours, notes, internalNotes, workTypeId, workRoleId }) => {
      try {
        const body: Record<string, unknown> = {
          chargeToType,
          chargeToId,
          member: { id: memberId },
          timeStart,
        };
        if (timeEnd) body.timeEnd = timeEnd;
        if (actualHours !== undefined) body.actualHours = actualHours;
        if (notes) body.notes = notes;
        if (internalNotes) body.internalNotes = internalNotes;
        if (workTypeId) body.workType = { id: workTypeId };
        if (workRoleId) body.workRole = { id: workRoleId };
        const result = await client.post<Record<string, unknown>>("/time/entries", body);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_create_time_entry", err, {
          hint: "Verify memberId with cw_search_members and chargeToId with the appropriate ticket tool.",
        });
      }
    },
  );
}
