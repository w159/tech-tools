import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

interface MaybeAuvikError {
  status?: number;
  statusCode?: number;
  message?: string;
  retryAfter?: number;
  response?: unknown;
  body?: unknown;
}

export function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) return error;

  const e = error as MaybeAuvikError;
  // node-auvik surfaces statusCode (not status) and vendor detail on response (not body).
  // Accept both field names so the mapper works against the real AuvikError class and
  // any generic HTTP error shape that uses the older field names.
  const status = typeof e?.statusCode === 'number' ? e.statusCode : (typeof e?.status === 'number' ? e.status : 0);
  const vendorDetail = e?.response ?? e?.body;
  const msg = e?.message || (typeof error === 'string' ? error : 'Unknown error');

  const detail = vendorDetail !== undefined ? ` | vendor: ${JSON.stringify(vendorDetail)}` : '';

  switch (status) {
    case 400:
      return new McpError(ErrorCode.InvalidParams, `Auvik 400 bad request: ${msg}${detail}`);
    case 401:
      return new McpError(ErrorCode.InvalidRequest, `Auvik 401 — invalid credentials (check AUVIK_USERNAME / AUVIK_API_KEY)${detail}`);
    case 403:
      return new McpError(ErrorCode.InvalidRequest, `Auvik 403 — credentials valid but role lacks API access${detail}`);
    case 404:
      return new McpError(ErrorCode.InvalidRequest, `Auvik 404 — resource or endpoint not found: ${msg}${detail}`);
    case 429: {
      const retry = e?.retryAfter ? ` (retry after ${e.retryAfter}s)` : '';
      return new McpError(ErrorCode.InternalError, `Auvik 429 — rate limit (2500 req / 5min) exceeded${retry}${detail}`);
    }
    case 500:
    case 502:
    case 503:
    case 504:
      return new McpError(ErrorCode.InternalError, `Auvik ${status} — upstream service error: ${msg}${detail}`);
    default:
      return new McpError(ErrorCode.InternalError, `${msg}${detail}`);
  }
}
