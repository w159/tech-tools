import { test, expect } from "bun:test";

// Minimal DOM stand-in (no DOM lib is installed): enough for h(), ChannelMessage and Composer.
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false; this.style = { setProperty() {} }; this.dataset = {}; this.value = ""; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = []; c.forEach((x) => x && this.appendChild(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  get firstChild() { return this.children[0] || null; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  set textContent(v) { this.children = [{ text: String(v) }]; }
  get textContent() { return this.children.map((c) => (c.text !== undefined ? c.text : c.textContent)).join(""); }
}
globalThis.Node = N;
globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false }), location: { href: "http://127.0.0.1:7421/", origin: "http://127.0.0.1:7421" } };
globalThis.location = window.location;
globalThis.navigator = {};
globalThis.sessionStorage = { getItem: () => null, setItem() {} };
globalThis.document = { createElement: (t) => new N(t), createElementNS: (_n, t) => new N(t), createTextNode: (t) => ({ text: t }), querySelector: () => null, documentElement: new N("html"), addEventListener() {}, body: new N("body") };

const { ChannelMessage, Composer } = await import("./ui-data.js");

const walk = (n, out = []) => { if (n && n.children) { out.push(n); n.children.forEach((c) => walk(c, out)); } return out; };
const tags = (n, t) => walk(n).filter((x) => x.tag === t);
const MSG = "see wX:p9 and /tmp/csql/.audit/REPORT.md:12 plus app/models.py";

test("plain channel message: paths stay text, only the pane id is a link", () => {
  const plain = ChannelMessage({ ts: 1, from: "lead", to: "all", body: MSG, onPane: () => {}, plain: true });
  expect(tags(plain, "a").length).toBe(1);
  expect(tags(plain, "button").length).toBe(0);
  const rich = ChannelMessage({ ts: 1, from: "lead", to: "all", body: MSG, onPane: () => {}, root: "/x" });
  expect(tags(rich, "button").length).toBeGreaterThan(0); // the Fleet inspector keeps linkified paths
});

test("plain channel message: delivery glyph only for refused/undeliverable, with title text", () => {
  const delivery = (status, plain) => walk(ChannelMessage({ ts: 1, from: "human", to: "x", body: "hi", status, plain })).filter((n) => n.attrs && n.attrs.class === "delivery" && n.attrs.title);
  expect(delivery("delivered", true).length).toBe(0);
  expect(delivery("read", true).length).toBe(0);
  const bad = delivery("undeliverable", true);
  expect(bad.length).toBe(1);
  expect(bad[0].attrs.title).toContain("Undeliverable");
  expect(delivery("delivered", false).length).toBe(1); // non-plain keeps every status glyph
});

test("simple composer: one textarea and Send, no Prompt agent | Post to channel switch; onSend always gets mode post", async () => {
  const sent = [];
  const c = Composer({ simple: true, placeholder: "Message everyone", onSend: async (mode, text) => { sent.push([mode, text]); } });
  const ctl = (t) => tags(c, t);
  expect(ctl("textarea").length).toBe(1);
  expect(ctl("textarea")[0].attrs.placeholder).toBe("Message everyone");
  expect(ctl("button").map((b) => b.textContent)).toEqual(["Send"]);
  expect(walk(c).some((n) => n.attrs && n.attrs.role === "radiogroup")).toBe(false);
  expect(c.attrs.class).toContain("cc-composer-simple");
  ctl("textarea")[0].value = "  hello  ";
  await ctl("button")[0].listeners.click();
  expect(sent).toEqual([["post", "hello"]]);
});

test("rail has one Agents item (Fleet/Board/Channel are the Agents page lens bar, not rail duplicates)", async () => {
  const src = await Bun.file(new URL("./app.js", import.meta.url)).text();
  const operate = /\{ id: "operate"[^\n]*/.exec(src)[0];
  expect(operate.match(/page: "agents"/g).length).toBe(1);
  expect(operate).not.toContain("lens:");
});
