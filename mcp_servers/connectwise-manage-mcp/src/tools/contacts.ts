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

const contactSummary: SummaryFn = (c) => ({
  id: c["id"],
  firstName: c["firstName"],
  lastName: c["lastName"],
  title: c["title"],
  company: (c["company"] as Record<string, unknown> | undefined)?.name,
  inactiveFlag: c["inactiveFlag"],
});

export function registerContactTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_contacts",
    "Search contacts in ConnectWise Manage. Returns a compact summary (id, firstName, lastName, title, company) by default — pass full=true or fields=[...] for more. Use 'conditions' for CW query syntax (e.g. \"firstName = 'John'\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search contacts", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/company/contacts", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], contactSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_contacts", err);
      }
    },
  );

  server.tool(
    "cw_get_contact",
    "Get a ConnectWise Manage contact by ID (required). Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object including email and phone.",
    {
      id: z.number().describe("Contact ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get contact", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/company/contacts/${id}`);
        return shapeItem(result, contactSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_contact", err, {
          hint: "Verify contact id with cw_search_contacts first.",
        });
      }
    },
  );

  server.tool(
    "cw_create_contact",
    "Create a new ConnectWise Manage contact (firstName, lastName, and companyId required). Optionally add email, phone, and title.",
    {
      firstName: z.string().describe("First name"),
      lastName: z.string().describe("Last name"),
      companyId: z.number().describe("Company ID to associate the contact with"),
      email: z.string().optional().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
      title: z.string().optional().describe("Job title"),
    },
    titled("CW Manage: create contact", WRITE_CREATE),
    async ({ firstName, lastName, companyId, email, phone, title }) => {
      try {
        const body: Record<string, unknown> = {
          firstName,
          lastName,
          company: { id: companyId },
        };
        if (title) body.title = title;

        // CW Manage uses communicationItems for email/phone
        const comms: Array<Record<string, unknown>> = [];
        if (email) {
          comms.push({ type: { name: "Email" }, value: email, communicationType: "Email" });
        }
        if (phone) {
          comms.push({ type: { name: "Direct" }, value: phone, communicationType: "Phone" });
        }
        if (comms.length) body.communicationItems = comms;

        const result = await client.post<Record<string, unknown>>("/company/contacts", body);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_create_contact", err, {
          hint: "Verify companyId with cw_search_companies first.",
        });
      }
    },
  );
}
