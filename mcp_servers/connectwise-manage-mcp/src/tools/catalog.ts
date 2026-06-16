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

/**
 * Product Catalog tools (ConnectWise Procurement API).
 *
 * Covers the Product Catalog itself (/procurement/catalog) plus the lookup
 * entities typically needed when creating or filtering catalog items:
 * categories, subcategories, and manufacturers.
 */

const catalogItemSummary: SummaryFn = (item) => ({
  id: item["id"],
  identifier: item["identifier"],
  description: item["description"],
  category: (item["category"] as Record<string, unknown> | undefined)?.name,
  subcategory: (item["subcategory"] as Record<string, unknown> | undefined)?.name,
  manufacturer: (item["manufacturer"] as Record<string, unknown> | undefined)?.name,
  productClass: item["productClass"],
  cost: item["cost"],
  price: item["price"],
  taxableFlag: item["taxableFlag"],
});

const lookupSummary: SummaryFn = (item) => ({
  id: item["id"],
  name: item["name"],
});

export function registerCatalogTools(server: McpServer, client: CwManageClient) {
  // -------------------------------------------------------------------------
  // Catalog items
  // -------------------------------------------------------------------------

  server.tool(
    "cw_search_catalog_items",
    "Search the ConnectWise product catalog. Returns a compact summary (id, identifier, description, category, manufacturer, price) by default — pass full=true or fields=[...] for more. Use 'conditions' for CW query syntax (e.g. \"identifier like '%SKU-%'\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by (e.g. 'identifier asc')"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: search catalog items", READ),
    async ({ conditions, page, pageSize, orderBy, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/procurement/catalog", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
          orderBy,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], catalogItemSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_search_catalog_items", err);
      }
    },
  );

  server.tool(
    "cw_get_catalog_item",
    "Get a specific catalog item by ID. Returns a compact summary by default; pass full=true or fields=[...] for the complete vendor object.",
    {
      id: z.number().describe("Catalog item ID"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: get catalog item", READ),
    async ({ id, fields, full }) => {
      try {
        const result = await client.get<Record<string, unknown>>(`/procurement/catalog/${id}`);
        return shapeItem(result, catalogItemSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_get_catalog_item", err, {
          hint: "Verify catalog item id with cw_search_catalog_items first.",
        });
      }
    },
  );

  server.tool(
    "cw_create_catalog_item",
    "Create a new catalog item (product SKU) in ConnectWise. Surfaces the common MSP fields directly; use 'extraFields' for anything else supported by POST /procurement/catalog.",
    {
      identifier: z.string().describe("Unique catalog item identifier / SKU"),
      description: z.string().describe("Product description"),
      subcategoryId: z.number().describe("Catalog subcategory ID (required by CW)"),
      typeId: z.number().describe("Product type ID (required by CW)"),
      cost: z.number().optional().describe("Cost to you"),
      price: z.number().optional().describe("Sale price"),
      categoryId: z.number().optional().describe("Catalog category ID"),
      manufacturerId: z.number().optional().describe("Manufacturer ID"),
      productClass: z
        .enum(["NonInventory", "Inventory", "Bundle", "Service", "Agreement"])
        .optional()
        .describe("Product class"),
      taxableFlag: z.boolean().optional().describe("Whether the item is taxable"),
      customerDescription: z.string().optional().describe("Customer-facing description"),
      extraFields: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Passthrough for any additional catalog item fields supported by the CW API (merged into the request body).",
        ),
    },
    titled("CW Manage: create catalog item", WRITE_CREATE),
    async ({
      identifier,
      description,
      subcategoryId,
      typeId,
      cost,
      price,
      categoryId,
      manufacturerId,
      productClass,
      taxableFlag,
      customerDescription,
      extraFields,
    }) => {
      try {
        const body: Record<string, unknown> = {
          identifier,
          description,
          subcategory: { id: subcategoryId },
          type: { id: typeId },
        };
        if (cost !== undefined) body.cost = cost;
        if (price !== undefined) body.price = price;
        if (categoryId !== undefined) body.category = { id: categoryId };
        if (manufacturerId !== undefined) body.manufacturer = { id: manufacturerId };
        if (productClass) body.productClass = productClass;
        if (taxableFlag !== undefined) body.taxableFlag = taxableFlag;
        if (customerDescription) body.customerDescription = customerDescription;
        if (extraFields) Object.assign(body, extraFields);
        const result = await client.post<Record<string, unknown>>("/procurement/catalog", body);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_create_catalog_item", err);
      }
    },
  );

  server.tool(
    "cw_update_catalog_item",
    "Update an existing catalog item using JSON Patch operations.",
    {
      id: z.number().describe("Catalog item ID"),
      operations: z
        .array(
          z.object({
            op: z.enum(["replace", "add", "remove"]).describe("Patch operation"),
            path: z.string().describe("JSON path (e.g. 'price', 'cost', 'description')"),
            value: z.unknown().optional().describe("New value"),
          }),
        )
        .describe("Array of JSON Patch operations"),
    },
    titled("CW Manage: update catalog item", WRITE_UPDATE),
    async ({ id, operations }) => {
      try {
        const result = await client.patch<Record<string, unknown>>(`/procurement/catalog/${id}`, operations);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("cw_update_catalog_item", err, {
          hint: "Verify catalog item id with cw_search_catalog_items first.",
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Supporting lookup entities
  // -------------------------------------------------------------------------

  server.tool(
    "cw_list_catalog_categories",
    "List product categories from the ConnectWise catalog. Returns id and name by default.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: list catalog categories", READ),
    async ({ conditions, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/procurement/categories", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], lookupSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_list_catalog_categories", err);
      }
    },
  );

  server.tool(
    "cw_list_catalog_subcategories",
    "List product subcategories from the ConnectWise catalog. Returns id and name by default.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string (e.g. \"category/id=3\")"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: list catalog subcategories", READ),
    async ({ conditions, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/procurement/subcategories", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], lookupSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_list_catalog_subcategories", err);
      }
    },
  );

  server.tool(
    "cw_list_manufacturers",
    "List manufacturers referenced by catalog items. Returns id and name by default.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25)"),
      fields: z.array(z.string()).optional().describe('Optional. Return only these fields (e.g. ["id","status","summary"]). Overrides the default compact summary.'),
      full: z.boolean().optional().describe('Optional. When true, return the complete vendor object. Use only when you need fields not in the default summary.'),
    },
    titled("CW Manage: list manufacturers", READ),
    async ({ conditions, page, pageSize, fields, full }) => {
      try {
        const result = await client.get<unknown[]>("/procurement/manufacturers", {
          conditions,
          page: page ?? 1,
          pageSize: pageSize ?? 25,
        });
        const items = Array.isArray(result) ? result : [];
        return shapeList(items as Record<string, unknown>[], lookupSummary, { fields, full });
      } catch (err) {
        return toolErrorFromCatch("cw_list_manufacturers", err);
      }
    },
  );
}
