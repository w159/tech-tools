import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const ENV_KEYS = [
  "SONICWALL_HOST",
  "SONICWALL_USERNAME",
  "SONICWALL_PASSWORD",
  "SONICWALL_PORT",
  "SONICWALL_VERIFY_TLS",
  "SONICWALL_SESSION_OVERRIDE",
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

  it("returns null when nothing is set", async () => {
    const { getCredentials } = await import("../utils/client.js");
    expect(getCredentials()).toBeNull();
  });

  it("returns null when any one of host, username, password is missing", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.SONICWALL_HOST = "fw.example.test";
    process.env.SONICWALL_USERNAME = "apiadmin";
    expect(getCredentials()).toBeNull();
    process.env.SONICWALL_PASSWORD = "pw";
    delete process.env.SONICWALL_HOST;
    expect(getCredentials()).toBeNull();
  });

  it("treats an unresolved ${user_config.x} placeholder as missing", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.SONICWALL_HOST = "${user_config.host}";
    process.env.SONICWALL_USERNAME = "apiadmin";
    process.env.SONICWALL_PASSWORD = "pw";
    expect(getCredentials()).toBeNull();
  });

  it("applies defaults: port 443, TLS verification on, session override off", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.SONICWALL_HOST = " fw.example.test ";
    process.env.SONICWALL_USERNAME = "apiadmin";
    process.env.SONICWALL_PASSWORD = "pw";
    expect(getCredentials()).toEqual({
      host: "fw.example.test",
      username: "apiadmin",
      password: "pw",
      port: 443,
      verifyTls: true,
      sessionOverride: false,
    });
  });

  it("parses port, verify-tls and session-override overrides", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.SONICWALL_HOST = "fw.example.test";
    process.env.SONICWALL_USERNAME = "apiadmin";
    process.env.SONICWALL_PASSWORD = "pw";
    process.env.SONICWALL_PORT = "8443";
    process.env.SONICWALL_VERIFY_TLS = "FALSE";
    process.env.SONICWALL_SESSION_OVERRIDE = "True";
    const c = getCredentials();
    expect(c?.port).toBe(8443);
    expect(c?.verifyTls).toBe(false);
    expect(c?.sessionOverride).toBe(true);
  });

  it("falls back to port 443 for an invalid port", async () => {
    const { getCredentials } = await import("../utils/client.js");
    process.env.SONICWALL_HOST = "fw.example.test";
    process.env.SONICWALL_USERNAME = "apiadmin";
    process.env.SONICWALL_PASSWORD = "pw";
    for (const bad of ["abc", "0", "70000", "-1", "12.5"]) {
      process.env.SONICWALL_PORT = bad;
      expect(getCredentials()?.port).toBe(443);
    }
  });

  it("getClient throws a message naming all three variables when unconfigured", async () => {
    const { getClient } = await import("../utils/client.js");
    await expect(getClient()).rejects.toThrow(
      /SONICWALL_HOST, SONICWALL_USERNAME and SONICWALL_PASSWORD/,
    );
  });
});

describe("server with and without credentials", () => {
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

  it("lists only sonicwall_status and sonicwall_navigate when unconfigured", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "sonicwall_navigate",
      "sonicwall_status",
    ]);
    await client.close();
  });

  it("status reports NOT CONFIGURED without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await connect();
    const res = await client.callTool({
      name: "sonicwall_status",
      arguments: {},
    });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("NOT CONFIGURED");
    expect(text).toContain("SONICWALL_HOST: not set");
    expect(text).toContain("SONICWALL_PASSWORD: not set");
    expect(res.isError).toBeFalsy();
    expect(fetchSpy).not.toHaveBeenCalled();
    await client.close();
  });

  it("status shows only the length of the password, never the value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"status":{"success":true,"info":[]}}', {
            status: 200,
          }),
      ),
    );
    process.env.SONICWALL_HOST = "fw.example.test";
    process.env.SONICWALL_USERNAME = "apiadmin";
    process.env.SONICWALL_PASSWORD = "placeholder-pw-16c";
    const client = await connect();
    const res = await client.callTool({
      name: "sonicwall_status",
      arguments: {},
    });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("configured (18 chars)");
    expect(text).not.toContain("placeholder-pw-16c");
    await client.close();
  });

  it("lists the full domain tool set once credentials are present", async () => {
    process.env.SONICWALL_HOST = "fw.example.test";
    process.env.SONICWALL_USERNAME = "apiadmin";
    process.env.SONICWALL_PASSWORD = "pw";
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names).toEqual(
      expect.arrayContaining([
        "sonicwall_version",
        "sonicwall_config_commit",
        "sonicwall_request",
      ]),
    );
    await client.close();
  });
});
