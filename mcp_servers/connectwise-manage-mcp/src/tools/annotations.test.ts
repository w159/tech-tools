import { describe, it, expect, afterEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CwManageClient } from "../api-client.js";
import { registerTicketTools } from "./tickets.js";
import { registerCompanyTools } from "./companies.js";
import { registerContactTools } from "./contacts.js";
import { registerProjectTools } from "./projects.js";
import { registerTimeEntryTools } from "./time-entries.js";
import { registerMemberTools } from "./members.js";
import { registerConfigurationTools } from "./configurations.js";
import { registerServiceTools } from "./service.js";
import { registerActivityTools } from "./activities.js";
import { registerCatalogTools } from "./catalog.js";
import { registerHealthTools } from "./health.js";
import { registerAgreementTools } from "./agreements.js";
import { registerOpportunityTools } from "./opportunities.js";

// Placeholder test credentials only; nothing here reaches a real PSA.
const apiClient = new CwManageClient({
  baseUrl: "https://cw.example.test",
  companyId: "acme",
  publicKey: "pubkey",
  privateKey: "privkey",
  clientId: "client-123",
});

async function connect() {
  const server = new McpServer({ name: "cw-test", version: "0.0.0" });
  registerTicketTools(server, apiClient);
  registerCompanyTools(server, apiClient);
  registerContactTools(server, apiClient);
  registerProjectTools(server, apiClient);
  registerTimeEntryTools(server, apiClient);
  registerMemberTools(server, apiClient);
  registerConfigurationTools(server, apiClient);
  registerServiceTools(server, apiClient);
  registerActivityTools(server, apiClient);
  registerCatalogTools(server, apiClient);
  registerHealthTools(server, apiClient);
  registerAgreementTools(server, apiClient);
  registerOpportunityTools(server, apiClient);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(a);
  return client;
}

const isReadName = (n: string) =>
  /^cw_(search|get|list)_|^cw_(status|test_connection)$/.test(n);
const isCreateName = (n: string) => /^cw_(create|add)_/.test(n);
const isUpdateName = (n: string) => /^cw_update_/.test(n);

describe("connectwise tool annotations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers the full tool surface", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(50);
    await client.close();
  });

  it("every tool declares readOnlyHint explicitly, and every name fits one known class", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).not.toBeUndefined();
      expect(
        isReadName(t.name) || isCreateName(t.name) || isUpdateName(t.name),
        `${t.name} has an unclassified name`,
      ).toBe(true);
    }
    await client.close();
  });

  it("search, get and list tools are read-only and non-destructive", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const reads = tools.filter((t) => isReadName(t.name));
    expect(reads.length).toBeGreaterThan(25);
    for (const t of reads) {
      expect(t.annotations, t.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
    await client.close();
  });

  it("create and add tools write but are not marked destructive", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const creates = tools.filter((t) => isCreateName(t.name));
    expect(creates.length).toBeGreaterThan(5);
    for (const t of creates) {
      expect(t.annotations, t.name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
    }
    await client.close();
  });

  it("update tools are marked destructive", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const updates = tools.filter((t) => isUpdateName(t.name));
    expect(updates.map((t) => t.name)).toEqual(
      expect.arrayContaining(["cw_update_ticket", "cw_update_company"]),
    );
    for (const t of updates) {
      expect(t.annotations, t.name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
    }
    await client.close();
  });

  it("descriptions marked DESTRUCTIVE: or VISIBLE-TO-OTHERS: are never read-only", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const marked = tools.filter((t) =>
      /^(DESTRUCTIVE|VISIBLE-TO-OTHERS):/.test(t.description ?? ""),
    );
    expect(marked.length).toBeGreaterThan(5);
    for (const t of marked) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(false);
    }
    await client.close();
  });
});

describe("connectwise tool -> HTTP", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cw_get_ticket issues GET /service/tickets/<id> with Basic auth and the clientId header", async () => {
    const seen: Array<{
      url: URL;
      method: string;
      headers: Record<string, string>;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({
          url: new URL(url),
          method: init.method ?? "GET",
          headers: init.headers as Record<string, string>,
        });
        return new Response('{"id":42,"summary":"Printer down"}', {
          status: 200,
        });
      }),
    );
    const client = await connect();
    const res = await client.callTool({
      name: "cw_get_ticket",
      arguments: { id: 42 },
    });
    expect(res.isError).toBeFalsy();
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("GET");
    expect(seen[0].url.pathname).toBe(
      "/v4_6_release/apis/3.0/service/tickets/42",
    );
    expect(seen[0].headers.Authorization).toBe(
      "Basic " + Buffer.from("acme+pubkey:privkey").toString("base64"),
    );
    expect(seen[0].headers.clientId).toBe("client-123");
    await client.close();
  });

  it("cw_create_ticket POSTs the nested board/company body", async () => {
    const seen: Array<{ method: string; body?: string; path: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({
          method: init.method ?? "GET",
          body: init.body as string | undefined,
          path: new URL(url).pathname,
        });
        return new Response('{"id":1}', { status: 201 });
      }),
    );
    const client = await connect();
    await client.callTool({
      name: "cw_create_ticket",
      arguments: { summary: "New", boardId: 3, companyId: 7 },
    });
    expect(seen[0].method).toBe("POST");
    expect(seen[0].path).toBe("/v4_6_release/apis/3.0/service/tickets");
    expect(JSON.parse(seen[0].body!)).toEqual({
      summary: "New",
      board: { id: 3 },
      company: { id: 7 },
    });
    await client.close();
  });

  it("a vendor 404 surfaces as a tool error rather than a thrown exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"code":"NotFound"}', { status: 404 })),
    );
    const client = await connect();
    const res = await client.callTool({
      name: "cw_get_ticket",
      arguments: { id: 999 },
    });
    expect(res.isError).toBe(true);
    await client.close();
  });
});
