import { createHmac, randomBytes, randomUUID } from "node:crypto";

export const AUDIT_SCHEMA = "mcp-gw.audit/1";

export type AuditEventName = "auth_failed" | "token_issued" | "tools_listed" | "tool_call";

export interface Actor {
  sub: string;
  email?: string;
  idp?: string;
  tenant?: string;
}

// One line per event. Never carries tool arguments, tool results or tokens:
// they may hold NPI and do not belong in a log store.
export interface AuditEvent {
  schema: typeof AUDIT_SCHEMA;
  ts: string;
  request_id: string;
  event: AuditEventName;
  actor?: Actor;
  client_id?: string;
  roles?: string[];
  connector?: string;
  tool?: string;
  effect?: string;
  decision?: "allow" | "deny";
  reason?: string;
  outcome?: "ok" | "tool_error" | "backend_error" | "timeout";
  duration_ms?: number;
  args_hmac?: string;
  tool_count?: number;
}

export type AuditInput = Omit<AuditEvent, "schema" | "ts">;

// Stable JSON: object keys sorted at every depth, so {a,b} and {b,a} hash the same.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export interface AuditLoggerOptions {
  // Keyed hash of tool arguments: proves two calls were identical without
  // storing their content. Must be a secret; when absent a random per-process
  // key is used and hashes are only comparable within one process lifetime.
  hmacKey?: string;
  sink?: (line: string) => void;
  // Recent events kept in memory for gateway_audit_search in local runs.
  ringSize?: number;
}

export class AuditLogger {
  private readonly key: Buffer;
  private readonly sink: (line: string) => void;
  private readonly ring: AuditEvent[] = [];
  private readonly ringSize: number;
  readonly ephemeralKey: boolean;

  constructor(opts: AuditLoggerOptions = {}) {
    this.ephemeralKey = !opts.hmacKey;
    this.key = opts.hmacKey ? Buffer.from(opts.hmacKey, "utf8") : randomBytes(32);
    this.sink = opts.sink ?? ((line) => process.stdout.write(`${line}\n`));
    this.ringSize = opts.ringSize ?? 1000;
  }

  argsHmac(args: unknown): string {
    return createHmac("sha256", this.key).update(canonicalJson(args ?? {})).digest("hex");
  }

  emit(input: AuditInput): AuditEvent {
    const event: AuditEvent = { schema: AUDIT_SCHEMA, ts: new Date().toISOString(), ...input };
    this.sink(JSON.stringify(event));
    this.ring.push(event);
    if (this.ring.length > this.ringSize) this.ring.shift();
    return event;
  }

  recent(filter: (e: AuditEvent) => boolean = () => true, limit = 100): AuditEvent[] {
    return this.ring.filter(filter).slice(-limit).reverse();
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

// Honors a well-formed caller-supplied correlation ID (front door, App
// Gateway); otherwise mints one. Malformed values are replaced, never echoed.
export function requestIdFrom(header: string | string[] | undefined): string {
  const v = Array.isArray(header) ? header[0] : header;
  return v && REQUEST_ID_RE.test(v) ? v : randomUUID();
}
