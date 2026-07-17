/**
 * error-envelope.ts — consistent, actionable error results for MCP tool handlers.
 *
 * Every tool in this repo must surface errors that a downstream agent can act
 * on (see CLAUDE.md quality bar). Currently each server uses a different ad-hoc
 * pattern: some return bare strings, some mix isError with plain text, some
 * swallow vendor HTTP status entirely.
 *
 * This module provides a single `toolError` factory that produces a `ToolResult`
 * with `isError: true` and a structured text payload the agent can parse:
 *
 *   code     — machine-readable error class (MISSING_CREDENTIALS, NOT_FOUND, …)
 *   message  — human-readable summary
 *   detail   — optional: vendor HTTP status, response body excerpt, call context
 *   hint     — optional: remediation step (which env var, which endpoint to enable)
 *
 * Quick usage:
 *   return toolError("NOT_FOUND", "Ticket 1234 does not exist.", {
 *     hint: "Verify the ticket_id with ninjaone_tickets_list first.",
 *   });
 *
 * Import path (after tsconfig widening — see ADOPTION.md):
 *   import { toolError, toolErrorFromCatch } from "../../_shared/error-envelope.js";
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Subset of MCP CallToolResult used repo-wide (inline to avoid runtime import).
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Canonical error codes. Add new codes here as patterns emerge; keep them
 * UPPER_SNAKE_CASE so agents can match them reliably.
 */
export type ErrorCode =
  | "MISSING_CREDENTIALS"   // required env var not set
  | "INVALID_ARGS"          // caller supplied bad input
  | "NOT_FOUND"             // resource does not exist
  | "FORBIDDEN"             // authenticated but not authorized
  | "RATE_LIMITED"          // vendor returned 429
  | "VENDOR_ERROR"          // non-retryable vendor HTTP error (4xx/5xx)
  | "NETWORK_ERROR"         // connection-level failure
  | "INTERNAL_ERROR"        // unexpected error in the server itself
  | (string & Record<never, never>); // allow ad-hoc codes without losing autocomplete

/** Optional context attached to a toolError call. */
export interface ErrorContext {
  /**
   * Vendor HTTP status code, response body excerpt, or structured context
   * that helps the agent understand exactly what the vendor said.
   */
  detail?: string;
  /**
   * Remediation step an agent should take next. Be specific: name the env var
   * to set, the endpoint to call first, or the filter to add.
   * Example: "Set NINJAONE_CLIENT_ID and NINJAONE_CLIENT_SECRET in .env."
   */
  hint?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a ToolResult with `isError: true` and a structured text envelope.
 *
 * The text payload is a JSON object the agent can parse:
 * ```json
 * {
 *   "error": {
 *     "code": "NOT_FOUND",
 *     "message": "Ticket 1234 does not exist.",
 *     "hint": "Verify the ticket_id with ninjaone_tickets_list first."
 *   }
 * }
 * ```
 *
 * @param code     Canonical error code — use one of the ErrorCode values.
 * @param message  Human-readable summary of what went wrong.
 * @param ctx      Optional detail and hint for the agent.
 */
export function toolError(
  code: ErrorCode,
  message: string,
  ctx: ErrorContext = {}
): ToolResult {
  const envelope: Record<string, unknown> = { code, message };
  if (ctx.detail !== undefined) envelope.detail = ctx.detail;
  if (ctx.hint !== undefined) envelope.hint = ctx.hint;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: envelope }, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Build a ToolResult from a caught exception. Extracts useful context from
 * common error shapes (fetch Response-like objects, Error instances, etc.)
 * and maps HTTP status codes to canonical error codes.
 *
 * Usage:
 * ```ts
 * try {
 *   const result = await client.tickets.get(id);
 *   return shapeItem(result, summaryFn, args);
 * } catch (err) {
 *   return toolErrorFromCatch("tickets.get", err, {
 *     hint: "Verify the ticket_id with ninjaone_tickets_list first.",
 *   });
 * }
 * ```
 *
 * @param operation  Name of the operation that threw (used in the message).
 * @param err        The caught value — any shape is handled safely.
 * @param ctx        Optional additional detail and hint to merge in.
 */
export function toolErrorFromCatch(
  operation: string,
  err: unknown,
  ctx: ErrorContext = {}
): ToolResult {
  const { code, message, detail } = classifyError(operation, err);

  return toolError(code, message, {
    detail: ctx.detail ?? detail,
    hint: ctx.hint,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Classification {
  code: ErrorCode;
  message: string;
  detail?: string;
}

function classifyError(operation: string, err: unknown): Classification {
  // Error instance with a .status or .statusCode field
  // (.status: node-fetch / undici; .statusCode: node-threatlocker / node-vanta ServiceError)
  if (isStatusError(err)) {
    const e = err as Record<string, unknown>;
    const status = (typeof e.status === "number" ? e.status : e.statusCode) as number;
    return {
      code: httpStatusToCode(status),
      message: `${operation} failed: HTTP ${status}`,
      detail: extractBody(err),
    };
  }

  // Standard Error
  if (err instanceof Error) {
    const isNet =
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("ETIMEDOUT") ||
      err.message.includes("fetch failed");
    return {
      code: isNet ? "NETWORK_ERROR" : "INTERNAL_ERROR",
      message: `${operation} failed: ${err.message}`,
    };
  }

  // Unknown throw shape
  return {
    code: "INTERNAL_ERROR",
    message: `${operation} failed with an unknown error`,
    detail: String(err),
  };
}

function isStatusError(
  err: unknown
): err is { status?: unknown; statusCode?: unknown; message?: unknown; body?: unknown; response?: unknown } {
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  // Accept either .status (node-fetch/undici) or .statusCode (node-threatlocker/node-vanta ServiceError)
  return typeof e.status === "number" || typeof e.statusCode === "number";
}

function extractBody(err: {
  body?: unknown;
  response?: unknown;
  message?: unknown;
}): string | undefined {
  // Prefer .body (node-fetch / undici shape); fall back to .response (ServiceError shape)
  const payload = err.body !== undefined ? err.body : err.response;
  if (typeof payload === "string") return payload.slice(0, 500);
  if (payload !== undefined && payload !== null) {
    try {
      return JSON.stringify(payload).slice(0, 500);
    } catch {
      // ignore
    }
  }
  if (typeof err.message === "string") return err.message;
  return undefined;
}

function httpStatusToCode(status: number): ErrorCode {
  if (status === 401 || status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 400 && status < 500) return "INVALID_ARGS";
  return "VENDOR_ERROR";
}

/**
 * Convenience: build a MISSING_CREDENTIALS error with a standard hint.
 * Use in the `<vendor>_status` tool when credentials are absent.
 *
 * @param vendorName  Display name of the vendor (e.g. "NinjaOne").
 * @param envVars     Names of the required environment variables.
 */
export function missingCredsError(
  vendorName: string,
  envVars: string[]
): ToolResult {
  return toolError(
    "MISSING_CREDENTIALS",
    `${vendorName} credentials are not configured.`,
    {
      hint: `Set the following environment variables: ${envVars.join(", ")}.`,
    }
  );
}
