// Test support: a small but real-enough DOM for dashboard component and page tests (bun has no DOM library).
// Unlike operate-dom-stub.js it has childNodes/text nodes, attribute selectors, descendant selectors, :not/:disabled,
// event bubbling, focus tracking (removing the focused node moves focus to <body>), classList, dataset <-> data-* attributes.
// installRichDom() swaps the globals in and returns the handles; restoreRichDom() puts back exactly what was there.

const kebab = (k) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const camel = (k) => k.replace(/-(\w)/g, (_m, c) => c.toUpperCase());

let DOC = null;

function parseCompound(src) {
  const c = { tag: null, id: null, classes: [], attrs: [], nots: [], pseudos: [] };
  let rest = src;
  let m = /^[A-Za-z][\w-]*|^\*/.exec(rest);
  if (m) { c.tag = m[0] === "*" ? null : m[0].toUpperCase(); rest = rest.slice(m[0].length); }
  while (rest) {
    if ((m = /^#([\w-]+)/.exec(rest))) c.id = m[1];
    else if ((m = /^\.([\w-]+)/.exec(rest))) c.classes.push(m[1]);
    else if ((m = /^\[([\w-]+)(?:([\^$*~|]?=)["']?([^\]"']*)["']?)?\]/.exec(rest))) c.attrs.push({ name: m[1], op: m[2] || null, val: m[3] });
    else if ((m = /^:not\(((?:[^()]|\([^()]*\))*)\)/.exec(rest))) c.nots.push(parseCompound(m[1]));
    else if ((m = /^:([\w-]+)/.exec(rest))) c.pseudos.push(m[1]);
    else throw new Error("rich-dom: unsupported selector part: " + rest);
    rest = rest.slice(m[0].length);
  }
  return c;
}

function splitTop(sel, sep) {
  const out = [];
  let depth = 0, q = false, cur = "";
  for (const ch of sel) {
    if (ch === '"') q = !q;
    if (!q && (ch === "(" || ch === "[")) depth++;
    if (!q && (ch === ")" || ch === "]")) depth--;
    if (!q && depth === 0 && ch === sep) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSelector(sel) {
  return splitTop(sel, ",").map((part) => {
    const toks = [];
    let depth = 0, q = false, cur = "";
    const flush = () => { if (cur) toks.push(cur); cur = ""; };
    for (const ch of part.trim()) {
      if (ch === '"') q = !q;
      if (!q && (ch === "(" || ch === "[")) depth++;
      if (!q && (ch === ")" || ch === "]")) depth--;
      if (!q && depth === 0 && (ch === " " || ch === ">")) { flush(); if (ch === ">") toks.push(">"); } else cur += ch;
    }
    flush();
    const chain = [];
    let comb = " ";
    for (const t of toks) { if (t === ">") comb = ">"; else { chain.push({ comb, c: parseCompound(t) }); comb = " "; } }
    return chain;
  });
}

function matchCompound(n, c) {
  if (n.nodeType !== 1) return false;
  if (c.tag && n.tagName.toUpperCase() !== c.tag) return false;
  if (c.id && n.getAttribute("id") !== c.id) return false;
  for (const k of c.classes) if (!n.classList.contains(k)) return false;
  for (const a of c.attrs) {
    const v = n.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === "=" && v !== a.val) return false;
    if (a.op === "^=" && !v.startsWith(a.val)) return false;
    if (a.op === "$=" && !v.endsWith(a.val)) return false;
    if (a.op === "*=" && !v.includes(a.val)) return false;
  }
  for (const p of c.pseudos) {
    if (p === "disabled" && n.disabled !== true) return false;
    if (p === "enabled" && n.disabled === true) return false;
    if (p === "checked" && n.checked !== true) return false;
  }
  for (const nc of c.nots) if (matchCompound(n, nc)) return false;
  return true;
}

function matchChain(n, chain, i = chain.length - 1) {
  if (!matchCompound(n, chain[i].c)) return false;
  if (i === 0) return true;
  const comb = chain[i].comb;
  if (comb === ">") return Boolean(n.parentNode) && matchChain(n.parentNode, chain, i - 1);
  for (let p = n.parentNode; p; p = p.parentNode) if (matchChain(p, chain, i - 1)) return true;
  return false;
}

class RNode {
  constructor(nodeType, tagName) {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.nodeName = tagName;
    this.parentNode = null;
    this.childNodes = [];
    this._attrs = new Map();
    this._listeners = {};
    this._style = {};
    this.hidden = false;
  }
  get tag() { return this.tagName && this.tagName.toLowerCase(); }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get previousSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) - 1] || null : null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === DOC.documentElement; }
  get offsetParent() { return this.isConnected ? this.parentNode : null; }
  get offsetWidth() { return this.isConnected ? this._w ?? 0 : 0; }
  set offsetWidth(v) { this._w = v; }
  get offsetLeft() { return this._left ?? 0; }
  set offsetLeft(v) { this._left = v; }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  get classList() {
    const n = this;
    const get = () => (n.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    const set = (a) => n.setAttribute("class", a.join(" "));
    return {
      add: (...c) => set([...new Set([...get(), ...c])]),
      remove: (...c) => set(get().filter((x) => !c.includes(x))),
      contains: (c) => get().includes(c),
      toggle: (c, force) => { const has = get().includes(c); const on = force === undefined ? !has : Boolean(force); if (on && !has) set([...get(), c]); if (!on && has) set(get().filter((x) => x !== c)); return on; },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  get dataset() {
    const n = this;
    return new Proxy({}, {
      get: (_t, k) => { const v = n.getAttribute("data-" + kebab(String(k))); return v === null ? undefined : v; },
      set: (_t, k, v) => { n.setAttribute("data-" + kebab(String(k)), v); return true; },
      has: (_t, k) => n.getAttribute("data-" + kebab(String(k))) !== null,
      ownKeys: () => n.attributes.filter((a) => a.name.startsWith("data-")).map((a) => camel(a.name.slice(5))),
      getOwnPropertyDescriptor: (_t, k) => (n.getAttribute("data-" + kebab(String(k))) === null ? undefined : { enumerable: true, configurable: true, value: n.getAttribute("data-" + kebab(String(k))) }),
    });
  }
  get style() {
    const st = this._style;
    return new Proxy(st, { get: (t, k) => (k === "setProperty" ? (p, v) => { t[p] = v; } : k === "removeProperty" ? (p) => { delete t[p]; } : k === "getPropertyValue" ? (p) => t[p] ?? "" : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
  }
  get tabIndex() { const v = this.getAttribute("tabindex"); return v === null ? -1 : Number(v); }
  set tabIndex(v) { this.setAttribute("tabindex", v); }
  get type() { return this.getAttribute("type") || (this.tagName === "BUTTON" ? "submit" : this.tagName === "INPUT" ? "text" : ""); }
  set type(v) { this.setAttribute("type", v); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  setAttribute(k, v) { this._attrs.set(k, String(v)); }
  removeAttribute(k) { this._attrs.delete(k); }
  hasAttribute(k) { return this._attrs.has(k); }
  get open() { return this._attrs.has("open"); }
  set open(v) { if (v) this.setAttribute("open", ""); else this.removeAttribute("open"); }
  cloneNode(deep) {
    const c = this.nodeType === 3 ? DOC.createTextNode(this.nodeValue) : DOC.createElement(this.tagName);
    for (const [k, v] of this._attrs) c.setAttribute(k, v);
    if (deep) for (const k of this.childNodes) c.appendChild(k.cloneNode(true));
    return c;
  }
  isEqualNode(o) {
    if (!o || o.nodeType !== this.nodeType) return false;
    if (this.nodeType === 3) return this.nodeValue === o.nodeValue;
    if (this.tagName !== o.tagName) return false;
    const a = this.attributes, b = o.attributes;
    if (a.length !== b.length || a.some((x) => o.getAttribute(x.name) !== x.value)) return false;
    if (this.childNodes.length !== o.childNodes.length) return false;
    return this.childNodes.every((c, i) => c.isEqualNode(o.childNodes[i]));
  }
  _detach(c) { if (c.parentNode) c.parentNode.removeChild(c); }
  appendChild(c) { this._detach(c); c.parentNode = this; this.childNodes.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(typeof c === "string" ? DOC.createTextNode(c) : c)); }
  prepend(...cs) { cs.reverse().forEach((c) => this.insertBefore(typeof c === "string" ? DOC.createTextNode(c) : c, this.firstChild)); }
  insertBefore(c, ref) {
    if (!ref) return this.appendChild(c);
    this._detach(c);
    c.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i < 0) throw new Error("rich-dom: removeChild of a non-child");
    const active = DOC && DOC.activeElement;
    this.childNodes.splice(i, 1);
    c.parentNode = null;
    if (active && c.contains(active)) DOC.activeElement = DOC.body;
    return c;
  }
  replaceChild(nu, old) { this.insertBefore(nu, old); this.removeChild(old); return old; }
  replaceChildren(...cs) { [...this.childNodes].forEach((c) => this.removeChild(c)); cs.forEach((c) => this.appendChild(typeof c === "string" ? DOC.createTextNode(c) : c)); }
  replaceWith(...cs) { const p = this.parentNode; if (!p) return; cs.forEach((c) => p.insertBefore(c, this)); p.removeChild(this); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { if (this.nodeType === 3) { this.nodeValue = String(v); return; } this.replaceChildren(...(v === "" || v === null || v === undefined ? [] : [DOC.createTextNode(v)])); }
  matches(sel) { return parseSelector(sel).some((ch) => matchChain(this, ch)); }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) {
    const chains = parseSelector(sel);
    const out = [];
    const walk = (n) => n.childNodes.forEach((c) => { if (c.nodeType === 1) { if (chains.some((ch) => matchChain(c, ch))) out.push(c); walk(c); } });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== fn); }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    ev.bubbles = ev.bubbles !== false;
    let stopped = false;
    ev.stopPropagation = () => { stopped = true; };
    ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; });
    for (let n = this; n && !stopped; n = n.parentNode) {
      ev.currentTarget = n;
      for (const f of [...(n._listeners[ev.type] || [])]) f(ev);
      if (!ev.bubbles) break;
    }
    if (!stopped && ev.type === "click" && typeof this.onclick === "function") this.onclick(ev);
    return !ev.defaultPrevented;
  }
  click() { if (this.disabled === true) return; this.dispatchEvent({ type: "click" }); }
  focus() { if (this.isConnected) { DOC.activeElement = this; this.focusCalls = (this.focusCalls || 0) + 1; } }
  blur() { if (DOC.activeElement === this) DOC.activeElement = DOC.body; }
  select() { this.selected = true; }
  scrollIntoView() { this.scrolledIntoView = (this.scrolledIntoView || 0) + 1; }
  getBoundingClientRect() { return this.rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}

class RText extends RNode {
  constructor(text) { super(3, "#text"); this.nodeValue = String(text); }
}

function makeDocument() {
  const listeners = {};
  const html = new RNode(1, "HTML");
  const body = new RNode(1, "BODY");
  const head = new RNode(1, "HEAD");
  const d = {
    documentElement: html, body, head, hidden: false, title: "", cookie: "", activeElement: null, readyState: "complete",
    createElement(t) {
      const n = new RNode(1, String(t).toUpperCase());
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) { n.value = ""; n.checked = false; }
      return n;
    },
    createElementNS(ns, t) { const n = new RNode(1, t); n.namespaceURI = ns; return n; },
    createTextNode: (t) => new RText(t),
    getElementById: (id) => html.querySelector("#" + id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    dispatchEvent(ev) { ev.target = ev.target || d; ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; }); for (const f of [...(listeners[ev.type] || [])]) f(ev); return !ev.defaultPrevented; },
    listenerCount: (t) => (listeners[t] || []).length,
  };
  html.appendChild(head);
  html.appendChild(body);
  d.activeElement = body;
  return d;
}

