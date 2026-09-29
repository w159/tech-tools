/**
 * mcp-server-kit.ts
 *
 * The McpServer bootstrap every domain-pattern connector repeats: register a
 * tool with annotate() metadata and zod validation, register every domain's
 * tools behind a last-resort catch, answer `<vendor>_navigate`, and run the
 * timed authenticated read behind `<vendor>_status`.
 *
 * Vendor-specific parts stay in each server: which endpoint the auth check
 * calls, status wording, the credential gate, and what a caught error returns.
 *
 * _shared has no node_modules, so nothing here is imported at runtime. The
 * caller passes `z`, `toZodShape` and `annotate` in through KitContext, and
 * the SDK and zod imports are type-only (each consumer's tsconfig maps them).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z as ZodNamespace } from "zod";
import type { toZodShape } from "./zod-shape.js";

const AUTH_CHECK_TIMEOUT_MS = 10_000;

export type ToolRun = (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;
export type ToolRegistrar = (tool: Tool, run: ToolRun) => void;

export interface KitContext {
  server: McpServer;
  z: typeof ZodNamespace;
  toZodShape: typeof toZodShape;
  /** The connector's annotate(): derives title + read/destructive hints. */
  annotate: (tools: Tool[], vendorTitle: string) => Array<{ annotations?: ToolAnnotations }>;
  vendorTitle: string;
}

interface DomainHandler {
  getTools(): Tool[];
  // Method syntax keeps parameter bivariance so handlers with narrower `extra` types fit.
  handleCall(name: string, args: Record<string, unknown>, extra?: unknown): Promise<CallToolResult>;
}

/** Bind a registrar to one server: registerTool validates args against the zod shape before the handler runs. */
export function createToolRegistrar(ctx: KitContext): ToolRegistrar {
  return (tool, run) => {
    const { title, ...annotations } = ctx.annotate([tool], ctx.vendorTitle)[0].annotations ?? {};
    ctx.server.registerTool(
      tool.name,
      {
        title,
        description: tool.description,
        inputSchema: ctx.toZodShape(ctx.z, tool.inputSchema),
        annotations: { title, ...annotations },
      },
      (args: unknown, extra: unknown) => run(args as Record<string, unknown>, extra),
    );
  };
}

/** Register the navigate and status tools, dispatching by tool name. */
export function registerNavigationTools(
  register: ToolRegistrar,
  tools: Tool[],
  navigateName: string,
  navigate: (domain: string) => Promise<CallToolResult>,
  status: () => Promise<CallToolResult>,
): void {
  for (const tool of tools) {
    register(tool, tool.name === navigateName
      ? async (args) => navigate(args.domain as string)
      : () => status());
  }
}

/** Register one domain tool; `onError` builds the result for a throw that escapes the handler. */
export function registerHandlerTool(
  register: ToolRegistrar,
  handler: DomainHandler,
  tool: Tool,
  onError: (toolName: string, err: unknown) => CallToolResult,
): void {
  register(tool, async (args, extra) => {
    try {
      return await handler.handleCall(tool.name, args, extra);
    } catch (err) {
      return onError(tool.name, err);
    }
  });
}

export async function registerDomainTools<D extends string>(
  register: ToolRegistrar,
  domains: readonly D[],
  getHandler: (domain: D) => Promise<DomainHandler>,
  onError: (toolName: string, err: unknown) => CallToolResult,
): Promise<void> {
  for (const domain of domains) {
    const handler = await getHandler(domain);
    for (const tool of handler.getTools()) registerHandlerTool(register, handler, tool, onError);
  }
}

const textResult = (text: string, isError?: boolean): CallToolResult =>
  isError ? { content: [{ type: "text", text }], isError } : { content: [{ type: "text", text }] };

export interface NavigateOptions<D extends string> {
  domains: readonly D[];
  domain: string;
  getHandler: (domain: D) => Promise<DomainHandler>;
  /** First line of the reply, e.g. `Domain: ${domain}`. */
  heading: (domain: D) => string;
  /** Appended after the tool list, including its leading blank line; empty for none. */
  footer: string;
}

