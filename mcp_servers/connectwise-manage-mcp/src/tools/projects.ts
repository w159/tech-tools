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

const projectSummary: SummaryFn = (p) => ({
  id: p["id"],
  name: p["name"],
  status: (p["status"] as Record<string, unknown> | undefined)?.name,
  company: (p["company"] as Record<string, unknown> | undefined)?.name,
  manager: (p["manager"] as Record<string, unknown> | undefined)?.name,
  estimatedStart: p["estimatedStart"],
  estimatedEnd: p["estimatedEnd"],
  actualHours: p["actualHours"],
  budgetHours: p["budgetHours"],
});

const projectTicketSummary: SummaryFn = (t) => ({
  id: t["id"],
  summary: t["summary"],
  status: (t["status"] as Record<string, unknown> | undefined)?.name,
  phase: (t["phase"] as Record<string, unknown> | undefined)?.name,
  company: (t["company"] as Record<string, unknown> | undefined)?.name,
  owner: (t["owner"] as Record<string, unknown> | undefined)?.name,
  dateEntered: t["dateEntered"],
  closedFlag: t["closedFlag"],
});

export function registerProjectTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_projects",
    "Search projects in ConnectWise Manage. Returns a compact summary (id, name, status, company, manager, dates, hours) by default — pass full=true or fields=[...] for more.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search projects", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/project/projects", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], projectSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_projects", err);
      }
    },
  );

  server.tool(
    "cw_get_project",
    "Get a specific project by ID. Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object.",
    {
      id: z.number().describe("Project ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get project", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/project/projects/${id}`);
        return shapeItem(result, projectSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_project", err, {
          hint: "Verify project id with cw_search_projects first.",
        });
      }
    },
  );

  server.tool(
    "cw_search_project_tickets",
    "Search tickets under a project. Returns a compact summary (id, summary, status, phase, company, owner) by default — pass full=true or fields=[...] for more.",
    {
      projectId: z.number().optional().describe("Filter by project ID"),
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by (e.g. 'id desc')"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search project tickets", READ),
    async ({ projectId, conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const conditionParts: string[] = [];
        if (projectId !== undefined) conditionParts.push(`project/id=${projectId}`);
        if (conditions) conditionParts.push(conditions);

        const result = await client.get<unknown[]>("/project/tickets", {
          conditions: conditionParts.join(" and ") || undefined,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], projectTicketSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_project_tickets", err);
      }
    },
  );

  server.tool(
    "cw_get_project_ticket",
    "Get a specific project ticket by ID. Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object.",
    {
      id: z.number().describe("Project ticket ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get project ticket", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/project/tickets/${id}`);
        return shapeItem(result, projectTicketSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_project_ticket", err, {
          hint: "Verify project ticket id with cw_search_project_tickets first.",
        });
      }
    },
  );

  server.tool(
    "cw_get_project_ticket_notes",
    "Get all notes on a project ticket, including notes from any child tickets. Returns a compact summary by default; pass full=true for complete note objects.",
    {
      id: z.number().describe("Project ticket ID"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get project ticket notes", READ),
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
        const result = await client.get<unknown[]>(`/project/tickets/${id}/allNotes`, {
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
            const result = await client.get<unknown[]>(`/project/tickets/${id}/notes`, {
              page: page ?? 1,
              pageSize: pageSize ?? 25,
            });
            const items = Array.isArray(result) ? result : [];
            return shapeList(items as Record<string, unknown>[], noteSummary, { fields, full });
          } catch (fallbackErr) {
            return toolErrorFromCatch("cw_get_project_ticket_notes", fallbackErr, {
              hint: "Verify project ticket id with cw_search_project_tickets first.",
            });
          }
        }
        return toolErrorFromCatch("cw_get_project_ticket_notes", err, {
          hint: "Verify project ticket id with cw_search_project_tickets first.",
        });
      }
    },
  );

  server.tool(
    "cw_add_project_ticket_note",
    "Add a note to a project ticket. Use internalAnalysisFlag for internal-only notes or resolutionFlag for resolution notes. Defaults to a plain discussion note.",
    {
      id: z.number().describe("Project ticket ID"),
      text: z.string().describe("Note text content"),
      detailDescriptionFlag: z.boolean().optional().describe("Add as detail description (default: false)"),
      internalAnalysisFlag: z.boolean().optional().describe("Mark as internal analysis only (default: false)"),
      resolutionFlag: z.boolean().optional().describe("Mark as resolution note (default: false)"),
    },
    titled("CW Manage: add project ticket note", WRITE_CREATE),
    async ({ id, text, detailDescriptionFlag, internalAnalysisFlag, resolutionFlag }) => {
      try {
        const body: Record<string, unknown> = { text };
        if (detailDescriptionFlag !== undefined) body.detailDescriptionFlag = detailDescriptionFlag;
        if (internalAnalysisFlag !== undefined) body.internalAnalysisFlag = internalAnalysisFlag;
        if (resolutionFlag !== undefined) body.resolutionFlag = resolutionFlag;
        const result = await client.post<Record<string, unknown>>(`/project/tickets/${id}/notes`, body);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_add_project_ticket_note", err, {
          hint: "Verify project ticket id with cw_search_project_tickets first.",
        });
      }
    },
  );

  server.tool(
    "cw_create_project",
    "Create a new project.",
    {
      name: z.string().describe("Project name"),
      boardId: z.number().describe("Project board ID"),
      companyId: z.number().describe("Company ID"),
      estimatedStart: z.string().optional().describe("Estimated start date (ISO 8601)"),
      estimatedEnd: z.string().optional().describe("Estimated end date (ISO 8601)"),
      description: z.string().optional().describe("Project description"),
      managerId: z.number().optional().describe("Project manager member ID"),
    },
    titled("CW Manage: create project", WRITE_CREATE),
    async ({ name, boardId, companyId, estimatedStart, estimatedEnd, description, managerId }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          board: { id: boardId },
          company: { id: companyId },
        };
        if (estimatedStart) body.estimatedStart = estimatedStart;
        if (estimatedEnd) body.estimatedEnd = estimatedEnd;
        if (description) body.description = description;
        if (managerId) body.manager = { id: managerId };
        const result = await client.post<Record<string, unknown>>("/project/projects", body);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_create_project", err);
      }
    },
  );
}
