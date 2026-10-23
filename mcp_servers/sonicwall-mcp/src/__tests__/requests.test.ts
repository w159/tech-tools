import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// Placeholder test credentials only; nothing here reaches a real appliance.
const PASSWORD = "test-password-value";
const BASIC = "Basic " + Buffer.from(`apiadmin:${PASSWORD}`).toString("base64");
const OK = {
  status: {
    success: true,
    info: [{ level: "info", code: "E_OK", message: "Success." }],
  },
};

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Replace global fetch with a recorder that answers every call from `reply`. */
function mockFetch(
  reply: (c: Call) => { status?: number; body?: unknown } = () => ({}),
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const c: Call = {
        method: init.method ?? "GET",
        url: String(url),
        headers: { ...(init.headers as Record<string, string>) },
        body: init.body as string | undefined,
      };
      calls.push(c);
      const r = reply(c);
      return new Response(JSON.stringify(r.body ?? OK), {
        status: r.status ?? 200,
      });
    }),
  );
  return calls;
}

const pathOf = (c: Call) => new URL(c.url).pathname;
const bodyText = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

async function handler(domain: "system" | "config" | "objects" | "generic") {
  const { getDomainHandler } = await import("../domains/index.js");
  return getDomainHandler(domain);
}

function setEnv(): void {
  process.env.SONICWALL_HOST = "fw.example.test";
  process.env.SONICWALL_USERNAME = "apiadmin";
  process.env.SONICWALL_PASSWORD = PASSWORD;
  delete process.env.SONICWALL_PORT;
  delete process.env.SONICWALL_VERIFY_TLS;
  delete process.env.SONICWALL_SESSION_OVERRIDE;
}

function clearEnv(): void {
  for (const k of [
    "SONICWALL_HOST",
    "SONICWALL_USERNAME",
    "SONICWALL_PASSWORD",
    "SONICWALL_PORT",
  ])
    delete process.env[k];
}

describe("SonicOS request building", () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("logs in with Basic auth on POST /api/sonicos/auth, then reads with the bearer token", async () => {
    const calls = mockFetch((c) =>
      pathOf(c) === "/api/sonicos/auth"
        ? { body: { status: { success: true, info: [] }, token: "tok-1" } }
        : { body: { firmware: "7.3" } },
    );
    const h = await handler("system");
    const res = await h.handleCall("sonicwall_version", {});
    expect(res.isError).toBeFalsy();

    expect(calls[0].method).toBe("POST");
    expect(
      calls[0].url.startsWith("https://fw.example.test/api/sonicos/auth"),
    ).toBe(true);
    expect(calls[0].headers.Authorization).toBe(BASIC);
    expect(calls[0].url).not.toContain(PASSWORD);

    const read = calls[calls.length - 1];
    expect(read.method).toBe("GET");
    expect(pathOf(read)).toBe("/api/sonicos/version");
    expect(read.headers.Authorization).toBe("Bearer tok-1");
    expect(read.headers.Accept).toBe("application/json");
  });

  it("builds the base URL with a non-default port", async () => {
    process.env.SONICWALL_PORT = "8443";
    const calls = mockFetch();
    const h = await handler("system");
    await h.handleCall("sonicwall_version", {});
    expect(
      calls.every((c) =>
        c.url.startsWith("https://fw.example.test:8443/api/sonicos/"),
      ),
    ).toBe(true);
  });

  it("never echoes the password in a tool result", async () => {
    mockFetch(() => ({
      status: 400,
      body: {
        status: {
          success: false,
          info: [{ level: "error", code: "E_BAD", message: `bad ${PASSWORD}` }],
        },
      },
    }));
    const h = await handler("system");
    const res = await h.handleCall("sonicwall_version", {});
    expect(res.isError).toBe(true);
    expect(bodyText(res)).not.toContain(PASSWORD);
  });

  it("config_commit enters config mode, then POSTs /config/pending", async () => {
    const calls = mockFetch();
    const h = await handler("config");
    const res = await h.handleCall("sonicwall_config_commit", {});
    expect(res.isError).toBeFalsy();
    const seq = calls.map((c) => `${c.method} ${pathOf(c)}`);
    expect(seq).toContain("POST /api/sonicos/config-mode");
    expect(seq[seq.length - 1]).toBe("POST /api/sonicos/config/pending");
  });

  it("config_commit with bestEffort uses the best-effort route", async () => {
    const calls = mockFetch();
    const h = await handler("config");
    await h.handleCall("sonicwall_config_commit", { bestEffort: true });
    expect(pathOf(calls[calls.length - 1])).toBe(
      "/api/sonicos/config/pending/best-effort",
    );
  });

  it("objects_get URL-encodes the object name and sends no body", async () => {
    const calls = mockFetch();
    const h = await handler("objects");
    await h.handleCall("sonicwall_objects_get", {
      resource: "address-objects/ipv4",
      name: "web 1/a",
    });
    const last = calls[calls.length - 1];
    expect(last.method).toBe("GET");
    expect(last.url).toContain(
      "/api/sonicos/address-objects/ipv4/name/web%201%2Fa",
    );
    expect(last.body).toBeUndefined();
  });
});

describe("sonicwall_request guards (no network)", () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("hard-denies restart, auth, export and factory-default paths even with confirm", async () => {
    const calls = mockFetch();
    const h = await handler("generic");
    for (const path of [
      "/restart",
      "/auth",
      "/export/current-config",
      "/something/factory-default",
    ]) {
      const res = await h.handleCall("sonicwall_request", {
        method: "POST",
        path,
        confirm: true,
      });
      expect(res.isError, path).toBe(true);
      expect(bodyText(res)).toMatch(/hard-denied/);
    }
    expect(calls).toHaveLength(0);
  });

  it("rejects a path that is not in the endpoint inventory", async () => {
    const calls = mockFetch();
    const h = await handler("generic");
    const res = await h.handleCall("sonicwall_request", {
      method: "GET",
      path: "/definitely/not/a/route",
    });
    expect(res.isError).toBe(true);
    expect(bodyText(res)).toMatch(/not in the SonicOS endpoint inventory/);
    expect(calls).toHaveLength(0);
  });

  it("requires confirm: true for a non-GET on a listed path", async () => {
    const calls = mockFetch();
    const h = await handler("generic");
    const res = await h.handleCall("sonicwall_request", {
      method: "POST",
      path: "/config/pending",
    });
    expect(res.isError).toBe(true);
    expect(bodyText(res)).toMatch(/confirm: true/);
    expect(calls).toHaveLength(0);
  });
});
