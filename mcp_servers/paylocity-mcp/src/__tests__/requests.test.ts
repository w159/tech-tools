import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// Placeholder test credentials only; nothing here reaches Paylocity.
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Replace global fetch. The token endpoint answers a bearer token; every other
 * URL answers `apiBody` as JSON.
 */
function mockFetch(
  apiBody: unknown = { data: [], pagination: {} },
  apiStatus = 200,
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(String(url));
      calls.push({
        method: init.method ?? "GET",
        url: u,
        headers: { ...(init.headers as Record<string, string>) },
        body: init.body as string | undefined,
      });
      if (u.pathname.endsWith("/IdentityServer/connect/token")) {
        return new Response(
          JSON.stringify({
            access_token: "test-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify(apiBody), {
        status: apiStatus,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

const apiCalls = (calls: Call[]) =>
  calls.filter(
    (c) => !c.url.pathname.endsWith("/IdentityServer/connect/token"),
  );
const tokenCalls = (calls: Call[]) =>
  calls.filter((c) => c.url.pathname.endsWith("/IdentityServer/connect/token"));

async function handler(domain: "employees" | "cost_centers") {
  const { getDomainHandler } = await import("../domains/index.js");
  return getDomainHandler(domain);
}

function clearEnv(): void {
  for (const k of [
    "PAYLOCITY_CLIENT_ID",
    "PAYLOCITY_CLIENT_SECRET",
    "PAYLOCITY_COMPANY_ID",
    "PAYLOCITY_BASE_URL",
    "PAYLOCITY_SANDBOX",
  ]) {
    delete process.env[k];
  }
}

describe("Paylocity request building", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
    process.env.PAYLOCITY_CLIENT_ID = CLIENT_ID;
    process.env.PAYLOCITY_CLIENT_SECRET = CLIENT_SECRET;
    process.env.PAYLOCITY_COMPANY_ID = "CO123";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("mints an OAuth token with a form-encoded client_credentials POST to the production host", async () => {
    const calls = mockFetch();
    const h = await handler("employees");
    await h.handleCall("paylocity_employees_list", {});
    const t = tokenCalls(calls)[0];
    expect(t.method).toBe("POST");
    expect(t.url.origin).toBe("https://api.paylocity.com");
    expect(t.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(t.body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe(CLIENT_SECRET);
    expect(form.get("scope")).toBe("WebLinkAPI");
    expect(t.url.toString()).not.toContain(CLIENT_SECRET);
  });

  it("employees list calls /corehr/v1/companies/<id>/employees with a Bearer header", async () => {
    const calls = mockFetch();
    const h = await handler("employees");
    const res = await h.handleCall("paylocity_employees_list", { limit: 5 });
    expect(res.isError).toBeFalsy();
    const c = apiCalls(calls)[0];
    expect(c.method).toBe("GET");
    expect(c.url.origin).toBe("https://api.paylocity.com");
    expect(c.url.pathname).toBe("/corehr/v1/companies/CO123/employees");
    expect(c.url.searchParams.get("limit")).toBe("5");
    expect(c.headers.Authorization).toBe("Bearer test-token");
    expect(c.headers.Accept).toBe("application/json");
    expect(c.url.toString()).not.toContain("test-token");
  });

  it("a per-call companyId overrides PAYLOCITY_COMPANY_ID and is URL-encoded", async () => {
    const calls = mockFetch();
    const h = await handler("employees");
    await h.handleCall("paylocity_employees_list", { companyId: "A B" });
    expect(apiCalls(calls)[0].url.pathname).toBe(
      "/corehr/v1/companies/A%20B/employees",
    );
  });

  it("employees get encodes the employee id into the path", async () => {
    const calls = mockFetch({ employeeId: "E/1" });
    const h = await handler("employees");
    await h.handleCall("paylocity_employees_get", { employeeId: "E/1" });
    expect(apiCalls(calls)[0].url.pathname).toBe(
      "/corehr/v1/companies/CO123/employees/E%2F1",
    );
  });

  it("employees get without an employeeId is rejected locally with no network call", async () => {
    const calls = mockFetch();
    const h = await handler("employees");
    const res = await h.handleCall("paylocity_employees_get", {});
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("PAYLOCITY_SANDBOX=true targets the sandbox host for the token and the API call", async () => {
    process.env.PAYLOCITY_SANDBOX = "true";
    const calls = mockFetch();
    const h = await handler("employees");
    await h.handleCall("paylocity_employees_list", {});
    expect(tokenCalls(calls)[0].url.origin).toBe(
      "https://apisandbox.paylocity.com",
    );
    expect(apiCalls(calls)[0].url.origin).toBe(
      "https://apisandbox.paylocity.com",
    );
  });

  it("PAYLOCITY_BASE_URL overrides the host and a trailing /api segment is stripped", async () => {
    process.env.PAYLOCITY_BASE_URL = "https://proxy.example.test/api/";
    const calls = mockFetch();
    const h = await handler("employees");
    await h.handleCall("paylocity_employees_list", {});
    expect(
      tokenCalls(calls)[0]
        .url.toString()
        .startsWith("https://proxy.example.test/IdentityServer/connect/token"),
    ).toBe(true);
    expect(apiCalls(calls)[0].url.pathname).toBe(
      "/corehr/v1/companies/CO123/employees",
    );
    expect(apiCalls(calls)[0].url.origin).toBe("https://proxy.example.test");
  });

  it("without any company id the call fails as a tool error and makes no API request", async () => {
    delete process.env.PAYLOCITY_COMPANY_ID;
    const calls = mockFetch();
    const h = await handler("employees");
    const res = await h.handleCall("paylocity_employees_list", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/companyId/);
    expect(apiCalls(calls)).toHaveLength(0);
  });

  it("a 403 from the API becomes a tool error that does not echo the secret", async () => {
    mockFetch({ message: "Forbidden" }, 403);
    const h = await handler("employees");
    const res = await h.handleCall("paylocity_employees_list", {});
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).not.toContain(CLIENT_SECRET);
  });
});
