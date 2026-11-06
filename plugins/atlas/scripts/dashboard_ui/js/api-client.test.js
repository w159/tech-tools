import { test, expect, describe, beforeEach, afterEach } from "bun:test";

// api.js reads <meta> tags once at import and keeps token / backoff / hidden-root state at module level,
// so every test imports its own copy (?n=) under a fully stubbed document, fetch and timer set.
const KEYS = ["document", "fetch", "EventSource", "CustomEvent", "setTimeout", "clearTimeout", "setInterval", "clearInterval"];
let saved;
let n = 0;
let env;

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const jsonRes = (status, body, statusText = "") => ({ ok: status >= 200 && status < 300, status, statusText, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => (typeof body === "string" ? JSON.parse(body) : body) });

async function load({ token, base, routes } = {}) {
  const metas = {};
  if (token !== undefined) metas["atlas-token"] = token;
  if (base !== undefined) metas["atlas-base"] = base;
  const calls = [];
  const events = [];
  const listeners = {};
  const timers = { timeouts: [], intervals: [], cleared: [] };
  env = { calls, events, listeners, timers, doc: null };
  globalThis.document = {
    hidden: false,
    querySelector: (sel) => {
      const m = /name="([^"]+)"/.exec(sel);
      const v = m && metas[m[1]];
      if (v === undefined) return null;
      return { getAttribute: (a) => (a === "content" ? v : null), content: v };
    },
    addEventListener: (k, f) => { (listeners[k] = listeners[k] || []).push(f); },
    removeEventListener: (k, f) => { listeners[k] = (listeners[k] || []).filter((x) => x !== f); },
    dispatchEvent: (e) => { events.push(e.type); },
  };
  env.doc = globalThis.document;
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = routes ? await routes(String(url), init, calls.length) : jsonRes(200, { ok: true });
    if (r instanceof Error) throw r;
    return r;
  };
  globalThis.setTimeout = (fn, ms) => { timers.timeouts.push({ fn, ms }); return timers.timeouts.length; };
  globalThis.clearTimeout = () => {};
  globalThis.setInterval = (fn, ms) => { timers.intervals.push({ fn, ms }); return timers.intervals.length; };
  globalThis.clearInterval = (id) => { timers.cleared.push(id); };
  return import("./api.js?n=" + ++n);
}

beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, globalThis[k]])); delete globalThis.EventSource; });
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });

describe("ApiError", () => {
  test("carries status, message, why and next step; defaults when omitted", async () => {
    const { ApiError } = await load();
    const e = new ApiError(404, "gone", "no such task", "reload");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ApiError");
    expect([e.message, e.status, e.error, e.why, e.do]).toEqual(["gone", 404, "gone", "no such task", "reload"]);
    const d = new ApiError(500);
    expect([d.message, d.error, d.why, d.do]).toEqual(["Request failed", "Request failed", "", ""]);
  });
});

describe("token and base path", () => {
  test("the meta token rides as X-Atlas-Token and api.hasToken is true", async () => {
    const { api } = await load({ token: "abc123" });
    expect(api.hasToken).toBe(true);
    await api.get("overview");
    expect(env.calls[0].init.headers["X-Atlas-Token"]).toBe("abc123");
  });

  test("a missing meta, an empty token and the unreplaced placeholder all mean no token and no header", async () => {
    for (const token of [undefined, "", "__ATLAS_TOKEN__"]) {
      const { api } = await load({ token });
      expect(api.hasToken).toBe(false);
      await api.get("overview");
      expect("X-Atlas-Token" in env.calls[0].init.headers).toBe(false);
    }
  });

  test("atlas-base prefixes every URL with trailing slashes trimmed; /api/ paths get the prefix only", async () => {
    const { api } = await load({ base: "/atlas//" });
    await api.get("overview");
    await api.get("/overview");
    await api.get("/api/health");
    expect(env.calls.map((c) => c.url)).toEqual(["/atlas/api/v2/overview", "/atlas/api/v2/overview", "/atlas/api/health"]);
  });

  test("without atlas-base the root API is used", async () => {
    const { api } = await load();
    await api.get("todos");
    expect(env.calls[0].url).toBe("/api/v2/todos");
  });
});

