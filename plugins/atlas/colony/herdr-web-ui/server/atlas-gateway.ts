/**
 * Same-origin gateway to the Atlas dashboard (python, loopback only) under /atlas/**.
 *
 * herdr-web-ui's own auth stays the only front door: index.ts has already run decideAccess
 * for the request and hands the verdict in. This module never decides who may enter, it
 * only refuses what the verdict does not allow (no access, or a `watch` device mutating),
 * then speaks to the dashboard as the loopback client its guard (atlas_dashboard.py _guard)
 * expects: Host and Origin rewritten to the dashboard's own, the per-daemon X-Atlas-Token
 * scraped from GET / and attached. Nothing the browser sent for herdr-web-ui (cookies,
 * bearer, Tailscale identity, forwarding headers) is forwarded to the dashboard.
 */
import { jsonResponse } from "./http.ts";
import { sameOrigin } from "./machine-security.ts";
import { unauthorizedJson } from "./auth.ts";
import { isLoopbackHost } from "./access.ts";
import type { Access } from "./access.ts";

export const ATLAS_PREFIX = "/atlas";
export const DEFAULT_ATLAS_DASHBOARD_URL = "http://127.0.0.1:7421";
/** Largest request body forwarded to the dashboard. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Request headers that must never reach the dashboard: credentials for herdr-web-ui, proxy identity, and the ones rewritten below. */
const STRIP_REQUEST = /^(cookie|authorization|tailscale-.*|x-forwarded-.*|x-real-ip|forwarded|via|host|origin|x-atlas-token|content-length|connection|keep-alive|transfer-encoding|upgrade|te|trailer|proxy-.*|expect)$/i;
/** Response headers owned by this server's connection, or that would set herdr-web-ui-scoped state. */
const STRIP_RESPONSE = /^(connection|keep-alive|transfer-encoding|upgrade|content-length|content-encoding|set-cookie|te|trailer)$/i;

export interface AtlasUpstream { readonly url: URL; readonly host: string; readonly origin: string }

/** Parse ATLAS_DASHBOARD_URL; throws unless it is a plain http(s) URL naming this machine (the dashboard is never reachable off-box). */
export function resolveAtlasUpstream(raw: string | undefined): AtlasUpstream {
  const text = (raw ?? "").trim() || DEFAULT_ATLAS_DASHBOARD_URL;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`ATLAS_DASHBOARD_URL is not a URL: ${text}`); }
  if (url.protocol !== "http:") throw new Error(`ATLAS_DASHBOARD_URL must be http:// (loopback), got ${url.protocol}`);
  if (url.username || url.password) throw new Error("ATLAS_DASHBOARD_URL must not carry credentials");
  if (!isLoopbackHost(url.host)) throw new Error(`ATLAS_DASHBOARD_URL must name a loopback host, got ${url.hostname}`);
  if (!url.port) throw new Error("ATLAS_DASHBOARD_URL must include the dashboard port");
  return { url, host: url.host, origin: `http://${url.host}` };
}

export interface AtlasGatewayContext {
  /** the verdict index.ts already reached with decideAccess */
  access: Access;
  /** index.ts's own `authenticated` (adds the bridge token for bridge paths, which never applies here) */
  authenticated: boolean;
}

export interface AtlasGateway {
  /** true for /atlas and /atlas/** */
  owns(pathname: string): boolean;
  handle(request: Request, ctx: AtlasGatewayContext): Promise<Response>;
}