const NAMES = ["document", "window", "Node", "location", "navigator", "innerWidth", "innerHeight", "getComputedStyle", "requestAnimationFrame", "localStorage", "sessionStorage"];
let saved = null;

/** Installs the DOM globals. Returns { doc, body, root(id) } where root(id) adds a <div id> to <body> (toast-root etc). */
export function installRichDom({ width = 1440, height = 900, hash = "", search = "", base = "" } = {}) {
  saved = Object.fromEntries(NAMES.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const doc = makeDocument();
  DOC = doc;
  const winL = {};
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear() }; };
  const location = { href: "http://127.0.0.1:7421/", origin: "http://127.0.0.1:7421", hash, search, pathname: "/", assign() {}, replace() {} };
  const win = {
    document: doc, location, innerWidth: width, innerHeight: height, isSecureContext: false,
    addEventListener: (t, fn) => { (winL[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { winL[t] = (winL[t] || []).filter((f) => f !== fn); },
    dispatchEvent(ev) { for (const f of [...(winL[ev.type] || [])]) f(ev); return true; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }),
    listenerCount: (t) => (winL[t] || []).length,
  };
  win.self = win;
  win.top = win;
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  def("document", doc);
  def("window", win);
  def("Node", RNode);
  def("location", location);
  def("navigator", {});
  def("innerWidth", width);
  def("innerHeight", height);
  def("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  def("requestAnimationFrame", (fn) => { fn(0); return 1; });
  def("localStorage", store());
  def("sessionStorage", store());
  if (base) {
    const meta = doc.createElement("meta");
    meta.setAttribute("name", "atlas-base");
    meta.setAttribute("content", base);
    meta.content = base;
    doc.head.appendChild(meta);
  }
  const root = (id) => { const n = doc.createElement("div"); n.setAttribute("id", id); doc.body.appendChild(n); return n; };
  return { doc, body: doc.body, win, root, setSize(w, h2) { globalThis.innerWidth = w; globalThis.innerHeight = h2; win.innerWidth = w; win.innerHeight = h2; } };
}

export function restoreRichDom() {
  if (!saved) return;
  for (const k of NAMES) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
    else delete globalThis[k];
  }
  saved = null;
  DOC = null;
}

/** Fires an event on a node with extra fields (key, shiftKey, target ...); returns the event. */
export function fire(node, type, props = {}) {
  const ev = { type, ...props };
  node.dispatchEvent(ev);
  return ev;
}

