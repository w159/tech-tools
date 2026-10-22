// Minimal DOM stand-in for the operate-surface tests (no DOM library is installed). Installs globals on import.
export class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.parent = null; this.style = { setProperty() {} }; this.dataset = {}; this.classList = { toggle() {}, remove() {}, add() {} }; this.isConnected = false; }
  appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); c.parent = this; this.children.push(c); return c; }
  append(...c) { c.forEach((x) => this.appendChild(x)); }
  replaceChildren(...c) { this.children = []; c.forEach((x) => x && this.appendChild(x)); }
  replaceWith(n) { const p = this.parent; if (!p) return; p.children = p.children.map((x) => (x === this ? n : x)); n.parent = p; this.parent = null; }
  insertBefore(c) { return this.appendChild(c); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); }
  removeEventListener() {}
  click() { (this.listeners.click || []).forEach((f) => f({ currentTarget: this, target: this, preventDefault() {} })); }
  contains() { return false; }
  closest() { return null; }
  focus() {}
  get firstChild() { return this.children[0]; }
  get className() { return this.attrs.class || ""; }
  set className(v) { this.attrs.class = v; }
  set textContent(v) { this.children = []; if (v) this.appendChild(new T(v)); }
  get textContent() { return this.tag === "#text" ? this.text : this.children.map((c) => c.textContent).join(""); }
  matches(sel) {
    if (sel[0] === "#") return this.attrs.id === sel.slice(1);
    const parts = sel.split(".").filter(Boolean);
    const tag = sel[0] === "." ? "" : parts.shift();
    return (!tag || this.tag === tag) && parts.every((p) => this.className.split(/\s+/).includes(p));
  }
  querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches && c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
class T extends N { constructor(text) { super("#text"); this.text = String(text); } }
const SELF = {};
export const body = new N("body");
const stubs = () => ({
  Node: N,
  window: { self: SELF, top: SELF, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, innerWidth: 1440, matchMedia: () => ({ matches: true }), location: { href: "http://127.0.0.1:7421/", origin: "http://127.0.0.1:7421", hash: "" } },
  navigator: {},
  sessionStorage: { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, x) { this.v[k] = String(x); } },
  document: { createElement: (t) => new N(t), createElementNS: (_n, t) => new N(t), createTextNode: (t) => new T(t), getElementById: (id) => body.querySelector("#" + id), querySelector: () => null, querySelectorAll: () => [], documentElement: new N("html"), addEventListener() {}, removeEventListener() {}, body, activeElement: null, hidden: false },
});
// Other test files install their own globals at import time, so each test file installs this stub in beforeEach
// and restores the previous globals in afterEach.
let saved = null;
export function installDom() {
  const next = stubs();
  next.location = next.window.location;
  saved = Object.fromEntries(Object.keys(next).map((k) => [k, globalThis[k]]));
  Object.assign(globalThis, next);
  body.isConnected = true;
  body.replaceChildren();
}
export function restoreDom() { if (saved) Object.assign(globalThis, saved); saved = null; }
export const buttonsOf = (root) => root.querySelectorAll("button").map((b) => b.textContent);