export interface AtlasGatewayOptions {
  upstream: AtlasUpstream;
  fetchImpl?: typeof fetch;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A page navigation gets a calm layer-1 state (design MASTER 9.14); fetch/XHR callers keep the JSON body. */
function unreachablePage(upstream: AtlasUpstream, detail: string, theme: string | null): Response {
  const dark = theme !== "light";
  const html = `<!doctype html><html lang="en" data-theme="${dark ? "dark" : "light"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Command Center</title><style>
:root{--bg:${dark ? "#0b1215" : "#f5f8f9"};--s1:${dark ? "#121a1e" : "#fff"};--s3:${dark ? "#212e36" : "#e0e8eb"};--text:${dark ? "#e6edf0" : "#12222a"};--dim:${dark ? "#9fb0b8" : "#465962"};--accent:${dark ? "#2fbd9f" : "#0c7d6c"};--ink:${dark ? "#05211b" : "#fff"};--amber:${dark ? "#e0a93b" : "#8a5a00"}}
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--bg);color:var(--text);font:14px/1.5 "Pretendard Variable",system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:30rem;padding:1.5rem;background:var(--s1);border-radius:10px;border-left:3px solid var(--amber)}h1{margin:0 0 .25rem;font-size:1.125rem}p{margin:.25rem 0;color:var(--dim)}
code{display:block;margin:.75rem 0;padding:.5rem .75rem;background:var(--s3);border-radius:6px;font:12px ui-monospace,"SF Mono",Menlo,monospace;color:var(--text);user-select:all;overflow-x:auto}
button{font:inherit;font-weight:600;padding:.4rem .9rem;border:0;border-radius:6px;background:var(--accent);color:var(--ink);cursor:pointer}details{margin-top:.75rem;color:var(--dim);font-size:12px}
</style></head><body><main role="status"><h1>Atlas isn't responding</h1><p>The dashboard process stopped or restarted.</p><code>python3 plugins/atlas/scripts/atlas_dashboard.py</code><button type="button" onclick="location.reload()">Retry</button>
<details><summary>Technical details</summary><p>atlas_dashboard_unreachable at ${escapeHtml(upstream.origin)}: ${escapeHtml(detail)}</p></details></main></body></html>`;
  return new Response(html, { status: 502, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function badGateway(upstream: AtlasUpstream, error: unknown, request: Request): Response {
  const detail = error instanceof Error ? error.message : String(error);
  const dest = request.headers.get("sec-fetch-dest");
  const navigation = request.method === "GET" && (dest === "document" || dest === "iframe") && (request.headers.get("accept") ?? "").includes("text/html");
  if (navigation) return unreachablePage(upstream, detail, URL.canParse(request.url) ? new URL(request.url).searchParams.get("theme") : null);
  return jsonResponse({
    ok: false,
    error: "atlas_dashboard_unreachable",
    hint: `The Atlas dashboard is not answering at ${upstream.origin}. Start it (python3 plugins/atlas/scripts/atlas_dashboard.py) or set ATLAS_DASHBOARD_URL.`,
    detail,
  }, 502, { "cache-control": "no-store" });
}

const TOKEN_META = /<meta\s+name="atlas-token"\s+content="([^"]*)"/i;
const BASE_META = /<meta\s+name="atlas-base"\s+content="[^"]*"\s*>/i;

export function createAtlasGateway(options: AtlasGatewayOptions): AtlasGateway {
  const { upstream } = options;
  const doFetch = options.fetchImpl ?? fetch;
  let cachedToken: string | null = null;
  let tokenInflight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const response = await doFetch(new URL("/", upstream.url), { headers: { host: upstream.host }, redirect: "manual" });
    const html = await response.text();
    const token = TOKEN_META.exec(html)?.[1];
    if (!response.ok || !token || token === "__ATLAS_TOKEN__") throw new Error(`no atlas-token in dashboard index (HTTP ${response.status})`);
    return token;
  }

  function token(refresh: boolean): Promise<string> {
    if (!refresh && cachedToken !== null) return Promise.resolve(cachedToken);
    // one scrape at a time: concurrent 401s share the refetch
    tokenInflight ??= fetchToken().then((value) => { cachedToken = value; return value; }).finally(() => { tokenInflight = null; });
    return tokenInflight;
  }

  function upstreamRequest(request: Request, target: string, body: Blob | null, atlasToken: string, signal: AbortSignal): Promise<Response> {
    const headers = new Headers();
    for (const [name, value] of request.headers) if (!STRIP_REQUEST.test(name)) headers.set(name, value);
    headers.set("host", upstream.host);
    headers.set("x-atlas-token", atlasToken);
    const mutating = !["GET", "HEAD"].includes(request.method);
    // the dashboard rejects any Origin that is not its own, on GET too, so one is only ever set for mutations
    if (mutating) headers.set("origin", upstream.origin);
    headers.delete("accept-encoding"); // the index is rewritten below; keep bodies uncompressed
    return doFetch(target, { method: request.method, headers, body: mutating ? body : null, redirect: "manual", signal });
  }

