import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CwManageClient } from "../api-client.js";
import { READ, WRITE_CREATE, WRITE_UPDATE, titled } from "./annotations.js";
import {
  shapeList,
  shapeItem,
  shapeRaw,
  type SummaryFn,
} from "../_shared/response-shaper.js";
import { toolErrorFromCatch } from "../_shared/error-envelope.js";

// Compact summary for list/search results. Covers triage-relevant fields.
// Pass full=true or fields=[...] to retrieve additional fields.
const ticketSummary: SummaryFn = (t) => ({
  id: t["id"],
  summary: t["summary"],
  status: (t["status"] as Record<string, unknown> | undefined)?.name,
  board: (t["board"] as Record<string, unknown> | undefined)?.name,
  company: (t["company"] as Record<string, unknown> | undefined)?.name,
  contact: (t["contact"] as Record<string, unknown> | undefined)
    ? `${(t["contact"] as Record<string, unknown>)["name"] ?? ""}`.trim() || undefined
    : undefined,
  priority: (t["priority"] as Record<string, unknown> | undefined)?.name,
  owner: (t["owner"] as Record<string, unknown> | undefined)?.name,
  dateEntered: t["dateEntered"],
  lastUpdated: t["_info"]
    ? (t["_info"] as Record<string, unknown>)["lastUpdated"]
    : undefined,
  slaStatus: t["slaStatus"] ?? undefined,
  closedFlag: t["closedFlag"],
});

