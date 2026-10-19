import { expect, test } from "bun:test";

test("connectPty shows the placeholder at once and clears it before the first PTY byte", async () => {
  const sockets = [];
  globalThis.document = { querySelector: () => null };
  globalThis.location = { protocol: "http:", host: "x" };
  globalThis.WebSocket = class { constructor(u) { this.url = u; this.readyState = 0; sockets.push(this); } send() {} close() {} };
  const { connectPty } = await import("./pages/terminal.js");
  const out = [];
  const term = { cols: 80, rows: 24, write: (d) => out.push(d), onData: () => null, onBinary: () => null, onResize: () => null };
  const pty = connectPty({ term, kind: "tui", onStatus: () => {}, placeholder: "starting Atlas Command Center…" });
  expect(out).toEqual(["starting Atlas Command Center…"]);
  sockets[0].onmessage({ data: new ArrayBuffer(1) });
  sockets[0].onmessage({ data: new ArrayBuffer(1) });
  expect(out[1]).toBe("\x1b[2J\x1b[H"); // wiped once, then the real byte
  expect(out.length).toBe(4);
  pty.dispose();
});