/** Validate the domain, then list its tools. */
export async function navigateDomain<D extends string>(o: NavigateOptions<D>): Promise<CallToolResult> {
  if (!(o.domains as readonly string[]).includes(o.domain)) {
    return textResult(`Invalid domain: ${o.domain}. Valid: ${o.domains.join(", ")}`, true);
  }
  const domain = o.domain as D;
  const handler = await o.getHandler(domain);
  const summary = handler.getTools().map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return textResult(`${o.heading(domain)}\n\nAvailable tools:\n${summary}${o.footer}`);
}

/** Status result: only a rejected credential flips isError, unconfigured is a reduced mode. */
export function statusResult(text: string, authCheck: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: authCheck.startsWith("FAILED") };
}

/** "FAILED[ HTTP <code>]: <message capped at 200 chars>". */
export function formatAuthFailure(err: unknown): string {
  const e = err as { statusCode?: number; httpStatus?: number; message?: string };
  const code = e.statusCode ?? e.httpStatus;
  return `FAILED${code ? ` HTTP ${code}` : ""}: ${(e.message ?? String(err)).slice(0, 200)}`;
}

/**
 * Run one authenticated read under a hard timeout. Never throws and never
 * prints response data. `timeoutLabel` is the vendor's existing wording, for
 * example "10s".
 */
export async function runAuthCheck(
  call: () => Promise<unknown>,
  timeoutLabel: string,
  timeoutMs: number = AUTH_CHECK_TIMEOUT_MS,
): Promise<string> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutLabel}`)), timeoutMs);
      }),
    ]);
    return `OK (HTTP 200, ${Date.now() - started} ms)`;
  } catch (err) {
    return formatAuthFailure(err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The `<vendor>_navigate` handler shared by connectors whose heading is `Domain: <name>`. */
export function makeNavigate<D extends string>(
  domains: readonly D[],
  getHandler: (domain: D) => Promise<DomainHandler>,
  heading: (domain: D) => string = (d) => `Domain: ${d}`,
): (domain: string) => Promise<CallToolResult> {
  return (domain) => navigateDomain({
    domains, domain, getHandler, heading,
    footer: "\n\nYou can call any of these tools directly.",
  });
}

export interface StatusReport {
  /** e.g. "Vanta" */
  vendor: string;
  credStatus: string;
  authCheck: string;
  domains: readonly string[];
  /** Label before the domain list; vendors differ ("Domains" or "Available domains"). */
  domainsLabel?: string;
  /** Closing line after the domain list; empty for none. */
  footer: string;
}

/** The credential-status text block every `<vendor>_status` prints. */
export function credentialStatusResult(r: StatusReport): CallToolResult {
  const text =
    `${r.vendor} MCP Server Status\n\nCredentials: ${r.credStatus}\nAuth check: ${r.authCheck}\n` +
    `${r.domainsLabel ?? "Domains"}: ${r.domains.join(", ")}\n\n${r.footer}`;
  return statusResult(text, r.authCheck);
}

export interface GatedToolsOptions<D extends string> {
  register: ToolRegistrar;
  navigationTools: Tool[];
  navigateName: string;
  navigate: (domain: string) => Promise<CallToolResult>;
  status: () => Promise<CallToolResult>;
  hasCredentials: () => boolean;
  domains: readonly D[];
  getHandler: (domain: D) => Promise<DomainHandler>;
  onError: (toolName: string, err: unknown) => CallToolResult;
}

/** Progressive disclosure: status + navigate always, domain tools only once credentials resolve. */
export async function registerCredentialGatedTools<D extends string>(o: GatedToolsOptions<D>): Promise<void> {
  registerNavigationTools(o.register, o.navigationTools, o.navigateName, o.navigate, o.status);
  if (!o.hasCredentials()) return;
  await registerDomainTools(o.register, o.domains, o.getHandler, o.onError);
}
