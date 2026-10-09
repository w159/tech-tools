import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { BackendLike } from "./backends.js";
import { canUseTool, hasAnyVendorRole, isReadOnly } from "./policy.js";
import type { Identity } from "./auth.js";

interface IndexEntry {
  backend: BackendLike;
  tool: Tool;
}

export interface CallToolResult {
  isError?: boolean;
  [key: string]: unknown;
}

export class Gateway {
  private readonly backends: readonly BackendLike[];
  private toolIndex = new Map<string, IndexEntry>();

  constructor(backends: readonly BackendLike[]) {
    this.backends = backends;
  }

  // Lists tools the caller may see across every backend they hold any role
  // for, filtered per-tool by canUseTool. A backend that fails to list (spawn
  // error, crashed process) is skipped, not fatal to the whole listing.
  async listToolsFor(roles: readonly string[]): Promise<Tool[]> {
    const eligible = this.backends.filter((b) => hasAnyVendorRole(roles, b.spec.role));
    const settled = await Promise.allSettled(eligible.map((b) => this.listBackendTools(b)));

    const nextIndex = new Map<string, IndexEntry>();
    const visible: Tool[] = [];
    for (const result of settled) {
      if (result.status === "rejected") continue;
      for (const { backend, tool } of result.value) {
        nextIndex.set(tool.name, { backend, tool });
        if (canUseTool(roles, backend.spec.role, tool)) visible.push(tool);
      }
    }
    this.toolIndex = nextIndex;
    return visible;
  }

  private async listBackendTools(backend: BackendLike): Promise<IndexEntry[]> {
    try {
      const tools = await backend.listTools();
      return tools.map((tool) => ({ backend, tool }));
    } catch (err) {
      console.error(`[gateway] backend ${backend.spec.id} listTools failed:`, (err as Error).message);
      return [];
    }
  }

  async callTool(
    identity: Identity,
    name: string,
    args: Record<string, unknown> | undefined,
  ): Promise<CallToolResult> {
    const started = Date.now();
    let entry = this.toolIndex.get(name);
    if (!entry) {
      await this.listToolsFor(identity.roles);
      entry = this.toolIndex.get(name);
    }

    if (!entry) {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }

    const { backend, tool } = entry;
    const readOnly = isReadOnly(tool);
    const allowed = canUseTool(identity.roles, backend.spec.role, tool);

    if (!allowed) {
      const required = readOnly ? "Read" : "Write";
      this.audit(identity, backend.spec.id, name, readOnly, "deny", Date.now() - started, true);
      return {
        isError: true,
        content: [{ type: "text", text: `Access denied: ${name} requires ${backend.spec.role}.${required}` }],
      };
    }

    try {
      const result = (await backend.callTool(name, args)) as CallToolResult;
      this.audit(identity, backend.spec.id, name, readOnly, "allow", Date.now() - started, result?.isError === true);
      return result;
    } catch (err) {
      this.audit(identity, backend.spec.id, name, readOnly, "allow", Date.now() - started, true);
      throw err;
    }
  }

  // One JSON line per tool call. Never includes arguments or results - they
  // may carry NPI, which belongs nowhere near stdout/log aggregation.
  private audit(
    identity: Identity,
    backendId: string,
    tool: string,
    readOnly: boolean,
    decision: "allow" | "deny",
    durationMs: number,
    isError: boolean,
  ): void {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "tool_call",
        oid: identity.oid,
        upn: identity.upn,
        backend: backendId,
        tool,
        readOnly,
        decision,
        durationMs,
        isError,
      }),
    );
  }
}