describe("request shaping", () => {
  test("GET sends Accept + credentials, no body and no Content-Type", async () => {
    const { api } = await load({ token: "t" });
    await api.get("overview");
    const { init } = env.calls[0];
    expect(init.method).toBe("GET");
    expect(init.headers.Accept).toBe("application/json");
    expect("Content-Type" in init.headers).toBe(false);
    expect("body" in init).toBe(false);
    expect(init.credentials).toBe("same-origin");
  });

  test("POST and PUT send a JSON body; undefined body becomes {}", async () => {
    const { api } = await load();
    await api.post("todos", { a: 1 });
    await api.put("prefs", { b: [2] });
    await api.post("todos");
    const [p, u, e] = env.calls;
    expect([p.init.method, p.init.body, p.init.headers["Content-Type"]]).toEqual(["POST", '{"a":1}', "application/json"]);
    expect([u.init.method, u.init.body]).toEqual(["PUT", '{"b":[2]}']);
    expect(e.init.body).toBe("{}");
  });

  test("query params skip null, undefined and empty string but keep 0 and false; join with & after an existing ?", async () => {
    const { api } = await load();
    await api.get("todos", { project: "/p", a: null, b: undefined, c: "", d: 0, e: false });
    await api.get("todos?x=1", { y: 2 });
    await api.get("todos", { only: null });
    await api.get("todos", {});
    expect(env.calls.map((c) => c.url)).toEqual(["/api/v2/todos?project=%2Fp&d=0&e=false", "/api/v2/todos?x=1&y=2", "/api/v2/todos", "/api/v2/todos"]);
  });

  test("post never puts params in the URL", async () => {
    const { api } = await load();
    await api.post("todos", { project: "/p" });
    expect(env.calls[0].url).toBe("/api/v2/todos");
  });
});

describe("responses", () => {
  test("returns the parsed body; an empty or unparseable 200 body becomes {}", async () => {
    const bodies = [{ ok: true, v: 1 }, "", "<html>"];
    let i = 0;
    const { api } = await load({ routes: () => jsonRes(200, bodies[i++]) });
    expect(await api.get("a")).toEqual({ ok: true, v: 1 });
    expect(await api.get("a")).toEqual({});
    expect(await api.get("a")).toEqual({});
  });

  test("GET announces atlas:fetched on success, POST does not, and a failed GET does not", async () => {
    let status = 200;
    const { api } = await load({ routes: () => jsonRes(status, { ok: status === 200 }) });
    await api.get("a");
    expect(env.events).toEqual(["atlas:fetched"]);
    await api.post("a", {});
    expect(env.events).toEqual(["atlas:fetched"]);
    status = 500;
    await expect(api.get("a")).rejects.toThrow();
    expect(env.events).toEqual(["atlas:fetched"]);
  });

  test("a non-2xx answer throws ApiError with the server's error/why/do and the raw data", async () => {
    const { api, ApiError } = await load({ routes: () => jsonRes(409, { ok: false, error: "conflict", why: "dup", do: "rename" }, "Conflict") });
    const err = await api.post("todos", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.error, err.why, err.do]).toEqual([409, "conflict", "dup", "rename"]);
    expect(err.data.error).toBe("conflict");
  });

  test("hint stands in for do; statusText stands in for a missing error; then the generic message", async () => {
    let r;
    const { api } = await load({ routes: () => r });
    r = jsonRes(500, { hint: "try later" }, "Server Error");
    let e = await api.get("a").catch((x) => x);
    expect([e.error, e.do, e.why]).toEqual(["Server Error", "try later", ""]);
    r = jsonRes(500, "not json", "");
    e = await api.get("a").catch((x) => x);
    expect([e.status, e.error, e.do, e.data]).toEqual([500, "Request failed", "", {}]);
  });

  test("a 200 answer with ok:false is still an error", async () => {
    const { api } = await load({ routes: () => jsonRes(200, { ok: false, error: "nope" }) });
    const e = await api.get("a").catch((x) => x);
    expect([e.status, e.error]).toEqual([200, "nope"]);
  });

  test("a network failure becomes status 0 with an actionable message", async () => {
    const { api } = await load({ routes: () => new Error("boom") });
    const e = await api.get("a").catch((x) => x);
    expect(e.status).toBe(0);
    expect(e.error).toBe("Cannot reach the Atlas dashboard");
    expect(e.why).toBe("The local server did not answer.");
    expect(e.do).toBe("Check that the dashboard daemon is running, then retry.");
  });
});

