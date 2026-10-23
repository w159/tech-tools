import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// Placeholder test credential only; nothing here reaches a real appliance.
const API_KEY = "test-api-key-value";
const OK_XML =
  '<response status="success"><result><sw-version>11.1.0</sw-version></result></response>';

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: unknown;
}

/** Replace global fetch with a recorder answering every call with `text`. */
function mockFetch(text: string = OK_XML, status = 200) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: init.method ?? "GET",
        url: new URL(String(url)),
        headers: { ...(init.headers as Record<string, string>) },
        body: init.body,
      });
      return new Response(text, { status });
    }),
  );
  return calls;
}

async function handler(
  domain: "operations" | "commits" | "objects" | "config",
) {
  const { getDomainHandler } = await import("../domains/index.js");
  return getDomainHandler(domain);
}

describe("PAN-OS request building", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PANOS_HOST = "pan.example.test";
    process.env.PANOS_API_KEY = API_KEY;
    delete process.env.PANOS_TARGET;
    delete process.env.PANOS_VERIFY_TLS;
    delete process.env.PANOS_REST_VERSION;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of [
      "PANOS_HOST",
      "PANOS_API_KEY",
      "PANOS_TARGET",
      "PANOS_REST_VERSION",
    ])
      delete process.env[k];
  });

  it("sends the API key in the X-PAN-KEY header, never in the URL", async () => {
    const calls = mockFetch();
    const h = await handler("operations");
    const res = await h.handleCall("panos_system_info", {});
    expect(res.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers["X-PAN-KEY"]).toBe(API_KEY);
    expect(calls[0].url.toString()).not.toContain(API_KEY);
  });

  it("builds the XML API op URL: https://host/api/?type=op&cmd=...", async () => {
    const calls = mockFetch();
    const h = await handler("operations");
    await h.handleCall("panos_system_info", {});
    const u = calls[0].url;
    expect(u.origin).toBe("https://pan.example.test");
    expect(u.pathname).toBe("/api/");
    expect(u.searchParams.get("type")).toBe("op");
    expect(u.searchParams.get("cmd")).toBe(
      "<show><system><info/></system></show>",
    );
    expect(u.searchParams.has("target")).toBe(false);
  });

  it("adds target from the tool argument, and from PANOS_TARGET as a default", async () => {
    let calls = mockFetch();
    let h = await handler("operations");
    await h.handleCall("panos_system_info", { target: "0011AABB" });
    expect(calls[0].url.searchParams.get("target")).toBe("0011AABB");

    vi.resetModules();
    process.env.PANOS_TARGET = "99FF";
    calls = mockFetch();
    h = await handler("operations");
    await h.handleCall("panos_system_info", {});
    expect(calls[0].url.searchParams.get("target")).toBe("99FF");
  });

  it("panos_commit issues type=commit with a plain <commit> command", async () => {
    const calls = mockFetch();
    const h = await handler("commits");
    await h.handleCall("panos_commit", {});
    const u = calls[0].url;
    expect(u.searchParams.get("type")).toBe("commit");
    expect(u.searchParams.get("cmd")).toBe("<commit></commit>");
    expect(u.searchParams.has("action")).toBe(false);
  });

  it("panos_commit with force sends the force command as a POST", async () => {
    const calls = mockFetch();
    const h = await handler("commits");
    await h.handleCall("panos_commit", { force: true });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.searchParams.get("cmd")).toBe("<commit><force></force></commit>");
  });

  it("panos_commit_all issues type=commit with the supplied command", async () => {
    const calls = mockFetch();
    const h = await handler("commits");
    await h.handleCall("panos_commit_all", {
      cmd: '<commit-all><shared-policy><device-group><entry name="dg1"/></device-group></shared-policy></commit-all>',
    });
    const u = calls[0].url;
    expect(calls[0].method).toBe("POST");
    expect(u.searchParams.get("type")).toBe("commit");
    expect(u.searchParams.get("cmd")).toContain("<commit-all>");
  });

  // KNOWN GAP (reported, not fixed here): node-panos client.commit() accepts
  // `action` ('partial' | 'all') but never puts it on the request, so
  // panos_commit {partial:true} and panos_commit_all do not send action=... .
  // it.fails passes while the gap exists and starts failing once it is fixed,
  // which is the cue to turn these into plain it() tests.
  it.fails("panos_commit with partial sends action=partial", async () => {
    const calls = mockFetch();
    const h = await handler("commits");
    await h.handleCall("panos_commit", { partial: true });
    expect(calls[0].url.searchParams.get("action")).toBe("partial");
  });

  it.fails("panos_commit_all sends action=all", async () => {
    const calls = mockFetch();
    const h = await handler("commits");
    await h.handleCall("panos_commit_all", { cmd: "<commit-all></commit-all>" });
    expect(calls[0].url.searchParams.get("action")).toBe("all");
  });

  it("REST object list uses /restapi/<version>/Objects/<Resource> with location and the key header", async () => {
    const calls = mockFetch(
      '{"@status":"success","result":{"@total-count":"0","entry":[]}}',
    );
    const h = await handler("objects");
    const res = await h.handleCall("panos_objects_list", {
      resource: "Addresses",
      location: "shared",
    });
    expect(res.isError).toBeFalsy();
    const u = calls[0].url;
    expect(u.pathname).toBe("/restapi/v11.1/Objects/Addresses");
    expect(u.searchParams.get("location")).toBe("shared");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers["X-PAN-KEY"]).toBe(API_KEY);
  });

  it("REST version follows PANOS_REST_VERSION", async () => {
    process.env.PANOS_REST_VERSION = "v10.2";
    const calls = mockFetch('{"@status":"success","result":{"entry":[]}}');
    const h = await handler("objects");
    await h.handleCall("panos_objects_list", {
      resource: "Tags",
      location: "shared",
    });
    expect(calls[0].url.pathname).toBe("/restapi/v10.2/Objects/Tags");
  });

  it("REST delete uses DELETE with name and vsys in the query", async () => {
    const calls = mockFetch('{"@status":"success"}');
    const h = await handler("objects");
    await h.handleCall("panos_objects_delete", {
      resource: "Addresses",
      location: "vsys",
      vsys: "vsys1",
      name: "web-1",
    });
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.searchParams.get("name")).toBe("web-1");
    expect(calls[0].url.searchParams.get("vsys")).toBe("vsys1");
  });

  it('an XML <response status="error"> returned with HTTP 200 becomes a tool error', async () => {
    mockFetch(
      '<response status="error" code="403"><msg>Invalid Credential</msg></response>',
    );
    const h = await handler("operations");
    const res = await h.handleCall("panos_system_info", {});
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).not.toContain(API_KEY);
  });
});