export function registerTicketTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_tickets",
    "Search service tickets in ConnectWise Manage. Returns a compact summary (id, summary, status, board, company, contact, priority, owner, dates) by default — pass full=true or fields=[...] for more. Use 'conditions' for CW query syntax (e.g. \"board/name='Triage' AND closedFlag=false\").",
    {
      conditions: z
        .string()
        .optional()
        .describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z
        .number()
        .optional()
        .describe("Results per page (default: 25, max: 1000)"),
      orderBy: z
        .string()
        .optional()
        .describe("Field to order by (e.g. 'id desc')"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search tickets", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/service/tickets", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], ticketSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_tickets", err, {
          hint: "Check conditions syntax. Example: \"board/name='Triage' AND closedFlag=false\".",
        });
      }
    },
  );

  server.tool(
    "cw_get_ticket",
    "Get a ConnectWise Manage service ticket by ID (required). Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object.",
    {
      id: z.number().describe("Ticket ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get ticket", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/service/tickets/${id}`);
        return shapeItem(result, ticketSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_ticket", err, {
          hint: "Verify ticket id with cw_search_tickets first.",
        });
      }
    },
  );

  server.tool(
    "cw_create_ticket",
    "Create a new ConnectWise Manage service ticket (summary required). Optionally associate with boardId, companyId, contactId, statusId, priorityId, typeId, subTypeId, and provide an initialDescription.",
    {
      summary: z.string().describe("Ticket summary/title"),
      boardId: z.number().optional().describe("Service board ID"),
      companyId: z.number().optional().describe("Company ID to associate"),
      contactId: z.number().optional().describe("Contact ID to associate"),
      statusId: z.number().optional().describe("Status ID"),
      priorityId: z.number().optional().describe("Priority ID"),
      typeId: z.number().optional().describe("Type ID"),
      subTypeId: z.number().optional().describe("SubType ID"),
      initialDescription: z.string().optional().describe("Initial ticket description"),
    },
    titled("CW Manage: create ticket", WRITE_CREATE),
    async ({ summary, boardId, companyId, contactId, statusId, priorityId, typeId, subTypeId, initialDescription }) => {
      try {
        const body: Record<string, unknown> = { summary };
        if (boardId) body.board = { id: boardId };
        if (companyId) body.company = { id: companyId };
        if (contactId) body.contact = { id: contactId };
        if (statusId) body.status = { id: statusId };
        if (priorityId) body.priority = { id: priorityId };
        if (typeId) body.type = { id: typeId };
        if (subTypeId) body.subType = { id: subTypeId };
        if (initialDescription) body.initialDescription = initialDescription;
        const result = await client.post<Record<string, unknown>>("/service/tickets", body);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_create_ticket", err, {
          hint: "Verify boardId with cw_list_boards and companyId with cw_search_companies.",
        });
      }
    },
  );

  server.tool(
    "cw_update_ticket",
    "Update a ConnectWise Manage service ticket (id required) via JSON Patch operations. Each operation needs op (replace/add/remove), path (e.g. 'status/id', 'summary'), and value.",
    {
      id: z.number().describe("Ticket ID"),
      operations: z
        .array(
          z.object({
            op: z.enum(["replace", "add", "remove"]).describe("Patch operation"),
            path: z.string().describe("JSON path (e.g. 'status/id', 'summary')"),
            value: z.unknown().optional().describe("New value"),
          }),
        )
        .describe("Array of JSON Patch operations"),
    },
    titled("CW Manage: update ticket", WRITE_UPDATE),
    async ({ id, operations }) => {
      try {
        const result = await client.patch<Record<string, unknown>>(`/service/tickets/${id}`, operations);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_update_ticket", err, {
          hint: "Verify ticket id and operation paths (e.g. 'status/id', 'summary').",
        });
      }
    },
  );

  server.tool(
    "cw_get_ticket_notes",
    "Get all notes/discussions on a service ticket, including notes from any child tickets. Returns a compact summary by default; pass full=true for complete note objects.",
    {
      id: z.number().describe("Ticket ID"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get ticket notes", READ),
    async ({ id, page, pageSize, fields, full }) => {
      const noteSummary: SummaryFn = (n) => ({
        id: n["id"],
        text: typeof n["text"] === "string" ? n["text"].slice(0, 300) : n["text"],
        member: (n["member"] as Record<string, unknown> | undefined)?.name,
        dateCreated: n["dateCreated"],
        internalAnalysisFlag: n["internalAnalysisFlag"],
        resolutionFlag: n["resolutionFlag"],
      });
      try {
        const result = await client.get<unknown[]>(`/service/tickets/${id}/allNotes`, {
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], noteSummary, { fields, full });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("404") || msg.includes("405")) {
          // allNotes not supported on this CWM version — fall back to /notes
          try {
            const result = await client.get<unknown[]>(`/service/tickets/${id}/notes`, {
              page: page ?? 1,
              pageSize: pageSize ?? 25,
            });
            const items = Array.isArray(result) ? result : [];
            return shapeList(items as Record<string, unknown>[], noteSummary, { fields, full });
          } catch (fallbackErr) {
            return toolErrorFromCatch("cw_get_ticket_notes", fallbackErr, {
              hint: "Verify ticket id with cw_search_tickets first.",
            });
          }
        }
        return toolErrorFromCatch("cw_get_ticket_notes", err, {
          hint: "Verify ticket id with cw_search_tickets first.",
        });
      }
    },
  );

  server.tool(
    "cw_add_ticket_note",
    "Add a note to a service ticket. Use detailDescriptionFlag for a description note, internalAnalysisFlag for an internal-only note, or resolutionFlag for a resolution note. Defaults to a plain discussion note visible to the customer.",
    {
      id: z.number().describe("Ticket ID"),
      text: z.string().describe("Note text content"),
      detailDescriptionFlag: z.boolean().optional().describe("Add as detail description (default: false)"),
      internalAnalysisFlag: z.boolean().optional().describe("Mark as internal analysis only (default: false)"),
      resolutionFlag: z.boolean().optional().describe("Mark as resolution note (default: false)"),
      customerUpdatedFlag: z.boolean().optional().describe("Flag that the customer was updated (default: false)"),
    },
    titled("CW Manage: add ticket note", WRITE_CREATE),
    async ({ id, text, detailDescriptionFlag, internalAnalysisFlag, resolutionFlag, customerUpdatedFlag }) => {
      try {
        const body: Record<string, unknown> = { text };
        if (detailDescriptionFlag !== undefined) body.detailDescriptionFlag = detailDescriptionFlag;
        if (internalAnalysisFlag !== undefined) body.internalAnalysisFlag = internalAnalysisFlag;
        if (resolutionFlag !== undefined) body.resolutionFlag = resolutionFlag;
        if (customerUpdatedFlag !== undefined) body.customerUpdatedFlag = customerUpdatedFlag;
        const result = await client.post<Record<string, unknown>>(`/service/tickets/${id}/notes`, body);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_add_ticket_note", err, {
          hint: "Verify ticket id with cw_search_tickets first.",
        });
      }
    },
  );
}