  async function readBody(request: Request): Promise<Blob | Response> {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
    if (!request.body) return new Blob();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let total = 0;
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { void reader.cancel(); return tooLarge(); }
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
    return new Blob(chunks);
  }

  function tooLarge(): Response {
    return jsonResponse({ ok: false, error: "payload_too_large", hint: `Atlas requests are capped at ${MAX_BODY_BYTES} bytes` }, 413);
  }

  async function relay(response: Response, rest: string, request: Request): Promise<Response> {
    const headers = new Headers();
    for (const [name, value] of response.headers) if (!STRIP_RESPONSE.test(name)) headers.set(name, value);
    headers.set("cache-control", "no-store");
    const contentType = response.headers.get("content-type") ?? "";
    // the dashboard's index carries the per-daemon token; the page needs the base prefix to find /atlas/ui and /atlas/api
    if (request.method === "GET" && rest === "/" && contentType.startsWith("text/html") && response.ok) {
      const tag = `<meta name="atlas-base" content="${ATLAS_PREFIX}">`;
      const raw = await response.text();
      // an index that predates the base-aware UI has no such tag: add one, so the page can still find /atlas/api
      const html = BASE_META.test(raw) ? raw.replace(BASE_META, tag) : raw.replace(/(<head[^>]*>)/i, `$1${tag}`);
      return new Response(html, { status: response.status, headers });
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  return {
    owns: (pathname) => pathname === ATLAS_PREFIX || pathname.startsWith(`${ATLAS_PREFIX}/`),

    async handle(request, ctx) {
      if (ctx.access.level !== "full" || !ctx.authenticated) {
        return unauthorizedJson(ctx.access.level === "none" ? ctx.access.reason : "token_required");
      }
      if (!URL.canParse(request.url)) return jsonResponse({ ok: false, error: "bad_url" }, 400);
      const url = new URL(request.url);
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      if (mutating) {
        if (ctx.access.role === "watch") return jsonResponse({ error: { code: "read_only", message: "this device can only watch" } }, 403);
        if (!sameOrigin(request)) return jsonResponse({ error: { code: "invalid_origin", message: "Use controls from this app" } }, 403);
      }
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "GET, HEAD, POST, PUT, DELETE" } });

      // "/atlas" -> "/" ; "/atlas/ui/x" -> "/ui/x". The dashboard percent-decodes paths, so dot segments, "//" and backslashes are refused after decoding too.
      const rest = url.pathname.slice(ATLAS_PREFIX.length) || "/";
      let decoded = rest;
      try { decoded = decodeURIComponent(rest); } catch { return jsonResponse({ ok: false, error: "bad_path" }, 400); }
      if (decoded.includes("//") || decoded.includes("\\") || decoded.split("/").some((part) => part === ".." || part === ".")) return jsonResponse({ ok: false, error: "bad_path" }, 400);
      const target = new URL(rest, upstream.url);
      target.search = url.search;
      target.searchParams.delete("token"); // the gateway owns the dashboard token; a stale page token must not win

      let body: Blob | null = null;
      if (mutating) {
        const read = await readBody(request);
        if (read instanceof Response) return read;
        body = read;
      }

      const isStream = rest === "/api/v2/stream";
      // abort the dashboard when the browser goes away, so its SSE thread is released
      const controller = new AbortController();
      request.signal.addEventListener("abort", () => controller.abort(), { once: true });
      const send = async (refresh: boolean): Promise<Response> => {
        const atlasToken = await token(refresh);
        const href = target.href;
        const to = isStream ? href + (href.includes("?") ? "&" : "?") + `token=${encodeURIComponent(atlasToken)}` : href;
        return upstreamRequest(request, to, body, atlasToken, controller.signal);
      };

      try {
        let response = await send(false);
        if (response.status === 401) {
          void response.body?.cancel();
          response = await send(true); // the daemon restarted and minted a new token
        }
        return await relay(response, rest, request);
      } catch (error) {
        controller.abort();
        return badGateway(upstream, error, request);
      }
    },
  };
}

/** The gateway index.ts uses: ATLAS_DASHBOARD_URL from the environment, validated once at startup (throws on a non-loopback host). */
export function createAtlasGatewayFromEnv(env: Record<string, string | undefined> = process.env): AtlasGateway {
  return createAtlasGateway({ upstream: resolveAtlasUpstream(env["ATLAS_DASHBOARD_URL"]) });
}
