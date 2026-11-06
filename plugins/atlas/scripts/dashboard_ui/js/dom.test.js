import { test, expect, describe, beforeEach, afterEach } from "bun:test";

// A small real-enough DOM: nodeType, attributes, childNodes, isEqualNode, replaceChild, focus. The shared operate stub
// has none of these, and patchInto needs all of them.
class MNode {
  constructor(nodeType, tagName) { this.nodeType = nodeType; this.tagName = tagName; this.parentNode = null; this.childNodes = []; this.attrMap = new Map(); this.styleMap = {}; this.dataset = {}; this.listeners = {}; this.nodeValue = null; }
  get attributes() { return [...this.attrMap].map(([name, value]) => ({ name, value })); }
  get style() { const m = this.styleMap; return new Proxy(m, { get: (t, k) => (k === "setProperty" ? (p, v) => { t[p] = v; } : t[k]), set: (t, k, v) => { t[k] = v; return true; } }); }
  get firstChild() { return this.childNodes[0] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.body || n === doc.root; }
  setAttribute(k, v) { this.attrMap.set(k, String(v)); }
  getAttribute(k) { return this.attrMap.has(k) ? this.attrMap.get(k) : null; }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c; }
  replaceChild(nu, old) { if (nu.parentNode) nu.parentNode.removeChild(nu); this.childNodes[this.childNodes.indexOf(old)] = nu; nu.parentNode = this; old.parentNode = null; return old; }
  replaceChildren(...c) { this.childNodes.forEach((x) => { x.parentNode = null; }); this.childNodes = []; c.forEach((x) => this.appendChild(x)); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  matches(sel) { return sel.split(",").some((s) => s.trim().toUpperCase() === this.tagName); }
  querySelectorAll(sel) { const out = []; const walk = (n) => n.childNodes.forEach((c) => { if (c.nodeType === 1 && c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(""); }
  isEqualNode(o) {
    if (this.nodeType !== o.nodeType || this.tagName !== o.tagName || this.nodeValue !== o.nodeValue) return false;
    if (JSON.stringify(this.attributes) !== JSON.stringify(o.attributes)) return false;
    return this.childNodes.length === o.childNodes.length && this.childNodes.every((c, i) => c.isEqualNode(o.childNodes[i]));
  }
  focus() { doc.activeElement = this; this.focusCalls = (this.focusCalls || 0) + 1; }
  select() { this.selected = true; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}
const el = (t) => { const n = new MNode(1, t.toUpperCase()); if (/^(input|textarea|select)$/i.test(t)) { n.value = ""; n.defaultValue = ""; n.checked = false; n.defaultChecked = false; n.type = "text"; } return n; };
const doc = { root: new MNode(1, "HTML"), body: new MNode(1, "BODY"), activeElement: null, main: null, hidden: false,
  createElement: el, createElementNS: (_ns, t) => { const n = new MNode(1, t); n.ns = _ns; return n; }, createTextNode: (t) => { const n = new MNode(3, "#text"); n.nodeValue = String(t); return n; },
  getElementById: (id) => (id === "main" ? doc.main : null), addEventListener() {}, removeEventListener() {}, querySelector: () => null };
const GLOBALS = ["document", "Node", "navigator", "window", "clearTimeout", "setTimeout"];
const saved = {};
for (const k of GLOBALS) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
let dom;
beforeEach(async () => {
  doc.body = new MNode(1, "BODY");
  doc.activeElement = null;
  doc.main = null;
  globalThis.document = doc;
  globalThis.Node = MNode;
  dom = await import("./dom.js");
});
afterEach(() => { for (const k of GLOBALS) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; } });

const text = (n) => n.textContent;

describe("h / s / append / replace / clear", () => {
  test("h builds an element with class, array class and text children; null/false/true children are dropped", () => {
    const n = dom.h("div", { class: ["a", null, "b"] }, "x", null, false, true, 7, [dom.h("b", null, "y")]);
    expect(n.tagName).toBe("DIV");
    expect(n.getAttribute("class")).toBe("a b");
    expect(text(n)).toBe("x7y");
    expect(n.childNodes.map((c) => c.nodeType)).toEqual([3, 3, 1]);
  });
  test("className is the same as class", () => {
    expect(dom.h("p", { className: "k" }).getAttribute("class")).toBe("k");
  });
  test("props: style object (custom props via setProperty), dataset, events, value, boolean flags, plain attrs", () => {
    const clicks = [];
    const n = dom.h("input", { style: { color: "red", "--x": 3 }, dataset: { a: 1, b: null }, onClick: () => clicks.push(1), value: "v", disabled: true, checked: false, title: "t", "aria-hidden": true, hidden: 0 });
    expect(n.styleMap).toEqual({ color: "red", "--x": "3" });
    expect(n.dataset).toEqual({ a: "1" });
    n.listeners.click[0]();
    expect(clicks).toEqual([1]);
    expect(n.value).toBe("v");
    expect(n.disabled).toBe(true);
    expect(n.getAttribute("disabled")).toBe("");
    expect(n.getAttribute("checked")).toBeNull();
    expect(n.getAttribute("title")).toBe("t");
    expect(n.getAttribute("aria-hidden")).toBe("");
  });
  test("null, undefined and false props are skipped", () => {
    const n = dom.h("div", { a: null, b: undefined, c: false, d: "ok" });
    expect(n.attributes).toEqual([{ name: "d", value: "ok" }]);
  });
  test("html / innerHTML / outerHTML props are refused", () => {
    for (const k of ["html", "innerHTML", "outerHTML"]) expect(() => dom.h("div", { [k]: "<b>" })).toThrow(`'${k}' is forbidden`);
  });
  test("a non-function on* prop falls through to a plain attribute; function on* on svg still binds", () => {
    expect(dom.h("div", { onclick: "x" }).getAttribute("onclick")).toBe("x");
    const sv = dom.s("g", { onClick() {} });
    expect(sv.listeners.click).toHaveLength(1);
  });
  test("s creates SVG-namespace nodes and treats value/disabled as plain attributes", () => {
    const n = dom.s("rect", { value: "q", disabled: true, width: 3 }, dom.s("title", null, "t"));
    expect(n.ns).toBe("http://www.w3.org/2000/svg");
    expect(n.getAttribute("value")).toBe("q");
    expect(n.getAttribute("disabled")).toBe("");
    expect(n.disabled).toBeUndefined();
    expect(n.getAttribute("width")).toBe("3");
    expect(n.childNodes).toHaveLength(1);
  });
  test("icon: known name draws its paths; unknown falls back to help; attrs override defaults", () => {
    const a = dom.icon("plus");
    expect(a.getAttribute("class")).toBe("icon");
    expect(a.getAttribute("aria-hidden")).toBe("true");
    expect(a.childNodes.map((p) => p.getAttribute("d"))).toEqual(["M12 5v14", "M5 12h14"]);
    const unknown = dom.icon("nope", { class: "big" });
    expect(unknown.getAttribute("class")).toBe("big");
    expect(unknown.childNodes.map((p) => p.getAttribute("d"))).toEqual(dom.icon("help").childNodes.map((p) => p.getAttribute("d")));
  });
  test("clear removes every child and returns the node", () => {
    const n = dom.h("div", null, "a", dom.h("b"));
    expect(dom.clear(n)).toBe(n);
    expect(n.childNodes).toHaveLength(0);
  });
  test("append drops nullish/boolean children and returns the parent", () => {
    const n = dom.h("div");
    expect(dom.append(n, "a", null, [undefined, "b"], false)).toBe(n);
    expect(text(n)).toBe("ab");
  });
  test("replace swaps content with flattened, filtered children", () => {
    const n = dom.h("div", null, "old");
    const kid = dom.h("i");
    expect(dom.replace(n, [[kid, null]], false, undefined, true)).toBe(n);
    expect(n.childNodes).toEqual([kid]);
  });
});

describe("debounce", () => {
  test("coalesces calls and runs with the last arguments after ms; cancel drops it", () => {
    const timers = new Map();
    let id = 0;
    globalThis.setTimeout = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
    globalThis.clearTimeout = (i) => { timers.delete(i); };
    const calls = [];
    const d = dom.debounce((...a) => calls.push(a), 120);
    d(1); d(2); d(3);
    expect(timers.size).toBe(1);
    const [[tid, t]] = [...timers];
    expect(t.ms).toBe(120);
    timers.delete(tid);
    t.fn();
    expect(calls).toEqual([[3]]);
    d(4);
    d.cancel();
    expect(timers.size).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe("copyText", () => {
  test("uses the async clipboard in a secure context", async () => {
    let w;
    globalThis.navigator = { clipboard: { writeText: async (t) => { w = t; } } };
    globalThis.window = { isSecureContext: true };
    expect(await dom.copyText(42)).toBe(true);
    expect(w).toBe("42");
    expect(doc.body.childNodes).toHaveLength(0);
  });
  test("falls back to a hidden textarea + execCommand when the clipboard rejects, and cleans up", async () => {
    globalThis.navigator = { clipboard: { writeText: async () => { throw new Error("denied"); } } };
    globalThis.window = { isSecureContext: true };
    let seen;
    doc.execCommand = (c) => { seen = [c, doc.body.childNodes[0].value, doc.body.childNodes[0].selected]; return true; };
    expect(await dom.copyText("abc")).toBe(true);
    expect(seen).toEqual(["copy", "abc", true]);
    expect(doc.body.childNodes).toHaveLength(0);
    delete doc.execCommand;
  });
  test("insecure context skips the clipboard API; a throwing execCommand reports false", async () => {
    let used = false;
    globalThis.navigator = { clipboard: { writeText: async () => { used = true; } } };
    globalThis.window = { isSecureContext: false };
    doc.execCommand = () => { throw new Error("nope"); };
    expect(await dom.copyText("abc")).toBe(false);
    expect(used).toBe(false);
    delete doc.execCommand;
  });
});

describe("time and status formatting", () => {
  const realNow = Date.now;
  afterEach(() => { Date.now = realNow; });
  const at = (iso) => { Date.now = () => Date.parse(iso); };
  test("fmtRelative: never / just now / durations / future / bad input", () => {
    at("2026-01-01T12:00:00Z");
    expect(dom.fmtRelative("")).toBe("never");
    expect(dom.fmtRelative(null)).toBe("never");
    expect(dom.fmtRelative("2026-01-01T11:59:57Z")).toBe("just now");
    expect(dom.fmtRelative("2026-01-01T11:59:55Z")).toBe("5s ago");
    expect(dom.fmtRelative("2026-01-01T11:58:30Z")).toBe("1m 30s ago");
    expect(dom.fmtRelative("2026-01-01T09:00:00Z")).toBe("3h ago");
    expect(dom.fmtRelative("2025-12-30T10:00:00Z")).toBe("2d 2h ago");
    expect(dom.fmtRelative(Date.parse("2026-01-01T11:00:00Z"))).toBe("1h ago");
    expect(dom.fmtRelative("2026-01-01T12:00:30Z")).toBe("in 30s");
    expect(dom.fmtRelative("garbage")).toBe("garbage");
  });
  test("fmtRelative drops trailing seconds past ten minutes", () => {
    at("2026-01-01T12:00:00Z");
    expect(dom.fmtRelative("2026-01-01T11:44:59Z")).toBe("15m ago");
    expect(dom.fmtRelative("2026-01-01T11:51:00Z")).toBe("9m ago");
    expect(dom.fmtRelative("2026-01-01T11:51:01Z")).toBe("8m 59s ago");
  });
  test("fmtTime formats HH:MM:SS 24h; empty and invalid inputs", () => {
    expect(dom.fmtTime("")).toBe("");
    expect(dom.fmtTime("nope")).toBe("nope");
    expect(dom.fmtTime("2026-01-01T03:04:05")).toMatch(/^03:04:05$/);
  });
  test("normStatus lowercases, underscores spaces, applies aliases, defaults to unknown", () => {
    const cases = { OK: "ok", Success: "ok", passed: "ok", healthy: "ok", active: "running", Completed: "done", complete: "done", error: "fail", failure: "fail", critical: "fail", denied: "fail", warning: "warn", degraded: "warn", partial: "warn", pending: "open", todo: "open", queued: "open", inprogress: "in_progress", "in-progress": "in_progress", "Needs Input": "needs_input", weird: "weird" };
    for (const [k, v] of Object.entries(cases)) expect(dom.normStatus(k)).toBe(v);
    expect(dom.normStatus(undefined)).toBe("unknown");
    expect(dom.normStatus(null)).toBe("unknown");
  });
  test("statusLabel swaps underscores for spaces", () => {
    expect(dom.statusLabel("In_Progress")).toBe("in progress");
    expect(dom.statusLabel("needs input")).toBe("needs input");
  });
});

describe("patchInto", () => {
  const div = (attrs, ...kids) => { const n = dom.h("div", attrs); kids.forEach((k) => n.appendChild(typeof k === "string" ? doc.createTextNode(k) : k)); return n; };
  const field = (value, defaultValue = "") => { const i = el("input"); i.value = value; i.defaultValue = defaultValue; return i; };

  test("identical trees leave existing nodes untouched", () => {
    const kid = dom.h("span", null, "a");
    const old = div(null, kid);
    dom.patchInto(old, div(null, dom.h("span", null, "a")));
    expect(old.childNodes[0]).toBe(kid);
  });
  test("text nodes update in place; extra new children append; surplus old children are removed", () => {
    const t = doc.createTextNode("one");
    const old = div(null, t, dom.h("b"), dom.h("i"));
    dom.patchInto(old, div(null, "two", dom.h("b")));
    expect(old.childNodes[0]).toBe(t);
    expect(t.nodeValue).toBe("two");
    expect(old.childNodes.map((c) => c.tagName)).toEqual([undefined, "B"].map((x) => (x === undefined ? "#text" : x)));
    const grow = div(null, "x");
    dom.patchInto(grow, div(null, "x", dom.h("em", null, "added")));
    expect(grow.childNodes).toHaveLength(2);
    expect(grow.childNodes[1].textContent).toBe("added");
  });
  test("same-tag structural containers are descended into (inner DIV identity kept), differing ones swapped", () => {
    const inner = div({ class: "c" }, "a");
    const old = div(null, inner);
    dom.patchInto(old, div(null, div({ class: "c" }, "b")));
    expect(old.childNodes[0]).toBe(inner);
    expect(inner.textContent).toBe("b");
    const swapped = div({ class: "c" }, "a");
    const old2 = div(null, swapped);
    dom.patchInto(old2, div(null, div({ class: "d" }, "a")));
    expect(old2.childNodes[0]).not.toBe(swapped);
    expect(old2.childNodes[0].getAttribute("class")).toBe("d");
  });
  test("non-structural elements (span) are replaced when they differ", () => {
    const sp = dom.h("span", null, "a");
    const old = div(null, sp);
    dom.patchInto(old, div(null, dom.h("span", null, "b")));
    expect(old.childNodes[0]).not.toBe(sp);
    expect(old.textContent).toBe("b");
  });
  test("attribute comparison ignores the open flag so a user-opened <details> keeps its place", () => {
    const d = dom.h("details", null, dom.h("summary", null, "s"), "body");
    d.setAttribute("open", "");
    d.open = true;
    const old = div(null, d);
    const nu = dom.h("details", null, dom.h("summary", null, "s"), "body2");
    dom.patchInto(old, div(null, nu));
    expect(old.childNodes[0]).toBe(d);
    expect(d.textContent).toBe("sbody2");
  });
  test("a swapped subtree carries over open details, edited field values and checked state", () => {
    const det = dom.h("details");
    det.open = true;
    const oldBox = el("input"); oldBox.type = "checkbox"; oldBox.checked = true; oldBox.defaultChecked = false;
    const oldText = field("typed", "");
    const clean = field("same", "same");
    const oldWrap = dom.h("section", { class: "old" }, det, oldBox, oldText, clean);
    const nuDet = dom.h("details");
    const nuBox = el("input"); nuBox.type = "checkbox";
    const nuText = field("server", "server");
    const nuClean = field("fresh", "fresh");
    const nuWrap = dom.h("section", { class: "new" }, nuDet, nuBox, nuText, nuClean);
    const root = div(null, oldWrap);
    dom.patchInto(root, div(null, nuWrap));
    expect(root.childNodes[0]).toBe(nuWrap);
    expect(nuDet.open).toBe(true);
    expect(nuBox.checked).toBe(true);
    expect(nuText.value).toBe("typed");
    expect(nuClean.value).toBe("fresh");
  });
  test("field state is not carried when the field counts differ", () => {
    const oldWrap = dom.h("section", { class: "a" }, field("typed", ""));
    const nuIn = field("srv", "srv");
    const nuWrap = dom.h("section", { class: "b" }, nuIn, field("x", "x"));
    const root = div(null, oldWrap);
    dom.patchInto(root, div(null, nuWrap));
    expect(nuIn.value).toBe("srv");
  });
  test("focus follows its child-index path into the replacement and keeps the selection", () => {
    const oldBtn = dom.h("button", null, "go");
    const oldWrap = dom.h("section", { class: "a" }, dom.h("p"), oldBtn);
    const nuBtn = dom.h("button", null, "go2");
    const nuWrap = dom.h("section", { class: "b" }, dom.h("p"), nuBtn);
    const root = div(null, oldWrap);
    doc.body.appendChild(root);
    oldBtn.focus();
    const before = nuBtn.focusCalls || 0;
    dom.patchInto(root, div(null, nuWrap));
    expect(nuBtn.focusCalls).toBe(before + 1);
    expect(doc.activeElement).toBe(nuBtn);
  });
  test("a focused text field gets its value and selection range restored", () => {
    const oldIn = field("abc", "");
    oldIn.selectionStart = 1; oldIn.selectionEnd = 2;
    const nuIn = field("", "");
    let range;
    nuIn.setSelectionRange = (a, b) => { range = [a, b]; };
    const root = div(null, dom.h("section", { class: "a" }, oldIn));
    doc.body.appendChild(root);
    oldIn.focus();
    dom.patchInto(root, div(null, dom.h("section", { class: "b" }, nuIn)));
    expect(nuIn.value).toBe("abc");
    expect(range).toEqual([1, 2]);
  });
  test("focus elsewhere is left alone", () => {
    const other = dom.h("button");
    doc.body.appendChild(other);
    other.focus();
    const oldBtn = dom.h("button", null, "a");
    const nuBtn = dom.h("button", null, "b");
    const root = div(null, dom.h("section", { class: "a" }, oldBtn));
    dom.patchInto(root, div(null, dom.h("section", { class: "b" }, nuBtn)));
    expect(nuBtn.focusCalls || 0).toBe(0);
    expect(doc.activeElement).toBe(other);
  });
  test("the #main scroll offset is preserved across the patch", () => {
    const main = { scrollTop: 340 };
    doc.main = main;
    const old = div(null, "a");
    const origSync = old.removeChild;
    old.removeChild = (c) => { main.scrollTop = 0; return origSync.call(old, c); };
    dom.patchInto(old, div(null));
    expect(main.scrollTop).toBe(340);
  });
  test("returns the patched old element", () => {
    const old = div(null, "a");
    expect(dom.patchInto(old, div(null, "b"))).toBe(old);
  });
});
