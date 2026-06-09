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

const opportunitySummary: SummaryFn = (o) => ({
  id: o["id"],
  name: o["name"],
  status: (o["status"] as Record<string, unknown> | undefined)?.name,
  stage: (o["stage"] as Record<string, unknown> | undefined)?.name,
  company: (o["company"] as Record<string, unknown> | undefined)?.name,
  contact: (o["contact"] as Record<string, unknown> | undefined)?.name,
  closedDate: o["closedDate"],
  expectedCloseDate: o["expectedCloseDate"],
  probability: (o["probability"] as Record<string, unknown> | undefined)?.probability,
  revenue: o["revenue"],
  closedFlag: o["closedFlag"],
});

const stageSummary: SummaryFn = (s) => ({
  id: s["id"],
  name: s["name"],
  probability: (s["probability"] as Record<string, unknown> | undefined)?.probability,
  successfulFlag: s["successfulFlag"],
});

export function registerOpportunityTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_opportunities",
    "Search sales opportunities in ConnectWise Manage. Returns a compact summary (id, name, status, stage, company, contact, dates, revenue) by default — pass full=true or fields=[...] for more. Use 'conditions' for CW query syntax (e.g. \"closedFlag = false\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by (e.g. 'id desc')"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search opportunities", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/sales/opportunities", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], opportunitySummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_opportunities", err);
      }
    },
  );

  server.tool(
    "cw_get_opportunity",
    "Get a specific sales opportunity by ID. Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object.",
    {
      id: z.number().describe("Opportunity ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get opportunity", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/sales/opportunities/${id}`);
        return shapeItem(result, opportunitySummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_opportunity", err, {
          hint: "Verify opportunity id with cw_search_opportunities first.",
        });
      }
    },
  );

  server.tool(
    "cw_search_opportunity_forecasts",
    "Search opportunity forecasts/revenue items for a specific opportunity. Returns a compact summary by default; pass full=true for complete forecast details.",
    {
      opportunityId: z.number().describe("Opportunity ID"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search opportunity forecasts", READ),
    async ({ opportunityId, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>(`/sales/opportunities/${opportunityId}/forecast`, {
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        const forecastSummary: SummaryFn = (f) => ({
          id: f["id"],
          forecastType: (f["forecastType"] as Record<string, unknown> | undefined)?.name,
          product: (f["product"] as Record<string, unknown> | undefined)?.identifier,
          quantity: f["quantity"],
          unitPrice: f["unitPrice"],
          extPrice: f["extPrice"],
        });
        return shapeList(items as Record<string, unknown>[], forecastSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_opportunity_forecasts", err, {
          hint: "Verify opportunityId with cw_search_opportunities first.",
        });
      }
    },
  );

  server.tool(
    "cw_search_opportunity_notes",
    "Get notes on a specific sales opportunity. Returns a compact summary by default; pass full=true for complete note content.",
    {
      opportunityId: z.number().describe("Opportunity ID"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search opportunity notes", READ),
    async ({ opportunityId, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>(`/sales/opportunities/${opportunityId}/notes`, {
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        const noteSummary: SummaryFn = (n) => ({
          id: n["id"],
          text: typeof n["text"] === "string" ? n["text"].slice(0, 300) : n["text"],
          member: (n["member"] as Record<string, unknown> | undefined)?.name,
          dateCreated: n["dateCreated"],
        });
        return shapeList(items as Record<string, unknown>[], noteSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_opportunity_notes", err, {
          hint: "Verify opportunityId with cw_search_opportunities first.",
        });
      }
    },
  );

  server.tool(
    "cw_search_sales_stages",
    "List sales pipeline stages in ConnectWise Manage. Returns id, name, and probability by default.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search sales stages", READ),
    async ({ conditions, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/sales/stages", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], stageSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_sales_stages", err);
      }
    },
  );
}
