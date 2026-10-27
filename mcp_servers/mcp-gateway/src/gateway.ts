import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { BackendPool } from "./backends.js";
import type { Identity } from "./auth.js";
import type { Actor, AuditEvent, AuditLogger } from "./audit.js";
import { accessMatrix, decide, GATEWAY_CONNECTOR, hasAnyGrant, type Policy } from "./policy.js";

export interface ToolCallResult {
  isError?: boolean;
  [key: string]: unknown;
}

interface IndexEntry {
  connector: string;
  tool: Tool;
}

const ACCESS_REPORT = "gateway_access_report";
const AUDIT_SEARCH = "gateway_audit_search";

const GATEWAY_TOOLS: Tool[] = [
  {
    name: ACCESS_REPORT,
    description:
      "Who can call what: for every gateway role and connector, the tools the policy allows and the tools it denies with the rule that decided.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: AUDIT_SEARCH,
    description:
      "Search recent gateway audit events (who called which tool, allow or deny). Covers this process's recent events only; the cloud log store is the system of record.",
    inputSchema: {
      type: "object",
      properties: {
        actor: { type: "string", description: "Actor subject or email" },
        connector: { type: "string" },
        decision: { type: "string", enum: ["allow", "deny"] },
        event: { type: "string", enum: ["auth_failed", "token_issued", "tools_listed", "tool_call"] },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
];

function textResult(text: string, isError = false): ToolCallResult {
  return { ...(isError ? { isError: true } : {}), content: [{ type: "text", text }] };
}

function actorOf(identity: Identity): Actor {
  return { sub: identity.sub, email: identity.email, idp: identity.idp, tenant: identity.tenant };
}

export class Gateway {
  private readonly pool: BackendPool;
  private readonly policy: Policy;
  private readonly audit: AuditLogger;
  private readonly auditorTools: boolean;
  // Tool lists captured at init. Stateful connectors are captured through a
  // throwaway child: tool definitions do not depend on the user.
  private catalog = new Map<string, Tool[]>();
  private index = new Map<string, IndexEntry>();

  constructor(pool: BackendPool, policy: Policy, audit: AuditLogger, opts: { auditorTools?: boolean } = {}) {
    this.pool = pool;
    this.policy = policy;
    this.audit = audit;
    this.auditorTools = opts.auditorTools !== false;
  }

  async init(): Promise<void> {
    const catalog = new Map<string, Tool[]>();
    await Promise.all(
      this.pool.specs.map(async (spec) => {
        try {
          if (spec.stateful) {
            const probe = this.pool.transient(spec.id);
            try {
              catalog.set(spec.id, await probe.listTools());
            } finally {
              await probe.close().catch(() => undefined);
            }
          } else {
            catalog.set(spec.id, await this.pool.get(spec.id, "").listTools());
          }
        } catch (err) {
          // One broken connector must not take the gateway down.
          console.error(`[gateway] connector ${spec.id} listTools failed:`, err instanceof Error ? err.message : err);
        }
      }),
    );

    // Deterministic order (catalog order), independent of which child answered first.
    const ordered = new Map<string, Tool[]>();
    const index = new Map<string, IndexEntry>();
    const register = (connector: string, tools: Tool[]): void => {
      for (const tool of tools) {
        const clash = index.get(tool.name);
        if (clash) {
          throw new Error(`duplicate tool name "${tool.name}" in connectors "${clash.connector}" and "${connector}"`);
        }
        index.set(tool.name, { connector, tool });
      }
    };
    for (const spec of this.pool.specs) {
      const tools = catalog.get(spec.id);
      if (!tools) continue;
      ordered.set(spec.id, tools);
      register(spec.id, tools);
    }
    if (this.auditorTools) register(GATEWAY_CONNECTOR, GATEWAY_TOOLS);
    this.catalog = ordered;
    this.index = index;
  }

  catalogSnapshot(): Map<string, Tool[]> {
    const snap = new Map(this.catalog);
    if (this.auditorTools) snap.set(GATEWAY_CONNECTOR, GATEWAY_TOOLS);
    return snap;
  }

  async listTools(identity: Identity, requestId: string): Promise<Tool[]> {
    const visible: Tool[] = [];
    for (const spec of this.pool.specs) {
      if (!hasAnyGrant(this.policy, identity.roles, spec.id)) continue;
      let tools: Tool[] | undefined;
      if (spec.stateful) {
        try {
          tools = await this.pool.get(spec.id, identity.userKey).listTools();
        } catch (err) {
          console.error(`[gateway] connector ${spec.id} listTools failed:`, err instanceof Error ? err.message : err);
          continue;
        }
      } else {
        tools = this.catalog.get(spec.id);
      }
      for (const tool of tools ?? []) {
        if (decide(this.policy, identity.roles, spec.id, tool).allow) visible.push(tool);
      }
    }
    if (this.auditorTools && hasAnyGrant(this.policy, identity.roles, GATEWAY_CONNECTOR)) {
      for (const tool of GATEWAY_TOOLS) {
        if (decide(this.policy, identity.roles, GATEWAY_CONNECTOR, tool).allow) visible.push(tool);
      }
    }
    this.audit.emit({
      request_id: requestId,
      event: "tools_listed",
      actor: actorOf(identity),
      client_id: identity.clientId,
      roles: [...identity.roles],
      tool_count: visible.length,
    });
    return visible;
  }

  async callTool(
    identity: Identity,
    name: string,
    args: Record<string, unknown> | undefined,
    requestId: string,
  ): Promise<ToolCallResult> {
    const started = Date.now();
    const base = {
      request_id: requestId,
      event: "tool_call" as const,
      actor: actorOf(identity),
      client_id: identity.clientId,
      roles: [...identity.roles],
      tool: name,
      args_hmac: this.audit.argsHmac(args),
    };

    const entry = this.index.get(name);
    if (!entry) {
      this.audit.emit({ ...base, decision: "deny", reason: "unknown_tool", duration_ms: Date.now() - started });
      return textResult(`Unknown tool: ${name}`, true);
    }

    const { connector, tool } = entry;
    const decision = decide(this.policy, identity.roles, connector, tool);
    if (!decision.allow) {
      this.audit.emit({
        ...base,
        connector,
        effect: decision.effect,
        decision: "deny",
        reason: decision.reason,
        duration_ms: Date.now() - started,
      });
      return textResult(`Access denied: ${name} (${decision.reason})`, true);
    }

    const allowed = { ...base, connector, effect: decision.effect, decision: "allow" as const, reason: decision.reason };
    try {
      const result =
        connector === GATEWAY_CONNECTOR
          ? this.runGatewayTool(name, args)
          : ((await this.pool.get(connector, identity.userKey).callTool(name, args)) as ToolCallResult);
      this.audit.emit({
        ...allowed,
        outcome: result?.isError === true ? "tool_error" : "ok",
        duration_ms: Date.now() - started,
      });
      return result;
    } catch (err) {
      this.audit.emit({ ...allowed, outcome: "backend_error", duration_ms: Date.now() - started });
      throw err;
    }
  }

  private runGatewayTool(name: string, args: Record<string, unknown> | undefined): ToolCallResult {
    if (name === ACCESS_REPORT) {
      return textResult(JSON.stringify(accessMatrix(this.policy, this.catalogSnapshot()), null, 2));
    }
    // AUDIT_SEARCH: the only other gateway tool.
    const a = args ?? {};
    const str = (k: string): string | undefined => (typeof a[k] === "string" && a[k] !== "" ? (a[k] as string) : undefined);
    const rawLimit = a.limit;
    if (rawLimit !== undefined && (typeof rawLimit !== "number" || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200)) {
      return textResult("limit must be an integer between 1 and 200", true);
    }
    const actor = str("actor");
    const connector = str("connector");
    const decision = str("decision");
    const event = str("event");
    const matches = (e: AuditEvent): boolean =>
      (!actor || e.actor?.sub === actor || e.actor?.email === actor) &&
      (!connector || e.connector === connector) &&
      (!decision || e.decision === decision) &&
      (!event || e.event === event);
    const events = this.audit.recent(matches, (rawLimit as number | undefined) ?? 50);
    return textResult(JSON.stringify(events, null, 2));
  }
}
