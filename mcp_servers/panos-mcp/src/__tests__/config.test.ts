import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const ENV_KEYS = [
  "PANOS_HOST",
  "PANOS_API_KEY",
  "PANOS_USERNAME",
  "PANOS_PASSWORD",
  "PANOS_TARGET",
  "PANOS_VERIFY_TLS",
  "PANOS_REST_VERSION",
] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("getCredentials", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
  });
  afterEach(clearEnv);

  it("returns null when host or api key is missing", async () => {
    const { getCredentials } = await import("../utils/client.js");
    expect(getCredentials()).toBeNull();
    process.env.PANOS_HOST = "pan.example.test";
    expect(getCredentials()).toBeNull();
    delete process.env.PANOS_HOST;
    process.env.PANOS_API_KEY = "placeholder-key";
    expect(getCredentials()).toBeNull();
  });

  it("treats an unresolved ${user_config.x} placeholder as missing", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.PANOS_HOST = "${user_config.host}";
    process.env.PANOS_API_KEY = "placeholder-key";
    expect(getCredentials()).toBeNull();
  });

  it("applies defaults: TLS verification on, REST version v11.1, no target", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.PANOS_HOST = " pan.example.test ";
    process.env.PANOS_API_KEY = "placeholder-key";
    expect(getCredentials()).toEqual({
      host: "pan.example.test",
      apiKey: "placeholder-key",
      username: undefined,
      password: undefined,
      target: undefined,
      verifyTls: true,
      restVersion: "v11.1",
    });
  });

  it("parses overrides for target, verify-tls and REST version", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.PANOS_HOST = "pan.example.test";
    process.env.PANOS_API_KEY = "placeholder-key";
    process.env.PANOS_TARGET = "001234567890";
    process.env.PANOS_VERIFY_TLS = "False";
    process.env.PANOS_REST_VERSION = "v10.2";
    process.env.PANOS_USERNAME = "admin";
    process.env.PANOS_PASSWORD = "placeholder-pw";
    const c = getCredentials();
    expect(c?.target).toBe("001234567890");
    expect(c?.verifyTls).toBe(false);
    expect(c?.restVersion).toBe("v10.2");
    expect(c?.username).toBe("admin");
  });

  it("getClient throws a message naming PANOS_HOST and PANOS_API_KEY when unconfigured", async () => {
    const { getClient } = await import("../utils/client.js");
    await expect(getClient()).rejects.toThrow(/PANOS_HOST and PANOS_API_KEY/);
  });
});

describe("server credential states", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
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

  const names = async (client: Client) =>
    (await client.listTools()).tools.map((t) => t.name).sort();

  it("lists only panos_status and panos_navigate with no host", async () => {
    const client = await connect();
    expect(await names(client)).toEqual(["panos_navigate", "panos_status"]);
    await client.close();
  });

  it("adds panos_keygen when host, username and password are set but no key", async () => {
    process.env.PANOS_HOST = "pan.example.test";
    process.env.PANOS_USERNAME = "admin";
    process.env.PANOS_PASSWORD = "placeholder-pw";
    const client = await connect();
    expect(await names(client)).toEqual([
      "panos_keygen",
      "panos_navigate",
      "panos_status",
    ]);
    await client.close();
  });

  it("lists the full domain tool set once host and key are present", async () => {
    process.env.PANOS_HOST = "pan.example.test";
    process.env.PANOS_API_KEY = "placeholder-key";
    const client = await connect();
    const list = await names(client);
    expect(list.length).toBeGreaterThan(40);
    expect(list).toEqual(
      expect.arrayContaining([
        "panos_commit",
        "panos_config_show",
        "panos_policies_list",
        "panos_system_reboot",
      ]),
    );
    await client.close();
  });

  it("status reports NOT CONFIGURED without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await connect();
    const res = await client.callTool({ name: "panos_status", arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("NOT CONFIGURED");
    expect(text).toContain("PANOS_API_KEY: not set");
    expect(fetchSpy).not.toHaveBeenCalled();
    await client.close();
  });

  it("status shows only the length of the key and never the password", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('<response status="success"><result/></response>', {
            status: 200,
          }),
      ),
    );
    process.env.PANOS_HOST = "pan.example.test";
    process.env.PANOS_API_KEY = "placeholder-api-key-value";
    process.env.PANOS_PASSWORD = "placeholder-pw";
    const client = await connect();
    const res = await client.callTool({ name: "panos_status", arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("PANOS_API_KEY: configured (25 chars)");
    expect(text).toContain("PANOS_PASSWORD: (set)");
    expect(text).not.toContain("placeholder-api-key-value");
    expect(text).not.toContain("placeholder-pw");
    await client.close();
  });
});
