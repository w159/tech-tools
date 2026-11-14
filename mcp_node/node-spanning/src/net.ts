/**
 * resilientFetch: fetch with a per-attempt timeout, clear network errors and a
 * small bounded retry policy.
 *
 * Why: bare `fetch` has no deadline (a vendor that accepts the TCP connection
 * and never answers hangs the tool call), and its refusal surfaces as the
 * unhelpful `TypeError: fetch failed`. Connectors that retried network errors
 * did so blindly, with exponential backoff, for every method.
 *
 * Policy:
 *  - every attempt is cut off after `timeoutMs` (default 20 s, env
 *    MCP_HTTP_TIMEOUT_MS overrides); a timeout is never retried
 *  - network failures throw NetworkError ("cannot reach host:port: connection
 *    refused (ECONNREFUSED)"); the message carries the host only, never the
 *    path, query string or credentials
 *  - retries only for idempotent requests (GET, HEAD, OPTIONS, PUT, DELETE, or
 *    `idempotent: true`), only for 429 / 500 / 502 / 503 / 504 and for
 *    ECONNRESET / EPIPE / UND_ERR_SOCKET; at most `maxRetries` (default 2)
 *  - Retry-After (seconds or HTTP date) is honored up to `maxRetryAfterMs`
 *    (default 10 s); a longer wait is not taken, the response is returned as is
 *
 * Dependency-free on purpose: mcp_node/node-* libraries carry a byte-identical
 * copy at src/net.ts (a test in __tests__/resilient-fetch.test.ts enforces it).
 */

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_RETRY_AFTER_MS = 10_000;
const BASE_DELAY_MS = 250;
const MAX_BACKOFF_MS = 2_000;

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_NET_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);

export interface ResilientFetchOptions {
  /** Per-attempt deadline in ms. Default 20000, or MCP_HTTP_TIMEOUT_MS when set. */
  timeoutMs?: number;
  /** Extra attempts after the first. Default 2. 0 disables retries. */
  maxRetries?: number;
  /** Treat the request as safe to repeat regardless of method (reads sent as POST). */
  idempotent?: boolean;
  /** Longest Retry-After wait that is honored. Default 10000. */
  maxRetryAfterMs?: number;
  /** Test seams. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class NetworkError extends Error {
  readonly isNetworkError = true;
  readonly code: string;
  readonly host: string;
  readonly timedOut: boolean;
  constructor(message: string, code: string, host: string, timedOut: boolean, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) Object.defineProperty(this, "cause", { value: options.cause, writable: true, configurable: true });
    this.name = "NetworkError";
    this.code = code;
    this.host = host;
    this.timedOut = timedOut;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function resolveTimeoutMs(explicit?: number): number {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const fromEnv = Number(process.env.MCP_HTTP_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_TIMEOUT_MS;
}

function hostOf(input: string | URL | Request): string {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw).host || "the server";
  } catch {
    return "the server";
  }
}

function causeCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    // AggregateError (happy-eyeballs dual-stack failure) keeps codes on .errors
    const errors = (cur as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      for (const e of errors) {
        const c = (e as { code?: unknown } | null)?.code;
        if (typeof c === "string" && c) return c;
      }
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

const REASONS: Record<string, string> = {
  ECONNREFUSED: "connection refused",
  ENOTFOUND: "host name not found",
  EAI_AGAIN: "DNS lookup failed",
  ECONNRESET: "connection reset by peer",
  EPIPE: "connection closed by peer",
  UND_ERR_SOCKET: "connection closed by peer",
  ETIMEDOUT: "connection timed out",
  UND_ERR_CONNECT_TIMEOUT: "connection timed out",
  EHOSTUNREACH: "host unreachable",
  ENETUNREACH: "network unreachable",
};

function isTlsCode(code: string): boolean {
  return /CERT|SELF_SIGNED|UNABLE_TO_(VERIFY|GET)|ERR_TLS|ERR_SSL|HOSTNAME_MISMATCH/.test(code);
}

/** Turn whatever fetch threw into a NetworkError that names the host and the reason. */
export function toNetworkError(err: unknown, input: string | URL | Request, timeoutMs: number): NetworkError {
  if (err instanceof NetworkError) return err;
  const host = hostOf(input);
  const name = (err as { name?: string } | null)?.name;
  if (name === "TimeoutError" || (name === "AbortError" && !causeCode(err))) {
    return new NetworkError(
      `request to ${host} timed out after ${timeoutMs}ms (ETIMEDOUT)`,
      "ETIMEDOUT", host, true, { cause: err },
    );
  }
  const code = causeCode(err);
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") {
    return new NetworkError(
      `request to ${host} timed out waiting for a response (ETIMEDOUT)`,
      "ETIMEDOUT", host, true, { cause: err },
    );
  }
  if (code) {
    const reason = REASONS[code] ?? (isTlsCode(code) ? "TLS certificate not trusted or invalid" : "network error");
    return new NetworkError(`cannot reach ${host}: ${reason} (${code})`, code, host, false, { cause: err });
  }
  const causeMessage = String((err as { cause?: { message?: unknown } } | null)?.cause?.message ?? "");
  if (/bad port/i.test(causeMessage)) {
    // fetch refuses a fixed list of ports (9, 25, 6000, ...) before opening a socket
    return new NetworkError(`cannot reach ${host}: port is blocked by fetch (bad port)`, "BAD_PORT", host, false, { cause: err });
  }
  const detail = err instanceof Error && err.message && err.message !== "fetch failed" ? err.message.slice(0, 120) : "fetch failed";
  return new NetworkError(`cannot reach ${host}: network error (${detail})`, "FETCH_FAILED", host, false, { cause: err });
}

/** Retry-After as milliseconds (seconds or HTTP date), or undefined when absent or unusable. */
export function parseRetryAfterMs(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function isIdempotent(init: RequestInit | undefined, opts: ResilientFetchOptions): boolean {
  return opts.idempotent === true || IDEMPOTENT_METHODS.has((init?.method ?? "GET").toUpperCase());
}

function backoffMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_BACKOFF_MS) + Math.floor(Math.random() * 100);
}

function withDeadline(init: RequestInit | undefined, timeoutMs: number): RequestInit {
  const deadline = AbortSignal.timeout(timeoutMs);
  const caller = init?.signal;
  const signal = caller ? AbortSignal.any([caller, deadline]) : deadline;
  return { ...init, signal };
}

export async function resilientFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
  opts: ResilientFetchOptions = {},
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = resolveTimeoutMs(opts.timeoutMs);
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
  const canRetry = isIdempotent(init, opts);

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(input, withDeadline(init, timeoutMs));
    } catch (err) {
      if (init?.signal?.aborted) throw err; // the caller cancelled; not a network fault
      const netErr = toNetworkError(err, input, timeoutMs);
      if (canRetry && !netErr.timedOut && RETRYABLE_NET_CODES.has(netErr.code) && attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw netErr;
    }

    if (!canRetry || !RETRYABLE_STATUS.has(res.status) || attempt >= maxRetries) return res;

    const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
    if (retryAfter !== undefined && retryAfter > maxRetryAfterMs) return res; // too long to wait here
    await res.body?.cancel().catch(() => undefined);
    await sleep(retryAfter ?? backoffMs(attempt));
  }
}
