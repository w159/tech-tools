import { test, expect, describe, beforeEach, afterEach } from "bun:test";

const { connectPty } = await import("./pages/terminal.js");

describe("connectPty", () => {
  let saved;
  let sockets;
  let timers;
  let nextId;
  beforeEach(() => {
    saved = { document: globalThis.document, location: globalThis.location, WebSocket: globalThis.WebSocket, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    sockets = [];
    timers = [];
    nextId = 1;
    globalThis.document = { querySelector: () => null };
    globalThis.location = { protocol: "http:", host: "h:1" };
    globalThis.WebSocket = class {
      constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.closed = false; sockets.push(this); }
      send(d) { this.sent.push(JSON.parse(d)); }
      close() { this.closed = true; this.readyState = 3; }
    };
    globalThis.setTimeout = (fn, ms) => { const t = { id: nextId++, fn, ms, cleared: false }; timers.push(t); return t.id; };
    globalThis.clearTimeout = (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; };
  });
  afterEach(() => { Object.assign(globalThis, saved); });

  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const live = () => timers.filter((t) => !t.cleared);
  const mkTerm = () => {
    const t = { cols: 100, rows: 30, out: [], handlers: {}, disposed: 0 };
    t.write = (d) => t.out.push(d);
    t.onData = (fn) => { t.handlers.data = fn; return { dispose: () => { t.disposed++; } }; };
    t.onBinary = (fn) => { t.handlers.bin = fn; return { dispose: () => { t.disposed++; } }; };
    t.onResize = (fn) => { t.handlers.resize = fn; return { dispose: () => { t.disposed++; } }; };
    return t;
  };
  const start = (over = {}) => {
    const term = mkTerm();
    const status = [];
    const pty = connectPty({ term, kind: "pane", target: "%1", onStatus: (k, t) => status.push([k, t]), ...over });
    return { term, status, pty };
  };

  test("connects at once, goes live on open and announces the terminal size", () => {
    const { status } = start();
    expect(status).toEqual([["connecting", "connecting…"]]);
    expect(sockets[0].binaryType).toBe("arraybuffer");
    expect(sockets[0].url).toBe("ws://h:1/api/v2/term/ws?kind=pane&cols=100&rows=30&target=%251");
    sockets[0].readyState = 1;
    sockets[0].onopen();
    expect(status.at(-1)).toEqual(["live", "live"]);
    expect(sockets[0].sent).toEqual([{ t: "resize", cols: 100, rows: 30 }]);
  });

  test("the retry delay doubles from 1s and caps at 10s; a successful open starts the count over", () => {
    const { status } = start();
    const waits = [];
    for (let i = 0; i < 6; i++) {
      sockets.at(-1).onclose();
      waits.push([status.at(-1)[1], live().at(-1).ms]);
      live().at(-1).fn();
    }
    expect(waits).toEqual([
      ["disconnected, retrying in 1s", 1000], ["disconnected, retrying in 2s", 2000], ["disconnected, retrying in 4s", 4000],
      ["disconnected, retrying in 8s", 8000], ["disconnected, retrying in 10s", 10000], ["disconnected, retrying in 10s", 10000],
    ]);
    expect(status.at(-1)).toEqual(["connecting", "reconnecting…"]);
    sockets.at(-1).readyState = 1;
    sockets.at(-1).onopen();
    sockets.at(-1).onclose();
    expect(status.at(-1)).toEqual(["closed", "disconnected, retrying in 1s"]);
  });

  test("reconnect() drops the old socket and timer, forgets the backoff and says connecting, not reconnecting", () => {
    const { status, pty } = start();
    sockets[0].onclose();
    live().at(-1).fn();
    sockets.at(-1).onclose();
    expect(live().at(-1).ms).toBe(2000);
    const pending = live().at(-1);
    const old = sockets.at(-1);
    const before = sockets.length;
    pty.reconnect();
    expect(pending.cleared).toBe(true);
    expect(old.closed).toBe(true);
    expect(old.onclose).toBeNull();
    expect(status.at(-1)).toEqual(["connecting", "connecting…"]);
    expect(sockets.length).toBe(before + 1);
    sockets.at(-1).onclose();
    expect(status.at(-1)).toEqual(["closed", "disconnected, retrying in 1s"]);
  });

  test("reconnect() shows the placeholder again and wipes it before the next first byte", () => {
    const { term, pty } = start({ placeholder: "waiting…" });
    sockets[0].onmessage({ data: new ArrayBuffer(1) });
    expect(term.out).toEqual(["waiting…", "\x1b[2J\x1b[H", "<bytes>"].map((x) => (x === "<bytes>" ? expect.any(Uint8Array) : x)));
    pty.reconnect();
    expect(term.out.at(-1)).toBe("waiting…");
    sockets.at(-1).onmessage({ data: "text" });
    expect(term.out.slice(-2)).toEqual(["\x1b[2J\x1b[H", "text"]);
    const none = start();
    none.pty.reconnect();
    expect(none.term.out).toEqual([]);
  });

  test("a ticket is fetched for every (re)connect with the target, size and project, and goes on the URL", async () => {
    const bodies = [];
    const { status } = start({ project: "/p", cwd: "/w", fetchTicket: async (b) => { bodies.push(b); return "TK" + bodies.length; } });
    expect(status).toEqual([["connecting", "connecting…"]]);
    await flush();
    expect(bodies).toEqual([{ kind: "pane", cols: 100, rows: 30, target: "%1", project: "/p", cwd: "/w" }]);
    expect(sockets[0].url).toBe("ws://h:1/api/v2/term/ws?kind=pane&cols=100&rows=30&ticket=TK1&target=%251&project=%2Fp&cwd=%2Fw");
    sockets[0].onclose();
    live().at(-1).fn();
    await flush();
    expect(sockets[1].url).toContain("ticket=TK2");
  });

  test("project all and absent target/cwd stay off the ticket and URL", async () => {
    const bodies = [];
    start({ kind: "shell", target: undefined, project: "all", fetchTicket: async (b) => { bodies.push(b); return "T"; } });
    await flush();
    expect(bodies).toEqual([{ kind: "shell", cols: 100, rows: 30 }]);
    expect(sockets[0].url).toBe("ws://h:1/api/v2/term/ws?kind=shell&cols=100&rows=30&ticket=T");
    location.protocol = "https:";
    start({ kind: "tui", target: undefined });
    expect(sockets[1].url.startsWith("wss://h:1/")).toBe(true);
  });

  test("a 4xx ticket refusal is final and shows the server's reason; other failures keep retrying", async () => {
    const a = start({ fetchTicket: async () => { throw Object.assign(new Error("m"), { status: 403, error: "forbidden", why: "bad token" }); } });
    await flush();
    expect(a.status.at(-1)).toEqual(["error", "refused by server: forbidden (bad token)"]);
    expect(sockets.length).toBe(0);
    expect(live().length).toBe(0);
    const b = start({ fetchTicket: async () => { throw Object.assign(new Error("only message"), { status: 400 }); } });
    await flush();
    expect(b.status.at(-1)).toEqual(["error", "refused by server: only message"]);
    for (const err of [Object.assign(new Error("x"), { status: 500 }), new Error("offline"), null, Object.assign(new Error("x"), { status: 399 })]) {
      timers.length = 0;
      const c = start({ fetchTicket: async () => { throw err; } });
      await flush();
      expect(c.status.at(-1)).toEqual(["closed", "disconnected, retrying in 1s"]);
      expect(live().length).toBe(1);
    }
  });

  test("a probe 4xx after a ws close replaces the retry with the refusal; a 5xx probe does not", async () => {
    const a = start({ probe: async () => { throw Object.assign(new Error("m"), { status: 401, error: "unauthorized" }); } });
    const retry = live().at(-1);
    sockets[0].onclose();
    await flush();
    expect(a.status.at(-1)).toEqual(["error", "refused by server: unauthorized"]);
    expect(retry).toBeUndefined(); // nothing was pending before the close
    expect(live().length).toBe(0); // the retry scheduled by the close was cancelled by the refusal
    const calls = [];
    const b = start({ probe: async () => { calls.push(1); throw Object.assign(new Error("m"), { status: 502 }); } });
    sockets.at(-1).onclose();
    await flush();
    expect(calls.length).toBe(1);
    expect(b.status.at(-1)[0]).toBe("closed");
  });

  test("no byte within noFrameMs of opening calls onNoFrame once; the first byte cancels it and reports onFrame", () => {
    const events = [];
    start({ noFrameMs: 5000, onNoFrame: () => events.push("none"), onFrame: () => events.push("frame") });
    const t = live().find((x) => x.ms === 5000);
    expect(t).toBeDefined();
    t.fn();
    expect(events).toEqual(["none"]);
    const second = start({ noFrameMs: 5000, onNoFrame: () => events.push("none2"), onFrame: () => events.push("frame2") });
    const t2 = live().filter((x) => x.ms === 5000).at(-1);
    sockets.at(-1).onmessage({ data: "x" });
    sockets.at(-1).onmessage({ data: "y" });
    expect(t2.cleared).toBe(true);
    expect(events).toEqual(["none", "frame2"]);
    second.pty.dispose();
    const off = start({ onNoFrame: () => events.push("never") });
    sockets.at(-1).onclose();
    expect(off.status.at(-1)[0]).toBe("closed");
  });

  test("onNoFrame is not called after dispose", () => {
    const events = [];
    const { pty } = start({ noFrameMs: 3000, onNoFrame: () => events.push("none") });
    const t = live().find((x) => x.ms === 3000);
    pty.dispose();
    t.fn();
    expect(events).toEqual([]);
  });

  test("terminal input, binary input and resizes go out as JSON, only while the socket is open", () => {
    const { term } = start();
    term.handlers.data("a");
    expect(sockets[0].sent).toEqual([]);
    sockets[0].readyState = 1;
    term.handlers.data("ls\r");
    term.handlers.bin("\x01");
    term.handlers.resize({ cols: 120, rows: 40 });
    expect(sockets[0].sent).toEqual([{ t: "in", d: "ls\r" }, { t: "bin", d: "\x01" }, { t: "resize", cols: 120, rows: 40 }]);
  });

  test("frames are written as text or bytes", () => {
    const { term } = start();
    sockets[0].onmessage({ data: "hello" });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    sockets[0].onmessage({ data: bytes });
    expect(term.out[0]).toBe("hello");
    expect(Array.from(term.out[1])).toEqual([1, 2, 3]);
  });

  test("a terminal without a size falls back to 80x24", () => {
    const term = mkTerm();
    term.cols = 0;
    term.rows = undefined;
    connectPty({ term, kind: "tui", onStatus: () => {} });
    expect(sockets[0].url).toContain("cols=80&rows=24");
  });

  test("dispose() closes the socket quietly, cancels retries, ignores late closes and disposes the input subscriptions", () => {
    const { term, status, pty } = start();
    const ws = sockets[0];
    sockets[0].onclose();
    const retry = live().at(-1);
    live().at(-1).fn();
    const ws2 = sockets.at(-1);
    const n = status.length;
    pty.dispose();
    expect(ws2.closed).toBe(true);
    expect(ws2.onclose).toBeNull();
    expect(term.disposed).toBe(3);
    expect(retry).toBeDefined();
    expect(ws.closed).toBe(false);
    ws.onclose();
    expect(status.length).toBe(n);
    expect(live().filter((t) => t.ms === 2000).length).toBe(0);
  });

  test("dispose() while a ticket is still being fetched never opens a socket", async () => {
    let release;
    const { pty } = start({ fetchTicket: () => new Promise((r) => { release = r; }) });
    await flush();
    pty.dispose();
    release("late");
    await flush();
    expect(sockets.length).toBe(0);
  });

  test("a socket that throws on close during reconnect is tolerated", () => {
    const { pty, status } = start();
    sockets[0].close = () => { throw new Error("already closed"); };
    pty.reconnect();
    expect(status.at(-1)).toEqual(["connecting", "connecting…"]);
    expect(sockets.length).toBe(2);
  });
});
