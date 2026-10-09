import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import type { Access } from "./access.ts";
import { ATLAS_PREFIX, MAX_BODY_BYTES, createAtlasGateway, resolveAtlasUpstream } from "./atlas-gateway.ts";

// A fake Atlas dashboard: Host/Origin/token guarded like atlas_dashboard.py _guard, with a rotating token.
let token = "tok-1";
let upstreamPort = 0;
let legacyIndex = false;
let streamClosed = Promise.withResolvers<void>();
const seen: { method: string; path: string; headers: Headers; body: string }[] = [];

const dashboard: Bun.Server<undefined> = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    const origin = request.headers.get("origin");
    const allowed = `127.0.0.1:${upstreamPort}`;
    seen.push({ method: request.method, path: url.pathname + url.search, headers: request.headers, body: request.method === "GET" ? "" : await request.clone().text() });
    if (host !== allowed) return Response.json({ ok: false, error: "bad_host", host }, { status: 403 });
    if (origin !== null && origin !== `http://${allowed}`) return Response.json({ ok: false, error: "bad_origin" }, { status: 403 });
    if (url.pathname === "/api/health") return Response.json({ ok: true, service: "atlas-dashboard" });
    if (url.pathname === "/") {
      return new Response(`<html><head><meta name="atlas-token" content="${token}">${legacyIndex ? "" : `<meta name="atlas-base" content="">`}</head></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const supplied = request.headers.get("x-atlas-token") ?? (url.pathname === "/api/v2/stream" ? url.searchParams.get("token") : null);
    if (request.method !== "GET" || url.pathname.startsWith("/api/v2/")) {
      if (supplied !== token) return Response.json({ ok: false, error: "bad_token" }, { status: 401 });
    }
    if (url.pathname === "/api/v2/stream") {
      const closed = Promise.withResolvers<void>();
      streamClosed = closed;
      request.signal.addEventListener("abort", () => closed.resolve());
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode("event: tick\ndata: {\"n\":1}\n\n")); },
        cancel() { closed.resolve(); },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ ok: true, echo: await request.text(), ctype: request.headers.get("content-type") });
  },
});
upstreamPort = dashboard.port ?? 0;
afterAll(() => dashboard.stop(true));

const gateway = createAtlasGateway({ upstream: resolveAtlasUpstream(`http://127.0.0.1:${upstreamPort}`) });
const drive: Access = { level: "full", via: "token", role: "drive" };
const watch: Access = { level: "full", via: "device", role: "watch" };
const denied: Access = { level: "none", reason: "pairing_required" };
const ctx = (access: Access) => ({ access, authenticated: access.level === "full" });
const call = (path: string, init: RequestInit = {}, access: Access = drive) => gateway.handle(new Request(`http://127.0.0.1:7317${path}`, init), ctx(access));
const post = (path: string, body = "{}", headers: Record<string, string> = {}) =>
  ({ path, init: { method: "POST", body, headers: { "content-type": "application/json", ...headers } } });

beforeEach(() => { seen.length = 0; });

describe("atlas gateway", () => {
  it("owns /atlas and /atlas/** only", () => {
    expect(gateway.owns(ATLAS_PREFIX)).toBe(true);
    expect(gateway.owns("/atlas/ui/js/app.js")).toBe(true);
    expect(gateway.owns("/atlasx")).toBe(false);
    expect(gateway.owns("/api/atlas")).toBe(false);
  });

  it("requires herdr-web-ui access: unauthenticated gets the same 401 as /api/*, and nothing reaches the dashboard", async () => {
    const response = await call("/atlas/api/health", {}, denied);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "pair this device, or use the token" } });
    expect(seen).toHaveLength(0);
  });

  it("proxies GET /atlas/api/health to the dashboard health JSON", async () => {
    const response = await call("/atlas/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "atlas-dashboard" });
  });

  it("rewrites Host and strips credentials, Tailscale and forwarding headers; never sends Origin on GET", async () => {
    await call("/atlas/api/v2/colony?project=all", { headers: {
      cookie: "herdr_web_token=secret", authorization: "Bearer secret", "tailscale-user-login": "me@example.com",
      "x-forwarded-for": "100.64.0.1", "x-forwarded-proto": "https", origin: "https://box.tail.ts.net", "x-atlas-token": "forged", accept: "application/json",
    } });
    const hit = seen.find((entry) => entry.path.startsWith("/api/v2/colony"))!;
    expect(hit.path).toBe("/api/v2/colony?project=all");
    expect(hit.headers.get("host")).toBe(`127.0.0.1:${dashboard.port}`);
    expect(hit.headers.get("origin")).toBeNull();
    for (const name of ["cookie", "authorization", "tailscale-user-login", "x-forwarded-for", "x-forwarded-proto"]) expect(hit.headers.get(name)).toBeNull();
    expect(hit.headers.get("x-atlas-token")).toBe("tok-1");
    expect(hit.headers.get("accept")).toBe("application/json");
  });

  it("sets the dashboard Origin and passes Content-Type and body through on mutations", async () => {
    const { path, init } = post("/atlas/api/v2/prefs", JSON.stringify({ a: 1 }), { origin: "http://127.0.0.1:7317" });
    const response = await call(path, init);
    expect(await response.json()).toEqual({ ok: true, echo: "{\"a\":1}", ctype: "application/json" });
    const hit = seen.find((entry) => entry.method === "POST")!;
    expect(hit.headers.get("origin")).toBe(`http://127.0.0.1:${dashboard.port}`);
    expect(hit.headers.get("x-atlas-token")).toBe("tok-1");
  });

  it("rejects a cross-origin mutation (CSRF) before it reaches the dashboard", async () => {
    const { path, init } = post("/atlas/api/v2/prefs", "{}", { origin: "https://evil.example" });
    const response = await call(path, init);
    expect(response.status).toBe(403);
    expect(seen.some((entry) => entry.method === "POST")).toBe(false);
  });

  it("blocks mutations from a watch-role device but lets it read", async () => {
    const { path, init } = post("/atlas/api/v2/prefs");
    const blocked = await call(path, init, watch);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: { code: "read_only", message: "this device can only watch" } });
    expect(seen).toHaveLength(0);
    expect((await call("/atlas/api/health", {}, watch)).status).toBe(200);
  });

  it("refetches the dashboard token once on a 401 (daemon restarted) and retries", async () => {
    await call("/atlas/api/v2/prefs", { method: "PUT", body: "{}", headers: { "content-type": "application/json" } }); // caches tok-1
    token = "tok-2";
    seen.length = 0;
    const response = await call("/atlas/api/v2/prefs", { method: "PUT", body: "{\"x\":1}", headers: { "content-type": "application/json" } });
    expect(response.status).toBe(200);
    expect((await response.json() as { echo: string }).echo).toBe("{\"x\":1}");
    expect(seen.map((entry) => `${entry.method} ${entry.path}`)).toEqual(["PUT /api/v2/prefs", "GET /", "PUT /api/v2/prefs"]);
    expect(seen[2]!.headers.get("x-atlas-token")).toBe("tok-2");
    token = "tok-1";
    await call("/atlas/api/v2/prefs", { method: "PUT", body: "{}", headers: { "content-type": "application/json" } }); // gateway re-caches tok-1
  });

  it("injects <meta atlas-base> into the proxied index and rewrites nothing else", async () => {
    token = "tok-1";
    const index = await (await call("/atlas/")).text();
    expect(index).toContain(`<meta name="atlas-base" content="/atlas">`);
    expect(index).toContain(`<meta name="atlas-token" content="`);
    const bare = await (await call("/atlas")).text();
    expect(bare).toContain(`content="/atlas"`);
  });

  it("adds the meta when the dashboard's index predates base-path support, and leaves assets untouched", async () => {
    legacyIndex = true;
    try {
      const index = await (await call("/atlas/")).text();
      expect(index).toContain(`<head><meta name="atlas-base" content="/atlas"><meta name="atlas-token"`);
      expect(index.match(/atlas-base/g)).toHaveLength(1);
    } finally { legacyIndex = false; }
    const asset = await call("/atlas/ui/js/app.js");
    expect(asset.headers.get("set-cookie")).toBeNull();
  });

  it("streams SSE without buffering, adds ?token=, and aborts the dashboard when the client leaves", async () => {
    const abort = new AbortController();
    const response = await gateway.handle(new Request("http://127.0.0.1:7317/atlas/api/v2/stream?project=all&token=stale", { signal: abort.signal }), ctx(drive));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const first = await reader.read(); // arrives while the upstream stream is still open
    expect(new TextDecoder().decode(first.value)).toContain("event: tick");
    const hit = seen.find((entry) => entry.path.startsWith("/api/v2/stream"))!;
    expect(hit.path).toBe("/api/v2/stream?project=all&token=tok-1");
    abort.abort();
    await reader.cancel().catch(() => undefined);
    await streamClosed.promise; // bun's test timeout bounds this if the gateway never aborts the upstream
  });

  it("answers 502 atlas_dashboard_unreachable when the dashboard is down", async () => {
    const dead = createAtlasGateway({ upstream: resolveAtlasUpstream("http://127.0.0.1:1") });
    const response = await dead.handle(new Request("http://127.0.0.1:7317/atlas/api/health"), ctx(drive));
    expect(response.status).toBe(502);
    const body = await response.json() as { ok: boolean; error: string; hint: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("atlas_dashboard_unreachable");
    expect(body.hint.length).toBeGreaterThan(0);
  });

  it("answers a page navigation with a calm HTML state, never frame-blocking headers", async () => {
    const dead = createAtlasGateway({ upstream: resolveAtlasUpstream("http://127.0.0.1:1") });
    const response = await dead.handle(new Request("http://127.0.0.1:7317/atlas/?theme=light", { headers: { accept: "text/html", "sec-fetch-dest": "iframe" } }), ctx(drive));
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
    const html = await response.text();
    expect(html).toContain("Atlas isn't responding");
    expect(html).toContain('data-theme="light"');
  });

  it("caps request bodies at 4 MiB (declared and undeclared)", async () => {
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    const declared = await call("/atlas/api/v2/prefs", { method: "POST", body: big, headers: { "content-type": "application/json" } });
    expect(declared.status).toBe(413);
    const chunked = await call("/atlas/api/v2/prefs", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } }), headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
    expect(chunked.status).toBe(413);
    expect(seen.some((entry) => entry.method === "POST")).toBe(false);
    const ok = await call("/atlas/api/v2/prefs", { method: "POST", body: "x".repeat(MAX_BODY_BYTES), headers: { "content-type": "application/json" } });
    expect(ok.status).toBe(200);
  });

  it("refuses encoded traversal and doubled slashes (the URL parser already collapses plain and %2e dot segments inside /atlas/)", async () => {
    expect((await call("/atlas/ui/%2E%2E%2Fsecret")).status).toBe(400);
    expect((await call("/atlas/ui/..%5Cx")).status).toBe(400);
    expect((await call("/atlas//ui/x")).status).toBe(400);
    expect(seen).toHaveLength(0);
    // collapsed by the parser, so it stays under the gateway's own prefix and never escapes it
    await call("/atlas/ui/%2e%2e/api/health");
    expect(seen.map((entry) => entry.path)).toEqual(["/api/health"]);
  });
});

describe("ATLAS_DASHBOARD_URL", () => {
  it("defaults to the loopback dashboard", () => {
    expect(resolveAtlasUpstream(undefined).origin).toBe("http://127.0.0.1:7421");
    expect(resolveAtlasUpstream("http://localhost:7421").host).toBe("localhost:7421");
  });

  it("refuses non-loopback hosts, lookalikes, credentials, https and a missing port at startup", () => {
    for (const bad of ["http://10.0.0.5:7421", "http://example.com:7421", "http://127.0.0.1.evil.com:7421", "http://user:pw@127.0.0.1:7421", "https://127.0.0.1:7421", "http://127.0.0.1", "not a url", "http://100.64.0.1:7421"]) {
      expect(() => resolveAtlasUpstream(bad), bad).toThrow();
    }
  });
});
