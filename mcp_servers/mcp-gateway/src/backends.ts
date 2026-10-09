import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface BackendCommand {
  command: string;
  args: string[];
}

export interface BackendSpec {
  id: string;
  role: string;
  envPrefixes: string[];
  command(root: string): BackendCommand;
}

function nodeServer(id: string): (root: string) => BackendCommand {
  return (root: string) => ({ command: process.execPath, args: [`${root}/${id}/server.mjs`] });
}

export const BACKEND_CATALOG: readonly BackendSpec[] = [
  { id: "auvik", role: "Auvik", envPrefixes: ["AUVIK_"], command: nodeServer("auvik") },
  { id: "blumira", role: "Blumira", envPrefixes: ["BLUMIRA_"], command: nodeServer("blumira") },
  { id: "cipp", role: "CIPP", envPrefixes: ["CIPP_"], command: nodeServer("cipp") },
  { id: "connectwise", role: "ConnectWise", envPrefixes: ["CW_MANAGE_"], command: nodeServer("connectwise") },
  {
    id: "falcon",
    role: "Falcon",
    envPrefixes: ["FALCON_"],
    command: (root: string) => ({ command: `${root}/falcon/.venv/bin/falcon-mcp`, args: [] }),
  },
  { id: "knowbe4", role: "KnowBe4", envPrefixes: ["KNOWBE4_"], command: nodeServer("knowbe4") },
  { id: "ninjaone", role: "NinjaOne", envPrefixes: ["NINJAONE_"], command: nodeServer("ninjaone") },
  { id: "panos", role: "PanOS", envPrefixes: ["PANOS_"], command: nodeServer("panos") },
  { id: "paylocity", role: "Paylocity", envPrefixes: ["PAYLOCITY_"], command: nodeServer("paylocity") },
  { id: "spanning", role: "Spanning", envPrefixes: ["SPANNING_"], command: nodeServer("spanning") },
  { id: "threatlocker", role: "ThreatLocker", envPrefixes: ["THREATLOCKER_"], command: nodeServer("threatlocker") },
  { id: "vanta", role: "Vanta", envPrefixes: ["VANTA_"], command: nodeServer("vanta") },
] as const;

// ---------------------------------------------------------------------------
// Env allowlisting
// ---------------------------------------------------------------------------

// Least privilege: a vendor child process never sees another vendor's
// secrets. This is a GLBA / Reg S-P boundary, not a convenience - a bug in
// one vendor's stdio server must not be able to exfiltrate another vendor's
// API keys via its own environment.
const ALLOWED_COMMON_ENV = ["PATH", "HOME", "NODE_ENV", "TZ", "LANG", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"];

export function childEnv(spec: BackendSpec, env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = { MCP_TRANSPORT: "stdio" };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const allowed = ALLOWED_COMMON_ENV.includes(key) || spec.envPrefixes.some((p) => key.startsWith(p));
    if (allowed) result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Backend: a lazily-connected stdio MCP client for one vendor server
// ---------------------------------------------------------------------------

export interface BackendLike {
  spec: BackendSpec;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown> | undefined): Promise<unknown>;
  close(): Promise<void>;
}

export class Backend implements BackendLike {
  readonly spec: BackendSpec;
  private readonly root: string;
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;

  constructor(spec: BackendSpec, root: string) {
    this.spec = spec;
    this.root = root;
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    // Dedupe concurrent connects: two requests racing in must share one spawn.
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const { command, args } = this.spec.command(this.root);
      const transport = new StdioClientTransport({
        command,
        args,
        env: childEnv(this.spec, process.env),
        stderr: "inherit",
      });
      const client = new Client({ name: "henssler-mcp-gateway", version: "0.1.0" });
      transport.onclose = () => {
        // The child exited or the pipe broke - next use respawns from scratch.
        if (this.client === client) this.client = undefined;
      };
      await client.connect(transport);
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async listTools(): Promise<Tool[]> {
    const client = await this.connect();
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    const client = await this.connect();
    return client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    if (this.client) await this.client.close();
    this.client = undefined;
  }
}
