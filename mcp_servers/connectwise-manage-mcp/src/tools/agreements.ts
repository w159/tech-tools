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

const agreementSummary: SummaryFn = (a) => ({
  id: a["id"],
  name: a["name"],
  type: (a["type"] as Record<string, unknown> | undefined)?.name,
  company: (a["company"] as Record<string, unknown> | undefined)?.name,
  startDate: a["startDate"],
  endDate: a["endDate"],
  cancelledFlag: a["cancelledFlag"],
  billCycleType: a["billCycleType"],
});

const invoiceSummary: SummaryFn = (inv) => ({
  id: inv["id"],
  invoiceNumber: inv["invoiceNumber"],
  type: inv["type"],
  status: (inv["status"] as Record<string, unknown> | undefined)?.name,
  company: (inv["company"] as Record<string, unknown> | undefined)?.name,
  invoiceDate: inv["invoiceDate"],
  dueDate: inv["dueDate"],
  total: inv["total"],
  balance: inv["balance"],
});

const additionSummary: SummaryFn = (add) => ({
  id: add["id"],
  product: (add["product"] as Record<string, unknown> | undefined)?.identifier,
  quantity: add["quantity"],
  unitPrice: add["unitPrice"],
  extPrice: add["extPrice"],
  billCustomer: add["billCustomer"],
  effectiveDate: add["effectiveDate"],
  cancelledDate: add["cancelledDate"],
});

export function registerAgreementTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_agreements",
    "Search finance agreements (recurring revenue contracts) in ConnectWise Manage. Returns a compact summary (id, name, type, company, dates, status) by default — pass full=true or fields=[...] for more. Use 'conditions' for CW query syntax (e.g. \"cancelledFlag = false\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search agreements", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/finance/agreements", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], agreementSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_agreements", err);
      }
    },
  );

  server.tool(
    "cw_get_agreement",
    "Get a ConnectWise Manage finance agreement by ID (required). Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object.",
    {
      id: z.number().describe("Agreement ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get agreement", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/finance/agreements/${id}`);
        return shapeItem(result, agreementSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_agreement", err, {
          hint: "Verify agreement id with cw_search_agreements first.",
        });
      }
    },
  );

  server.tool(
    "cw_get_agreement_additions",
    "Get addition line items (products/quantities/rates) for a ConnectWise Manage agreement by agreementId (required). Returns a compact summary by default; pass full=true for complete line-item details.",
    {
      agreementId: z.number().describe("Agreement ID"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get agreement additions", READ),
    async ({ agreementId, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>(`/finance/agreements/${agreementId}/additions`, {
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], additionSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_agreement_additions", err, {
          hint: "Verify agreementId with cw_search_agreements first.",
        });
      }
    },
  );

  server.tool(
    "cw_search_invoices",
    "Search ConnectWise Manage invoices. Returns a compact summary (id, invoiceNumber, type, status, company, dates, total, balance) by default — pass full=true or fields=[...] for more. Use 'conditions' for CW query syntax (e.g. \"company/name = 'Acme'\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string (e.g. \"company/name = 'Acme'\")"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by (e.g. 'id desc')"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search invoices", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/finance/invoices", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], invoiceSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_invoices", err);
      }
    },
  );

  server.tool(
    "cw_get_invoice",
    "Get a ConnectWise Manage invoice by ID (required). Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object including line items.",
    {
      id: z.number().describe("Invoice ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get invoice", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/finance/invoices/${id}`);
        return shapeItem(result, invoiceSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_invoice", err, {
          hint: "Verify invoice id with cw_search_invoices first.",
        });
      }
    },
  );
}
