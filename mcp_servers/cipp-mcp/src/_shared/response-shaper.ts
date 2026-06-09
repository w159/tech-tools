/**
 * response-shaper.ts — shared response quality helpers for MCP tool handlers.
 *
 * Every list/search tool in this repo currently returns
 * `JSON.stringify(fullApiResponse, null, 2)`, which can easily exceed 100 KB
 * for large result sets and forces agents to parse an unfiltered vendor blob.
 *
 * This module provides three helpers a domain handler imports and calls instead
 * of bare `JSON.stringify`:
 *
 *   - `shapeList`   — turn an array of vendor objects into a compact tool result,
 *                     with optional field selection and a hard character cap.
 *   - `shapeItem`   — same for a single-item GET result.
 *   - `shapeRaw`    — minimal wrapper when no summary mapping is needed; still
 *                     enforces the hard cap and appends a truncation notice.
 *
 * Agents can request richer output by passing `fields` (string[]) or `full`
 * (boolean) in the tool args; both are opt-in and handled here transparently.
 *
 * Import path (after tsconfig widening — see ADOPTION.md):
 *   import { shapeList, shapeItem, shapeRaw } from "../../_shared/response-shaper.js";
 *
 * For tsc servers one directory deeper (e.g. cipp src/mcp/):
 *   import { shapeList, shapeItem, shapeRaw } from "../../../_shared/response-shaper.js";
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Subset of the MCP SDK's CallToolResult used by every server in this repo.
 * Defined inline so this file has zero runtime imports.
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Args subset that any tool handler can pass through from its raw `args` map.
 * Both fields are opt-in; omitting them uses the default compact summary mode.
 */
export interface ShapeArgs {
  /** Array of dot-notation field paths to include (e.g. ["id","name","status"]). */
  fields?: string[];
  /** When true, return the full un-filtered vendor object. Overrides `fields`. */
  full?: boolean;
}

/**
 * Per-item summary function: given a vendor object, return the subset of
 * fields that are useful in a compact list result. The caller defines this
 * once per tool and passes it to `shapeList` / `shapeItem`.
 *
 * Return `null` to skip an item entirely (e.g. filter out deleted records).
 */
export type SummaryFn<T = Record<string, unknown>> = (
  item: T
) => Record<string, unknown> | null;

// ---------------------------------------------------------------------------
// Constants — callers may import these to document their tool's input schema.
// ---------------------------------------------------------------------------

/**
 * Default maximum response size in characters. Responses larger than this are
 * truncated to the last complete JSON item before the limit, and a notice is
 * appended telling the agent how to page or narrow the query.
 */
export const DEFAULT_CHAR_CAP = 40_000;

/**
 * Compact JSON separator used when shaping lists (no indent, one item per
 * line). Keeps responses readable without the overhead of pretty-printing.
 */
const COMPACT_SEPARATOR = "\n";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Pick a subset of `obj` using an array of dot-notation paths.
 * Shallow paths ("id", "name") are handled directly; nested paths
 * ("contact.email") are resolved one level deep.
 * Unknown paths are silently omitted.
 */
function pickFields(
  obj: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of fields) {
    const dot = path.indexOf(".");
    if (dot === -1) {
      if (path in obj) result[path] = obj[path];
    } else {
      const head = path.slice(0, dot);
      const tail = path.slice(dot + 1);
      const parent = obj[head];
      if (parent !== null && typeof parent === "object") {
        const nested = pickFields(
          parent as Record<string, unknown>,
          [tail]
        );
        if (Object.keys(nested).length > 0) {
          result[head] = { ...(result[head] as Record<string, unknown> ?? {}), ...nested };
        }
      }
    }
  }
  return result;
}

/**
 * Collect every primitive-valued key from `obj` up to `maxKeys` entries.
 * Used as a last-resort fallback when a summaryFn produces zero defined keys,
 * so agents never receive a bare `{}` in a list result.
 *
 * Only primitive values (string, number, boolean, null) are included because
 * objects and arrays are rarely useful in a compact summary context.
 */
function primitiveFields(
  obj: Record<string, unknown>,
  maxKeys = 8
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (count >= maxKeys) break;
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      result[k] = v;
      count++;
    }
  }
  return result;
}

/**
 * Strip undefined values from a summary object.
 * A summaryFn that references a field that does not exist on the item
 * returns `undefined` for that key; JSON.stringify omits those already,
 * but this makes the intent explicit and allows the zero-defined-keys
 * fallback check to work correctly.
 */
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

/**
 * Resolve the per-item representation given caller-supplied args.
 * Priority: full > fields > summaryFn.
 *
 * Safeguards applied when using summaryFn:
 *   (a) undefined keys are stripped from the summary so agents never receive
 *       keys whose values are undefined.
 *   (b) if the stripped summary has zero keys (all references were to fields
 *       that do not exist on this item), fall back to an automatic summary of
 *       up to 8 primitive-valued fields from the raw item so agents always
 *       receive actionable data rather than {}.
 */