describe("stale token", () => {
  const stale = () => jsonRes(401, { ok: false, error: "bad_token" }, "Unauthorized");
  const index = (tok) => jsonRes(200, `<html><meta name="atlas-token" content="${tok}"></html>`);

  test("401 bad_token re-scrapes the index once and retries with the fresh token", async () => {
    const { api } = await load({
      token: "old",
      base: "/atlas",
      routes: (url, init) => {
        if (url === "/atlas/") return index("new");
        return init.headers["X-Atlas-Token"] === "new" ? jsonRes(200, { ok: true, v: 7 }) : stale();
      },
    });
    expect(await api.get("overview")).toEqual({ ok: true, v: 7 });
    expect(env.calls.map((c) => c.url)).toEqual(["/atlas/api/v2/overview", "/atlas/", "/atlas/api/v2/overview"]);
    expect(env.calls[1].init).toEqual({ credentials: "same-origin", cache: "no-store" });
    // the new token sticks for later calls
    await api.get("overview");
    expect(env.calls[3].init.headers["X-Atlas-Token"]).toBe("new");
  });

  test("a failed refresh surfaces the 401 and then fails fast for the backoff window without hitting the network", async () => {
    const { api } = await load({ token: "old", routes: (url) => (url === "/" ? jsonRes(500, "x") : stale()) });
    const e = await api.get("a").catch((x) => x);
    expect([e.status, e.error]).toEqual([401, "bad_token"]);
    const before = env.calls.length;
    const e2 = await api.get("a").catch((x) => x);
    expect(env.calls.length).toBe(before);
    expect([e2.status, e2.error, e2.why, e2.do]).toEqual([401, "bad_token", "The dashboard token is stale.", "Reload the page to obtain a fresh token."]);
  });

  test("a refresh that finds the same token, the placeholder or no meta does not retry", async () => {
    for (const html of [`<meta name="atlas-token" content="old">`, `<meta name="atlas-token" content="__ATLAS_TOKEN__">`, "<html></html>"]) {
      const { api } = await load({ token: "old", routes: (url) => (url === "/" ? jsonRes(200, html) : stale()) });
      const e = await api.get("a").catch((x) => x);
      expect(e.status).toBe(401);
      expect(env.calls.filter((c) => c.url === "/api/v2/a").length).toBe(1);
    }
  });

  test("an unreachable index counts as a failed refresh", async () => {
    const { api } = await load({ token: "old", routes: (url) => (url === "/" ? new Error("down") : stale()) });
    const e = await api.get("a").catch((x) => x);
    expect(e.status).toBe(401);
    expect(env.calls.filter((c) => c.url === "/api/v2/a").length).toBe(1);
  });

  test("a refreshed token that still 401s is not retried a second time", async () => {
    const { api } = await load({ token: "old", routes: (url) => (url === "/" ? index("new") : stale()) });
    const e = await api.get("a").catch((x) => x);
    expect(e.status).toBe(401);
    expect(env.calls.filter((c) => c.url === "/api/v2/a").length).toBe(2);
  });

  test("even when every refresh yields a new token, one request is retried only once", async () => {
    let k = 0;
    const { api } = await load({ token: "old", routes: (url) => (url === "/" ? index("new" + ++k) : stale()) });
    const e = await api.get("a").catch((x) => x);
    expect(e.status).toBe(401);
    expect(env.calls.filter((c) => c.url === "/api/v2/a").length).toBe(2);
  });

  test("a 401 with another error code never triggers a refresh", async () => {
    const { api } = await load({ token: "old", routes: () => jsonRes(401, { ok: false, error: "forbidden" }) });
    await api.get("a").catch(() => {});
    expect(env.calls.length).toBe(1);
    await api.get("a").catch(() => {}); // and no backoff either
    expect(env.calls.length).toBe(2);
  });

  test("concurrent stale answers share one index fetch", async () => {
    const { api } = await load({
      token: "old",
      routes: async (url, init) => {
        if (url === "/") { await new Promise((r) => setImmediate(r)); return index("new"); }
        return init.headers["X-Atlas-Token"] === "new" ? jsonRes(200, { ok: true }) : stale();
      },
    });
    await Promise.all([api.get("a"), api.get("b")]);
    expect(env.calls.filter((c) => c.url === "/").length).toBe(1);
  });
});

