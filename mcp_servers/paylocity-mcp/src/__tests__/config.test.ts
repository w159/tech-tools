import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const ENV_KEYS = [
  "PAYLOCITY_CLIENT_ID",
  "PAYLOCITY_CLIENT_SECRET",
  "PAYLOCITY_COMPANY_ID",
  "PAYLOCITY_BASE_URL",
  "PAYLOCITY_SANDBOX",
] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("getCredentials", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(clearEnv);

  it("returns null when the client id or secret is missing", async () => {
    const { getCredentials } = await import("../utils/client.js");
    expect(getCredentials()).toBeNull();
    process.env.PAYLOCITY_CLIENT_ID = "placeholder-id";
    expect(getCredentials()).toBeNull();
    delete process.env.PAYLOCITY_CLIENT_ID;
    process.env.PAYLOCITY_CLIENT_SECRET = "placeholder-secret";
    expect(getCredentials()).toBeNull();
  });

  it("treats an unresolved ${user_config.x} placeholder as missing", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.PAYLOCITY_CLIENT_ID = "${user_config.client_id}";
    process.env.PAYLOCITY_CLIENT_SECRET = "placeholder-secret";
    expect(getCredentials()).toBeNull();
  });

  it("applies defaults: no company, no base URL override, sandbox off", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.PAYLOCITY_CLIENT_ID = " placeholder-id ";
    process.env.PAYLOCITY_CLIENT_SECRET = "placeholder-secret";
    expect(getCredentials()).toEqual({
      clientId: "placeholder-id",
      clientSecret: "placeholder-secret",
      defaultCompanyId: undefined,
      baseUrl: undefined,
      sandbox: false,
    });
  });

  it("parses company id, base URL override and sandbox flag variants", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.PAYLOCITY_CLIENT_ID = "placeholder-id";
    process.env.PAYLOCITY_CLIENT_SECRET = "placeholder-secret";
    process.env.PAYLOCITY_COMPANY_ID = "CO123";
    process.env.PAYLOCITY_BASE_URL = "https://proxy.example.test";
    for (const truthy of ["true", "TRUE", "1", "yes"]) {
      process.env.PAYLOCITY_SANDBOX = truthy;
      expect(getCredentials()?.sandbox, truthy).toBe(true);
    }
    for (const falsy of ["false", "0", "no", ""]) {
      process.env.PAYLOCITY_SANDBOX = falsy;
      expect(getCredentials()?.sandbox, falsy).toBe(false);
    }
    const c = getCredentials();
    expect(c?.defaultCompanyId).toBe("CO123");
    expect(c?.baseUrl).toBe("https://proxy.example.test");
  });

  it("getClient throws a message naming both required variables when unconfigured", async () => {
    const { getClient } = await import("../utils/client.js");
    await expect(getClient()).rejects.toThrow(
      /PAYLOCITY_CLIENT_ID and PAYLOCITY_CLIENT_SECRET/,
    );
  });
});

describe("server credential states", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    clearEnv();
    vi.unstubAllGlobals();
  });

  async function connect() {
    const { createMcpServer } = await import("../server.js");
    const server = await createMcpServer();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientSide);
    return client;
  }

  it("lists only paylocity_status and paylocity_navigate when unconfigured", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "paylocity_navigate",
      "paylocity_status",
    ]);
    await client.close();
  });

  it("status reports NOT CONFIGURED without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await connect();
    const res = await client.callTool({
      name: "paylocity_status",
      arguments: {},
    });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("NOT CONFIGURED");
    expect(text).toContain("SKIPPED");
    expect(fetchSpy).not.toHaveBeenCalled();
    await client.close();
  });

  it("lists the full read tool set once credentials are present", async () => {
    process.env.PAYLOCITY_CLIENT_ID = "placeholder-id";
    process.env.PAYLOCITY_CLIENT_SECRET = "placeholder-secret";
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "paylocity_employees_list",
        "paylocity_employees_get",
        "paylocity_earnings_company_list",
        "paylocity_pay_statements_summary",
      ]),
    );
    expect(names.length).toBeGreaterThan(12);
    await client.close();
  });
});