function resolveItem<T extends Record<string, unknown>>(
  item: T,
  summaryFn: SummaryFn<T> | undefined,
  args: ShapeArgs
): Record<string, unknown> | null {
  if (args.full) return item;
  if (args.fields && args.fields.length > 0) return pickFields(item, args.fields);
  if (summaryFn) {
    const raw = summaryFn(item);
    if (raw === null) return null;
    const cleaned = stripUndefined(raw);
    if (Object.keys(cleaned).length === 0) {
      // summaryFn referenced fields that do not exist — fall back to primitives
      return primitiveFields(item);
    }
    return cleaned;
  }
  return item;
}

/**
 * Enforce the character cap on a rendered string.
 * Returns the (possibly truncated) string plus a notice line when truncated.
 * The notice tells the agent what to do next so it is not left without a path
 * forward: use pagination, add filters, or pass `full: false` with `fields`.
 */
function enforceCharCap(
  text: string,
  cap: number,
  paginationHint?: string
): string {
  if (text.length <= cap) return text;

  // Walk back from `cap` to the last newline so we don't split a JSON object.
  let cutAt = cap;
  while (cutAt > 0 && text[cutAt] !== "\n") cutAt--;
  const truncated = cutAt > 0 ? text.slice(0, cutAt) : text.slice(0, cap);

  const hint = paginationHint
    ? ` ${paginationHint}`
    : " Use cursor/page params to fetch the next page, or add filters to narrow results.";

  return (
    truncated +
    `\n\n[TRUNCATED: response exceeded ${cap} chars.${hint}]`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Shape an array of vendor objects into a ToolResult for a list or search tool.
 *
 * Usage:
 * ```ts
 * const summaryFn: SummaryFn = (item) => ({
 *   id: item.id,
 *   name: item.name,
 *   status: item.status,
 * });
 * return shapeList(response.items, summaryFn, args);
 * ```
 *
 * @param items       Raw array from the vendor API.
 * @param summaryFn   Caller-supplied function that extracts essential fields.
 *                    Pass `undefined` to return items as-is (same as `full`).
 * @param args        Tool call args forwarded from the handler (fields / full).
 * @param charCap     Hard character limit; defaults to DEFAULT_CHAR_CAP.
 * @param paginationHint  Optional sentence appended to the truncation notice
 *                    (e.g. "Pass cursor='abc123' to continue.").
 */
export function shapeList<T extends Record<string, unknown>>(
  items: T[],
  summaryFn: SummaryFn<T> | undefined,
  args: ShapeArgs = {},
  charCap = DEFAULT_CHAR_CAP,
  paginationHint?: string
): ToolResult {
  const resolved: Record<string, unknown>[] = [];
  for (const item of items) {
    const shaped = resolveItem(item, summaryFn, args);
    if (shaped !== null) resolved.push(shaped);
  }

  const lines = resolved.map((r) => JSON.stringify(r));
  const raw = `[${COMPACT_SEPARATOR}${lines.join("," + COMPACT_SEPARATOR)}${COMPACT_SEPARATOR}]`;
  const text = enforceCharCap(raw, charCap, paginationHint);

  return { content: [{ type: "text", text }] };
}

/**
 * Shape a single vendor object into a ToolResult for a get/detail tool.
 *
 * Usage:
 * ```ts
 * const summaryFn: SummaryFn = (item) => ({
 *   id: item.id, subject: item.subject, status: item.status,
 * });
 * return shapeItem(ticket, summaryFn, args);
 * ```
 *
 * @param item        Raw object from the vendor API.
 * @param summaryFn   Caller-supplied function; `undefined` passes the item through.
 * @param args        Tool call args (fields / full).
 * @param charCap     Hard character limit; defaults to DEFAULT_CHAR_CAP.
 */
export function shapeItem<T extends Record<string, unknown>>(
  item: T,
  summaryFn: SummaryFn<T> | undefined,
  args: ShapeArgs = {},
  charCap = DEFAULT_CHAR_CAP
): ToolResult {
  const shaped = resolveItem(item, summaryFn, args) ?? item;
  const raw = JSON.stringify(shaped, null, 2);
  const text = enforceCharCap(raw, charCap);
  return { content: [{ type: "text", text }] };
}

/**
 * Minimal shaping for responses that are already an opaque object or string
 * (e.g. status checks, create confirmations). Still enforces the char cap.
 *
 * @param data     Any serialisable value.
 * @param charCap  Hard character limit; defaults to DEFAULT_CHAR_CAP.
 */
export function shapeRaw(
  data: unknown,
  charCap = DEFAULT_CHAR_CAP
): ToolResult {
  const raw = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const text = enforceCharCap(raw, charCap);
  return { content: [{ type: "text", text }] };
}

/**
 * Extract ShapeArgs from a generic tool args map.
 * Domain handlers call this once at the top of their handler case:
 *
 * ```ts
 * const shapeArgs = extractShapeArgs(args);
 * return shapeList(response.items, summaryFn, shapeArgs);
 * ```
 */
export function extractShapeArgs(args: Record<string, unknown>): ShapeArgs {
  const fields =
    Array.isArray(args.fields) && args.fields.every((f) => typeof f === "string")
      ? (args.fields as string[])
      : undefined;
  const full = args.full === true;
  return { fields, full };
}

/**
 * Standard input schema properties that list tools should add to their
 * `inputSchema.properties` to expose the opt-in shaping controls to agents.
 *
 * Use this with servers that build tools via the plain MCP `Tool` type and a
 * JSON-schema `inputSchema` object (tsup-based servers such as vanta, paylocity,
 * auvik, blumira, kaseya-spanning, threatlocker).
 *
 * Usage:
 * ```ts
 * inputSchema: {
 *   type: "object",
 *   properties: {
 *     ...SHAPE_PROPS,
 *     status: { type: "string", description: "..." },
 *   },
 * }
 * ```
 *
 * For Zod-based servers (those using `server.tool(name, zodSchema, handler)`)
 * use `makeShapeZodFields(z)` instead — see below.
 */
export const SHAPE_PROPS = {
  fields: {
    type: "array",
    items: { type: "string" },
    description:
      'Optional. Array of field names to include in the response (e.g. ["id","name","status"]). Overrides the default compact summary. Use to retrieve specific fields without requesting the full object.',
  },
  full: {
    type: "boolean",
    description:
      "Optional. When true, return the complete vendor object without field filtering. Use only when you need fields not present in the default summary.",
  },
} as const;

// ---------------------------------------------------------------------------
// Zod-compatible variant
// ---------------------------------------------------------------------------

/**
 * Minimal structural type that covers the subset of the Zod API this factory
 * needs.  Written as a structural interface so _shared gains no runtime
 * dependency on any particular version of zod.
 *
 * `z` in the caller is the real Zod namespace; TypeScript will verify that the
 * object passed in satisfies this shape at the call site.
 */
interface ZodLike {
  array: (inner: { optional(): unknown; describe(s: string): unknown }) => {
    optional(): unknown;
    describe(s: string): unknown;
  };
  string: () => { optional(): unknown; describe(s: string): unknown };
  boolean: () => { optional(): unknown; describe(s: string): unknown };
}

/**
 * Returns Zod field entries for the two opt-in shaping controls (`fields` and
 * `full`) with the same descriptions as `SHAPE_PROPS`.
 *
 * Use this in servers that register tools via `server.tool(name, zodSchema,
 * handler)` where `zodSchema` is a `z.object({...})` shape — e.g. ConnectWise
 * Manage.  Spreading plain `SHAPE_PROPS` into a `ZodRawShape` produces TS2345
 * because the values are plain objects, not Zod schemas.
 *
 * Because _shared has no zod dependency, the caller must pass their own `z`
 * instance.  TypeScript verifies it satisfies the structural interface above
 * at the call site, so no version coupling is introduced.
 *
 * Usage:
 * ```ts
 * import { z } from "zod";
 * import { makeShapeZodFields } from "../../_shared/response-shaper.js";
 *
 * server.tool(
 *   "my_list",
 *   z.object({
 *     status: z.string().optional().describe("Filter by status."),
 *     ...makeShapeZodFields(z),
 *   }),
 *   async ({ status, fields, full }) => { ... }
 * );
 * ```
 *
 * @param z  The caller's Zod namespace (`import { z } from "zod"`).
 * @returns  A plain object with `fields` and `full` Zod schema entries ready
 *           to spread into a `z.object({...})` shape.
 */
export function makeShapeZodFields(z: ZodLike): {
  fields: ReturnType<ZodLike["array"]>;
  full: ReturnType<ZodLike["boolean"]>;
} {
  return {
    // @ts-ignore — intentional ZodLike structural cast; z.string() satisfies the array element type at runtime
    fields: z
      .array(z.string() as Parameters<ZodLike["array"]>[0])
      .optional()
      .describe(
        'Optional. Array of field names to include in the response (e.g. ["id","name","status"]). Overrides the default compact summary. Use to retrieve specific fields without requesting the full object.'
      ) as ReturnType<ZodLike["array"]>,
    // @ts-ignore — intentional ZodLike structural cast; z.boolean() satisfies the return type at runtime
    full: z
      .boolean()
      .optional()
      .describe(
        "Optional. When true, return the complete vendor object without field filtering. Use only when you need fields not present in the default summary."
      ) as ReturnType<ZodLike["boolean"]>,
  };
}