describe("stableJson", () => {
  test("drops the volatile keys at any depth and keeps everything else", async () => {
    const { stableJson } = await load();
    const v = { a: 1, idle_seconds: 5, updated: 1, last_ok: 1, generated_at: 1, now: 1, age_seconds: 1, nest: [{ now: 2, keep: true }] };
    expect(stableJson(v)).toBe('{"a":1,"nest":[{"keep":true}]}');
    expect(stableJson(v)).toBe(stableJson({ ...v, idle_seconds: 99, now: 7 }));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
    expect(stableJson(null)).toBe("null");
  });
});

describe("hidden project roots", () => {
  const board = () => ({ rows: [{ project: "/h", id: 1 }, { root: "/h", id: 2 }, { project: "/ok", id: 3 }, null, "s"], deep: { list: [{ project: "/h" }, { project: "/ok" }] }, project: "/h-top" });

  test("overview and todos merged views drop rows of hidden roots at any depth", async () => {
    const { api, setHiddenRoots } = await load({ routes: () => jsonRes(200, board()) });
    setHiddenRoots(["/h"]);
    for (const path of ["overview", "todos", "/api/v2/overview", "todos?x=1"]) {
      const d = await api.get(path);
      expect(d.rows).toEqual([{ project: "/ok", id: 3 }, null, "s"]);
      expect(d.deep.list).toEqual([{ project: "/ok" }]);
      expect(d.project).toBe("/h-top");
    }
  });

  test("all-projects param still filters; a concrete project, other endpoints, POST and an empty list do not", async () => {
    const { api, setHiddenRoots } = await load({ routes: () => jsonRes(200, board()) });
    setHiddenRoots(["/h"]);
    expect((await api.get("overview", { project: "all" })).rows.length).toBe(3);
    expect((await api.get("overview", { project: "/h" })).rows.length).toBe(5);
    expect((await api.get("colony")).rows.length).toBe(5);
    expect((await api.get("overview2")).rows.length).toBe(5);
    expect((await api.post("overview", {})).rows.length).toBe(5);
    setHiddenRoots([]);
    expect((await api.get("overview")).rows.length).toBe(5);
    setHiddenRoots(["/h"]);
    setHiddenRoots(undefined);
    expect((await api.get("overview")).rows.length).toBe(5);
  });
});

describe("probe", () => {
  test("reports up with the health body and status", async () => {
    const { api } = await load({ base: "/atlas", routes: () => jsonRes(200, { version: "9" }) });
    expect(await api.probe()).toEqual({ up: true, data: { version: "9" }, status: 200 });
    expect(env.calls[0].url).toBe("/atlas/api/health");
    expect(env.calls[0].init).toEqual({ headers: { Accept: "application/json" }, credentials: "same-origin" });
  });

  test("a non-ok answer is down but keeps data (empty when the body is not JSON); a throw carries the message", async () => {
    let r = jsonRes(503, "oops");
    let { api } = await load({ routes: () => r });
    expect(await api.probe()).toEqual({ up: false, data: {}, status: 503 });
    ({ api } = await load({ routes: () => new Error("refused") }));
    expect(await api.probe()).toEqual({ up: false, error: "refused" });
    ({ api } = await load({ routes: () => { throw "plain"; } }));
    expect(await api.probe()).toEqual({ up: false, error: "plain" });
  });
});

