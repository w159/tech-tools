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

const companySummary: SummaryFn = (c) => ({
  id: c["id"],
  name: c["name"],
  identifier: c["identifier"],
  status: (c["status"] as Record<string, unknown> | undefined)?.name,
  phoneNumber: c["phoneNumber"],
  city: c["city"],
  state: c["state"],
  website: c["website"],
});

export function registerCompanyTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_companies",
    "Search companies in ConnectWise Manage. Returns a compact summary (id, name, identifier, status, phone, city, state) by default — pass full=true or fields=[...] for more. Use 'conditions' for CW query syntax (e.g. \"name like '%Acme%'\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search companies", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/company/companies", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], companySummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_companies", err);
      }
    },
  );

  server.tool(
    "cw_get_company",
    "Get a ConnectWise Manage company by ID (required). Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object.",
    {
      id: z.number().describe("Company ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get company", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/company/companies/${id}`);
        return shapeItem(result, companySummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_company", err, {
          hint: "Verify company id with cw_search_companies first.",
        });
      }
    },
  );

  server.tool(
    "cw_create_company",
    "Create a new ConnectWise Manage company (name and identifier required). Optionally include address, type IDs, status, phone, and website.",
    {
      name: z.string().describe("Company name"),
      identifier: z.string().describe("Unique company identifier (short code)"),
      typeIds: z.array(z.number()).optional().describe("Array of company type IDs"),
      statusId: z.number().optional().describe("Company status ID"),
      addressLine1: z.string().optional().describe("Street address"),
      city: z.string().optional().describe("City"),
      state: z.string().optional().describe("State/province"),
      zip: z.string().optional().describe("Postal/ZIP code"),
      country: z.string().optional().describe("Country"),
      phoneNumber: z.string().optional().describe("Phone number"),
      website: z.string().optional().describe("Website URL"),
    },
    titled("CW Manage: create company", WRITE_CREATE),
    async ({ name, identifier, typeIds, statusId, addressLine1, city, state, zip, country, phoneNumber, website }) => {
      try {
        const body: Record<string, unknown> = { name, identifier };
        if (typeIds?.length) body.types = typeIds.map((id) => ({ id }));
        if (statusId) body.status = { id: statusId };
        if (addressLine1) body.addressLine1 = addressLine1;
        if (city) body.city = city;
        if (state) body.state = state;
        if (zip) body.zip = zip;
        if (country) body.country = { name: country };
        if (phoneNumber) body.phoneNumber = phoneNumber;
        if (website) body.website = website;
        const result = await client.post<Record<string, unknown>>("/company/companies", body);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_create_company", err);
      }
    },
  );

  server.tool(
    "cw_update_company",
    "Update a ConnectWise Manage company by ID (required) using JSON Patch operations array. Each operation needs op (replace/add/remove), path (e.g. 'name'), and value.",
    {
      id: z.number().describe("Company ID"),
      operations: z
        .array(
          z.object({
            op: z.enum(["replace", "add", "remove"]).describe("Patch operation"),
            path: z.string().describe("JSON path (e.g. 'name', 'phoneNumber')"),
            value: z.unknown().optional().describe("New value"),
          }),
        )
        .describe("Array of JSON Patch operations"),
    },
    titled("CW Manage: update company", WRITE_UPDATE),
    async ({ id, operations }) => {
      try {
        const result = await client.patch<Record<string, unknown>>(`/company/companies/${id}`, operations);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_update_company", err, {
          hint: "Verify company id with cw_search_companies first.",
        });
      }
    },
  );
}
