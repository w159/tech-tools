// Argument parsing and dispatch helpers shared by the domain handlers, so each
// handleCall is a name -> function map instead of a per-tool if-chain.
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import {
  extractShapeArgs, toolError, toolErrorFromCatch, toPortalDate,
  type ShapeArgs,
} from './_helpers.js';

export const STATUS_HINT = 'Call threatlocker_status to confirm the key and instance letter.';
export const OS_TYPE_HINT = 'Use all, windows, mac, linux, or "windows xp".';

/** Thrown while parsing tool arguments; surfaces as an INVALID_ARGS tool error. */
export class InvalidArgsError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = 'InvalidArgsError';
  }
}

export type ParsedArgs<T> = { params: T; error?: undefined } | { params?: undefined; error: CallToolResult };

/** Run an argument builder; an InvalidArgsError becomes the tool result. */
export function parseArgs<T>(build: () => T): ParsedArgs<T> {
  try {
    return { params: build() };
  } catch (err) {
    if (err instanceof InvalidArgsError) {
      return { error: toolError('INVALID_ARGS', err.message, err.hint ? { hint: err.hint } : undefined) };
    }
    throw err;
  }
}

/** Case-insensitive name -> id lookup; undefined when the arg is absent or blank. */
export function namedId(args: Record<string, unknown>, key: string, table: Record<string, number>, hint: string): number | undefined {
  const name = typeof args[key] === 'string' ? (args[key] as string).trim().toLowerCase() : '';
  if (!name) return undefined;
  const id = table[name];
  if (id === undefined) throw new InvalidArgsError(`Unknown ${key} "${args[key]}".`, hint);
  return id;
}

/** String arg that must be one of `allowed` (exact match); undefined when absent. */
export function oneOf(args: Record<string, unknown>, key: string, allowed: readonly string[]): string | undefined {
  const value = typeof args[key] === 'string' ? (args[key] as string) : undefined;
  if (value && !allowed.includes(value)) {
    throw new InvalidArgsError(`Unknown ${key} "${value}".`, `Use one of: ${allowed.join(', ')}.`);
  }
  return value;
}

/** Enum id -> label, falling back to the raw value (or `otherwise` when not a number). */
export function label(table: Record<number, string>, value: unknown, otherwise?: unknown): unknown {
  return typeof value === 'number' ? (table[value] ?? value) : otherwise;
}

/** Fetch the client, run the call, and map any failure to the standard tool error. */
export async function callApi(
  toolName: string,
  hint: string,
  run: (client: any) => Promise<CallToolResult>,
  mapError?: (err: unknown) => CallToolResult | undefined,
): Promise<CallToolResult> {
  try {
    return await run(await getClient());
  } catch (err) {
    return mapError?.(err) ?? toolErrorFromCatch(toolName, err, { hint });
  }
}

export type ToolFn = (toolName: string, args: Record<string, unknown>, shapeArgs: ShapeArgs) => Promise<CallToolResult>;

export async function dispatchTool(
  handlers: Record<string, ToolFn>,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);
  const handler = handlers[toolName];
  if (!handler || !Object.hasOwn(handlers, toolName)) {
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
  return handler(toolName, args, shapeArgs);
}

// ---------------------------------------------------------------------------
// Time window shared by the audit search tools
// ---------------------------------------------------------------------------

export const TIME_WINDOW_PROPS: NonNullable<Tool['inputSchema']['properties']> = {
  hours: { type: 'number', description: 'Look back this many hours from now (default 24). Ignored when startDate is given.' },
  startDate: { type: 'string', description: 'ISO 8601 start, UTC.' },
  endDate: { type: 'string', description: 'ISO 8601 end, UTC (default now).' },
};

export function timeWindow(args: Record<string, unknown>, now: Date = new Date()): { startDate: string; endDate: string } {
  const endDate = toPortalDate(typeof args.endDate === 'string' ? args.endDate : now);
  if (typeof args.startDate === 'string') return { startDate: toPortalDate(args.startDate), endDate };
  const hours = typeof args.hours === 'number' && args.hours > 0 ? args.hours : 24;
  return { startDate: toPortalDate(new Date(new Date(endDate).getTime() - hours * 3600_000)), endDate };
}

/** timeWindow that reports a bad date as INVALID_ARGS. */
export function parseTimeWindow(args: Record<string, unknown>): { startDate: string; endDate: string } {
  try {
    return timeWindow(args);
  } catch (err) {
    throw new InvalidArgsError((err as Error).message, 'Use ISO 8601, e.g. 2026-09-01T00:00:00Z.');
  }
}
