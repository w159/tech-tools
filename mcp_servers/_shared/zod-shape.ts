/**
 * zod-shape.ts
 *
 * Turn a tool's JSON-schema `inputSchema` into the zod raw shape that
 * `McpServer.registerTool` expects, so every connector keeps one source of
 * truth for its tool schemas (the JSON the navigate tools also read) while
 * gaining SDK-side argument validation.
 *
 * `z` is passed in rather than imported: _shared has no node_modules, and a
 * runtime import here would resolve from this directory at bundle time.
 * Callers pass their own `import { z } from "zod"`.
 *
 * Covers the flat vocabulary the connectors use: string, number/integer,
 * boolean, array (with items), string/number enums, typeless properties,
 * description, required vs optional. Anything else throws at startup, so a
 * new schema feature can never silently drop validation.
 */

import type { z as ZodNamespace, ZodType } from "zod";

// Type-only: each consumer's tsconfig maps "zod" to its own node_modules.
type Zod = typeof ZodNamespace;
type ZodSchema = ZodType;

interface JsonProp {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonProp;
  properties?: Record<string, unknown>;
}

export interface JsonObjectSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

function enumToZod(z: Zod, name: string, values: unknown[]): ZodSchema {
  if (values.length === 0) throw new Error(`Empty enum for property "${name}"`);
  if (values.every((v) => typeof v === "string")) return z.enum(values as [string, ...string[]]);
  const literals = values.map((v) => z.literal(v as string | number | boolean));
  return literals.length === 1 ? literals[0] : z.union(literals as unknown as [ZodSchema, ZodSchema]);
}

// Scalar JSON-schema types with a direct zod equivalent.
const SCALARS: Record<string, (z: Zod) => ZodSchema> = {
  string: (z) => z.string(),
  integer: (z) => z.number().int(),
  number: (z) => z.number(),
  boolean: (z) => z.boolean(),
};

function typeToZod(z: Zod, name: string, prop: JsonProp): ZodSchema {
  const scalar = prop.type !== undefined ? SCALARS[prop.type] : undefined;
  if (scalar) return scalar(z);
  if (prop.type === "array" && prop.items) return z.array(propToZod(z, `${name}[]`, prop.items));
  // Free-form object body (e.g. a vendor config payload): require an object,
  // leave its keys to the vendor API.
  if (prop.type === "object" && prop.properties === undefined) return z.record(z.string(), z.unknown());
  if (prop.type === undefined) return z.unknown();
  throw new Error(`Unsupported JSON schema for property "${name}": ${JSON.stringify(prop)}`);
}

function propToZod(z: Zod, name: string, prop: JsonProp): ZodSchema {
  const schema = prop.enum ? enumToZod(z, name, prop.enum) : typeToZod(z, name, prop);
  return prop.description ? schema.describe(prop.description) : schema;
}

/** Zod raw shape for McpServer.registerTool, derived from a JSON inputSchema. */
export function toZodShape(z: Zod, inputSchema: JsonObjectSchema): Record<string, ZodSchema> {
  const required = new Set(inputSchema.required ?? []);
  const shape: Record<string, ZodSchema> = {};
  for (const [name, prop] of Object.entries(inputSchema.properties ?? {})) {
    const field = propToZod(z, name, prop as JsonProp);
    shape[name] = required.has(name) ? field : field.optional();
  }
  return shape;
}
