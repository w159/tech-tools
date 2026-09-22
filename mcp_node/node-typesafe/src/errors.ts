export type TypeSafeErrorCode =
  | 'MISSING_CREDENTIALS'
  | 'INVALID_ARGS'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'VENDOR_ERROR'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Thrown for every failure this client can produce: an unresolved provider,
 * a non-2xx HTTP response from either provider's endpoint, a network-level
 * failure, or a non-JSON response body. `code` is already in the same
 * UPPER_SNAKE_CASE vocabulary as mcp_servers/_shared/error-envelope.ts's
 * ErrorCode, so typesafe-mcp's tool handlers can pass it straight through.
 */
export class TypeSafeApiError extends Error {
  readonly code: TypeSafeErrorCode;
  readonly status: number;
  readonly body: string | undefined;
  readonly retryAfter: string | undefined;

  constructor(
    message: string,
    opts: { code: TypeSafeErrorCode; status: number; body?: string; retryAfter?: string }
  ) {
    super(message);
    this.name = 'TypeSafeApiError';
    this.code = opts.code;
    this.status = opts.status;
    this.body = opts.body;
    this.retryAfter = opts.retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