describe("stream", () => {
  class ES {
    static all = [];
    constructor(url) { this.url = url; this.handlers = {}; this.closed = false; ES.all.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    close() { this.closed = true; }
  }
  const ticketRoutes = () => {
    let k = 0;
    return (url) => (url.endsWith("/stream/ticket") ? jsonRes(200, { ok: true, ticket: "T" + ++k }) : jsonRes(200, { ok: true }));
  };
  beforeEach(() => { ES.all = []; });

  test("no EventSource: polls at pollMs, reports poll mode, and each visible tick calls poll() and emits a polled tick", async () => {
    const modes = [];
    const evs = [];
    let polls = 0;
    const { api } = await load();
    const h = api.stream({ pollMs: 1234, onMode: (m) => modes.push(m), onEvent: (n, d) => evs.push([n, d]), poll: () => polls++ });
    expect(modes).toEqual(["poll"]);
    expect(api.mode).toBe("poll");
    expect(env.timers.intervals.map((t) => t.ms)).toEqual([1234]);
    env.timers.intervals[0].fn();
    expect(polls).toBe(1);
    expect(evs[0][0]).toBe("tick");
    expect(evs[0][1].polled).toBe(true);
    expect(new Date(evs[0][1].ts).toISOString()).toBe(evs[0][1].ts);
    env.doc.hidden = true;
    env.timers.intervals[0].fn();
    expect(polls).toBe(1);
    expect(evs.length).toBe(1);
    h.close();
  });

  test("default poll interval is 8000ms; startPolling is idempotent", async () => {
    const { api } = await load();
    const h = api.stream();
    expect(env.timers.intervals.map((t) => t.ms)).toEqual([8000]);
    env.timers.intervals[0].fn(); // no poll / onEvent callbacks: must not throw
    h.close();
  });

  test("with EventSource: mints a ticket, connects with project + ticket, goes live on open and stops polling", async () => {
    globalThis.EventSource = ES;
    const modes = [];
    const { api } = await load({ base: "/atlas", routes: ticketRoutes() });
    const h = api.stream({ project: "/p q", onMode: (m) => modes.push(m) });
    await flush();
    expect(env.calls[0].url).toBe("/atlas/api/v2/stream/ticket");
    expect(env.calls[0].init.method).toBe("POST");
    expect(ES.all.map((e) => e.url)).toEqual(["/atlas/api/v2/stream?project=%2Fp+q&ticket=T1"]);
    ES.all[0].onopen();
    expect(modes).toEqual(["live"]);
    expect(api.mode).toBe("live");
    expect(env.timers.intervals).toEqual([]);
    h.close();
    expect(ES.all[0].closed).toBe(true);
    expect(api.mode).toBe("idle");
  });

  test("project all or missing leaves project out of the stream URL", async () => {
    globalThis.EventSource = ES;
    for (const project of ["all", undefined]) {
      ES.all = [];
      const { api } = await load({ routes: ticketRoutes() });
      const h = api.stream({ project });
      await flush();
      expect(ES.all[0].url).toBe("/api/v2/stream?ticket=T1");
      h.close();
    }
  });

  test("registers every named event; payloads are parsed, bad or empty payloads become {}, lastEventId is remembered", async () => {
    globalThis.EventSource = ES;
    const evs = [];
    const { api } = await load({ routes: ticketRoutes() });
    const h = api.stream({ onEvent: (name, data) => evs.push([name, data]) });
    await flush();
    const es = ES.all[0];
    expect(Object.keys(es.handlers)).toEqual(["herd", "todos", "irc", "health", "improve", "route_error", "tick"]);
    es.handlers.herd({ data: '{"a":1}', lastEventId: "42" });
    expect(api.lastEventId).toBe("42");
    es.handlers.todos({ data: "{bad" });
    es.handlers.irc({ data: "" });
    expect(api.lastEventId).toBe("42"); // an event without an id leaves it alone
    expect(evs).toEqual([["herd", { a: 1 }], ["todos", {}], ["irc", {}]]);
    h.close();
  });

  test("events without an onEvent callback are ignored", async () => {
    globalThis.EventSource = ES;
    const { api } = await load({ routes: ticketRoutes() });
    const h = api.stream({});
    await flush();
    ES.all[0].handlers.tick({ data: "{}" });
    ES.all[0].onopen();
    h.close();
  });

  test("error escalation: first error reconnecting, second starts polling; each reconnect uses a new ticket with doubling delay", async () => {
    globalThis.EventSource = ES;
    const modes = [];
    const t = ticketRoutes();
    const { api } = await load({ token: "tk", routes: (url) => (url === "/" ? jsonRes(500, "") : t(url)) });
    const h = api.stream({ pollMs: 99, onMode: (m) => modes.push(m) });
    await flush();
    ES.all[0].onerror();
    expect(ES.all[0].closed).toBe(true);
    expect(modes).toEqual(["reconnecting"]);
    expect(env.timers.intervals).toEqual([]);
    await flush();
    expect(env.timers.timeouts.map((x) => x.ms)).toEqual([5000]);
    env.timers.timeouts[0].fn();
    await flush();
    expect(ES.all.length).toBe(2);
    expect(ES.all[1].url).toContain("ticket=T2");
    ES.all[1].onerror();
    expect(modes).toEqual(["reconnecting", "poll"]);
    expect(env.timers.intervals.map((x) => x.ms)).toEqual([99]);
    await flush();
    expect(env.timers.timeouts.map((x) => x.ms)).toEqual([5000, 10000]);
    h.close();
  });

  test("reconnect delay is capped at the auth backoff (60000ms)", async () => {
    globalThis.EventSource = ES;
    const t = ticketRoutes();
    const { api } = await load();
    globalThis.fetch = async (url) => (String(url) === "/" ? jsonRes(500, "") : t(String(url)));
    const h = api.stream({});
    await flush();
    for (let i = 0; i < 7; i++) {
      ES.all[ES.all.length - 1].onerror();
      await flush();
      env.timers.timeouts[env.timers.timeouts.length - 1].fn();
      await flush();
    }
    expect(Math.max(...env.timers.timeouts.map((x) => x.ms))).toBe(60000);
    h.close();
  });

  test("a successful open resets the failure count and reconnect delay", async () => {
    globalThis.EventSource = ES;
    const modes = [];
    const t = ticketRoutes();
    const { api } = await load();
    globalThis.fetch = async (url) => (String(url) === "/" ? jsonRes(500, "") : t(String(url)));
    const h = api.stream({ onMode: (m) => modes.push(m) });
    await flush();
    ES.all[0].onerror();
    await flush();
    env.timers.timeouts[0].fn();
    await flush();
    ES.all[1].onopen();
    ES.all[1].onerror();
    await flush();
    expect(modes).toEqual(["reconnecting", "live", "reconnecting"]);
    expect(env.timers.timeouts.map((x) => x.ms)).toEqual([5000, 5000]);
    h.close();
  });

  test("a failing ticket request falls back to polling and retries after 2500ms", async () => {
    globalThis.EventSource = ES;
    const { api } = await load({ routes: () => jsonRes(500, { ok: false, error: "x" }) });
    const h = api.stream({ pollMs: 50 });
    await flush();
    expect(api.mode).toBe("poll");
    expect(env.timers.intervals.map((x) => x.ms)).toEqual([50]);
    expect(env.timers.timeouts.map((x) => x.ms)).toEqual([2500]);
    expect(ES.all).toEqual([]);
    h.close();
  });

  test("a ticket answer without a ticket is treated as a failure", async () => {
    globalThis.EventSource = ES;
    const { api } = await load({ routes: () => jsonRes(200, { ok: true }) });
    const h = api.stream({});
    await flush();
    expect(ES.all).toEqual([]);
    expect(api.mode).toBe("poll");
    h.close();
  });

  test("close during an in-flight ticket request never opens a source", async () => {
    globalThis.EventSource = ES;
    let release;
    const { api } = await load({ routes: () => new Promise((r) => { release = () => r(jsonRes(200, { ok: true, ticket: "Z" })); }) });
    const h = api.stream({});
    await flush();
    h.close();
    release();
    await flush();
    expect(ES.all).toEqual([]);
  });

  test("a hidden tab does not open; becoming visible opens and polls once; hiding closes the source", async () => {
    globalThis.EventSource = ES;
    let polls = 0;
    const { api } = await load({ routes: ticketRoutes() });
    env.doc.hidden = true;
    const h = api.stream({ poll: () => polls++ });
    await flush();
    expect(env.calls).toEqual([]);
    expect(ES.all).toEqual([]);
    expect(env.listeners.visibilitychange.length).toBe(1);
    env.doc.hidden = false;
    env.listeners.visibilitychange[0]();
    await flush();
    expect(ES.all.length).toBe(1);
    expect(polls).toBe(1);
    env.doc.hidden = true;
    env.listeners.visibilitychange[0]();
    expect(ES.all[0].closed).toBe(true);
    expect(polls).toBe(1);
    h.close();
    expect(env.listeners.visibilitychange).toEqual([]);
  });

  test("becoming visible clears the failure count so a later single error reads as reconnecting again", async () => {
    globalThis.EventSource = ES;
    const modes = [];
    const t = ticketRoutes();
    const { api } = await load();
    globalThis.fetch = async (url) => (String(url) === "/" ? jsonRes(500, "") : t(String(url)));
    const h = api.stream({ onMode: (m) => modes.push(m) });
    await flush();
    ES.all[0].onerror(); // failures = 1
    await flush();
    env.doc.hidden = false;
    env.listeners.visibilitychange[0](); // failures reset
    await flush();
    const live = ES.all[ES.all.length - 1];
    live.onerror();
    expect(env.timers.intervals).toEqual([]); // one failure again, not two: still no polling
    h.close();
  });

  test("visibility changes after close do nothing; close is safe to repeat", async () => {
    globalThis.EventSource = ES;
    const { api } = await load({ routes: ticketRoutes() });
    const h = api.stream({});
    await flush();
    const handler = env.listeners.visibilitychange[0];
    h.close();
    const calls = env.calls.length;
    handler();
    await flush();
    expect(env.calls.length).toBe(calls);
    h.close();
  });

  test("close stops the poll timer", async () => {
    const { api } = await load();
    const h = api.stream({});
    h.close();
    expect(env.timers.cleared).toContain(1);
  });

  test("setMode only reports changes", async () => {
    const modes = [];
    globalThis.EventSource = ES;
    const { api } = await load({ routes: ticketRoutes() });
    const h = api.stream({ onMode: (m) => modes.push(m) });
    await flush();
    ES.all[0].onopen();
    ES.all[0].onopen();
    expect(modes).toEqual(["live"]);
    h.close();
  });

  test("repeated errors never stack a second poll timer", async () => {
    globalThis.EventSource = ES;
    const t = ticketRoutes();
    const { api } = await load({ routes: (url) => (url === "/" ? jsonRes(500, "") : t(url)) });
    const h = api.stream({});
    await flush();
    for (let i = 0; i < 3; i++) {
      ES.all[ES.all.length - 1].onerror();
      await flush();
      env.timers.timeouts[env.timers.timeouts.length - 1].fn();
      await flush();
    }
    expect(env.timers.intervals.length).toBe(1);
    h.close();
  });

  test("a ticket failure arriving after close starts no polling and schedules no retry", async () => {
    globalThis.EventSource = ES;
    let fail;
    const { api } = await load({ routes: () => new Promise((_r, rej) => { fail = rej; }) });
    const h = api.stream({});
    await flush();
    h.close();
    fail(new Error("late"));
    await flush();
    expect(env.timers.intervals).toEqual([]);
    expect(env.timers.timeouts).toEqual([]);
  });

  test("a scheduled reconnect that fires after close does nothing", async () => {
    globalThis.EventSource = ES;
    const t = ticketRoutes();
    const { api } = await load({ routes: (url) => (url === "/" ? jsonRes(500, "") : t(url)) });
    const h = api.stream({});
    await flush();
    ES.all[0].onerror();
    await flush();
    h.close();
    const calls = env.calls.length;
    env.timers.timeouts[0].fn();
    await flush();
    expect(env.calls.length).toBe(calls);
    expect(ES.all.length).toBe(1);
  });

  test("a visible event while connected, or while a ticket is in flight, does not open a second stream", async () => {
    globalThis.EventSource = ES;
    let release;
    let first = true;
    const { api } = await load({ routes: (url) => (first ? (first = false, new Promise((r) => { release = () => r(jsonRes(200, { ok: true, ticket: "A" })); })) : jsonRes(200, { ok: true, ticket: "B" })) });
    const h = api.stream({});
    await flush();
    env.listeners.visibilitychange[0](); // in flight
    await flush();
    expect(env.calls.length).toBe(1);
    release();
    await flush();
    expect(ES.all.length).toBe(1);
    env.listeners.visibilitychange[0](); // already connected
    await flush();
    expect(env.calls.length).toBe(1);
    expect(ES.all.length).toBe(1);
    h.close();
  });

  test("a ticket that arrives while hidden or after a source exists does not connect", async () => {
    globalThis.EventSource = ES;
    let release;
    const { api } = await load({ routes: () => new Promise((r) => { release = () => r(jsonRes(200, { ok: true, ticket: "A" })); }) });
    const h = api.stream({});
    await flush();
    env.doc.hidden = true;
    release();
    await flush();
    expect(ES.all).toEqual([]);
    h.close();
  });

  test("after a failed ticket the retry timer really retries", async () => {
    globalThis.EventSource = ES;
    let k = 0;
    const { api } = await load({ routes: () => (++k === 1 ? jsonRes(500, { ok: false }) : jsonRes(200, { ok: true, ticket: "R" })) });
    const h = api.stream({});
    await flush();
    env.timers.timeouts[0].fn();
    await flush();
    expect(ES.all.map((e) => e.url)).toEqual(["/api/v2/stream?ticket=R"]);
    h.close();
  });
});
