import { describe, it, expect, afterEach, vi } from "vitest";
import { CwManageClient } from "./api-client.js";

// Placeholder test credentials only; nothing here reaches a real PSA.
const config = {
  baseUrl: "https://cw.example.test",
  companyId: "acme",
  publicKey: "pubkey",
  privateKey: "privkey",
  clientId: "client-123",
};
const BASIC = "Basic " + Buffer.from("acme+pubkey:privkey").toString("base64");

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function mockFetch(
  reply: () => Response = () => new Response("[]", { status: 200 }),
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url: new URL(url),
        method: init.method ?? "GET",
        headers: init.headers as Record<string, string>,
        body: init.body as string | undefined,
      });
      return reply();
    }),
  );
  return calls;
}

describe("CwManageClient request building", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CW_MANAGE_REJECT_UNAUTHORIZED;
  });

  it("appends /v4_6_release/apis/3.0 to a bare base URL", async () => {
    const calls = mockFetch();
    await new CwManageClient(config).get("/service/tickets");
    expect(calls[0].url.origin).toBe("https://cw.example.test");
    expect(calls[0].url.pathname).toBe(
      "/v4_6_release/apis/3.0/service/tickets",
    );
  });

  it("does not double the API path when the base URL already contains it", async () => {
    const calls = mockFetch();
    const client = new CwManageClient({
      ...config,
      baseUrl: "https://cw.example.test/v4_6_release/apis/3.0/",
    });
    await client.get("/system/info");
    expect(calls[0].url.pathname).toBe("/v4_6_release/apis/3.0/system/info");
  });

  it("sends Basic auth of companyId+publicKey:privateKey, the clientId header, and JSON content types", async () => {
    const calls = mockFetch();
    await new CwManageClient(config).get("/system/info");
    const h = calls[0].headers;
    expect(h.Authorization).toBe(BASIC);
    expect(h.clientId).toBe("client-123");
    expect(h.Accept).toBe("application/json");
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("never puts credentials in the URL", async () => {
    const calls = mockFetch();
    await new CwManageClient(config).get("/system/info", {
      conditions: "id=1",
    });
    const url = calls[0].url.toString();
    expect(url).not.toContain("privkey");
    expect(url).not.toContain("pubkey");
    expect(url).not.toContain("client-123");
  });

  it("serialises params and skips undefined and empty-string values", async () => {
    const calls = mockFetch();
    await new CwManageClient(config).get("/service/tickets", {
      conditions: "board/name='Triage'",
      page: 2,
      pageSize: 50,
      orderBy: undefined,
      empty: "",
    });
    const p = calls[0].url.searchParams;
    expect(p.get("conditions")).toBe("board/name='Triage'");
    expect(p.get("page")).toBe("2");
    expect(p.get("pageSize")).toBe("50");
    expect(p.has("orderBy")).toBe(false);
    expect(p.has("empty")).toBe(false);
  });

  it("POST and PATCH send the JSON body with the right verb", async () => {
    const calls = mockFetch(() => new Response("{}", { status: 200 }));
    const client = new CwManageClient(config);
    await client.post("/service/tickets", { summary: "x" });
    await client.patch("/service/tickets/9", [
      { op: "replace", path: "summary", value: "y" },
    ]);
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body!)).toEqual({ summary: "x" });
    expect(calls[1].method).toBe("PATCH");
    expect(JSON.parse(calls[1].body!)).toEqual([
      { op: "replace", path: "summary", value: "y" },
    ]);
  });

  it("GET sends no body", async () => {
    const calls = mockFetch();
    await new CwManageClient(config).get("/service/tickets");
    expect(calls[0].body).toBeUndefined();
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(
      new CwManageClient(config).patch("/service/tickets/9", []),
    ).resolves.toBeUndefined();
  });

  it("throws an error carrying the numeric HTTP status on a non-2xx reply", async () => {
    mockFetch(() => new Response('{"code":"NotFound"}', { status: 404 }));
    const err = await new CwManageClient(config)
      .get("/service/tickets/999")
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBe(404);
    expect((err as Error).message).toContain("returned 404");
  });

  it("does not leak the Authorization value in a thrown error message", async () => {
    mockFetch(() => new Response("denied", { status: 401 }));
    const err = await new CwManageClient(config)
      .get("/system/info")
      .catch((e) => e);
    expect((err as Error).message).not.toContain(BASIC);
    expect((err as Error).message).not.toContain("privkey");
  });
});
