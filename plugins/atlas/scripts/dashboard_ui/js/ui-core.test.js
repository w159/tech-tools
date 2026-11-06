import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire, walk } from "./rich-dom.js";

let dom;
let C;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
let timers;
beforeEach(async () => {
  dom = installRichDom();
  timers = new Map();
  let id = 0;
  globalThis.setTimeout = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  globalThis.clearTimeout = (i) => { timers.delete(i); };
  C = await import("./ui-core.js");
});
afterEach(() => {
  globalThis.setTimeout = realTimers.setTimeout;
  globalThis.clearTimeout = realTimers.clearTimeout;
  restoreRichDom();
});
const fireTimer = (ms) => { for (const [i, t] of [...timers]) if (t.ms === ms) { timers.delete(i); t.fn(); } };
const attach = (n) => { dom.body.appendChild(n); return n; };
const byClass = (root, cls) => root.querySelectorAll("." + cls);
const texts = (nodes) => nodes.map((n) => n.textContent);

describe("Button", () => {
  test("variants map to classes; size sm adds btn-sm; default type is button", () => {
    expect(C.Button({ label: "A" }).className).toBe("btn");
    expect(C.Button({ label: "A", variant: "primary" }).className).toBe("btn btn-primary");
    expect(C.Button({ label: "A", variant: "ghost" }).className).toBe("btn btn-ghost");
    expect(C.Button({ label: "A", variant: "danger" }).className).toBe("btn btn-danger");
    expect(C.Button({ label: "A", variant: "secondary", size: "sm" }).className).toBe("btn btn-sm");
    expect(C.Button({ label: "A" }).type).toBe("button");
    expect(C.Button({ label: "A", type: "submit" }).type).toBe("submit");
  });
  test("passes id, title, aria-label through", () => {
    const b = C.Button({ label: "A", id: "x", title: "t", ariaLabel: "al" });
    expect([b.id, b.getAttribute("title"), b.getAttribute("aria-label")]).toEqual(["x", "t", "al"]);
  });
  test("click runs onClick when enabled and not when disabled or busy", () => {
    let n = 0;
    const on = C.Button({ label: "A", onClick: () => n++ });
    on.click();
    expect(n).toBe(1);
    const off = C.Button({ label: "A", disabled: true, onClick: () => n++ });
    fire(off, "click");
    const busy = C.Button({ label: "A", busy: true, onClick: () => n++ });
    fire(busy, "click");
    expect(n).toBe(1);
    expect(off.getAttribute("aria-disabled")).toBe("true");
    expect(off.disabled).toBe(true);
    expect(on.getAttribute("aria-disabled")).toBeNull();
  });
  test("busy sets aria-busy and swaps the label to busyLabel (only when given)", () => {
    const b = C.Button({ label: "Save", busy: true, busyLabel: "Saving" });
    expect(b.textContent).toBe("Saving");
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(C.Button({ label: "Save", busy: true }).textContent).toBe("Save");
    expect(C.Button({ label: "Save", busyLabel: "Saving" }).textContent).toBe("Save");
  });
  test("icon precedes the label and keys adds a keycap", () => {
    const b = C.Button({ label: "Go", icon: "plus", keys: "g" });
    expect(b.childNodes.map((c) => c.tagName)).toEqual(["svg", "#text", "KBD"]);
    expect(b.querySelector("kbd").textContent).toBe("g");
  });
});

describe("IconButton, Chip, Keycap", () => {
  test("IconButton is labelled, ghost by default, with optional badge and pressed state", () => {
    const b = C.IconButton({ icon: "bell", label: "Alerts", badge: 3, pressed: true });
    expect(b.getAttribute("aria-label")).toBe("Alerts");
    expect(b.getAttribute("title")).toBe("Alerts");
    expect(b.className).toBe("btn btn-icon btn-ghost");
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.querySelector(".btn-badge").textContent).toBe("3");
    expect(C.IconButton({ icon: "bell", label: "x", pressed: false }).getAttribute("aria-pressed")).toBe("false");
    expect(C.IconButton({ icon: "bell", label: "x" }).getAttribute("aria-pressed")).toBeNull();
    expect(C.IconButton({ icon: "bell", label: "x", variant: "secondary" }).className).toBe("btn btn-icon");
    expect(C.IconButton({ icon: "bell", label: "x", disabled: true }).disabled).toBe(true);
    expect(C.IconButton({ icon: "bell", label: "x" }).querySelector(".btn-badge")).toBeNull();
  });
  test("IconButton click handler fires", () => {
    let n = 0;
    C.IconButton({ icon: "bell", label: "x", onClick: () => n++ }).click();
    expect(n).toBe(1);
  });
  test("Chip shows pressed state and a count (0 included)", () => {
    const c = C.Chip({ label: "Open", selected: true, count: 0, title: "t" });
    expect(c.getAttribute("aria-pressed")).toBe("true");
    expect(c.querySelector(".chip-count").textContent).toBe("0");
    expect(C.Chip({ label: "x" }).getAttribute("aria-pressed")).toBe("false");
    expect(C.Chip({ label: "x" }).querySelector(".chip-count")).toBeNull();
    expect(C.Chip({ label: "x", count: null }).querySelector(".chip-count")).toBeNull();
  });
  test("Keycap renders a kbd with the text", () => {
    const k = C.Keycap(7);
    expect([k.tagName, k.className, k.textContent]).toEqual(["KBD", "keycap", "7"]);
  });
});

describe("Input and Select", () => {
  test("label is bound to the control by id; value and placeholder applied", () => {
    const f = C.Input({ label: "Name", value: "x", placeholder: "p", id: "nm", required: true });
    const input = f.querySelector("input");
    expect(f.querySelector("label").getAttribute("for")).toBe("nm");
    expect([input.id, input.value, input.getAttribute("placeholder"), input.getAttribute("required"), input.type]).toEqual(["nm", "x", "p", "", "text"]);
  });
  test("generated ids are unique", () => {
    const a = C.Input({}).querySelector("input").id;
    const b = C.Input({}).querySelector("input").id;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^fld-\d+$/);
  });
  test("error wins over hint, is announced and described", () => {
    const f = C.Input({ id: "e", error: "bad", hint: "tip" });
    const input = f.querySelector("input");
    expect(f.querySelector(".field-msg").textContent).toBe("bad");
    expect(f.querySelector(".field-msg").getAttribute("role")).toBe("alert");
    expect(f.querySelector(".field-hint")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("e-msg");
    expect(input.className).toBe("input is-error");
  });
  test("hint alone is described but not invalid", () => {
    const f = C.Input({ id: "h", hint: "tip" });
    expect(f.querySelector(".field-hint").textContent).toBe("tip");
    expect(f.querySelector("input").getAttribute("aria-invalid")).toBeNull();
    expect(f.querySelector("input").getAttribute("aria-describedby")).toBe("h-msg");
  });
  test("multiline makes a textarea without a type", () => {
    const f = C.Input({ multiline: true, value: "a\nb" });
    const t = f.querySelector("textarea");
    expect(t.className).toBe("textarea");
    expect(t.getAttribute("type")).toBeNull();
    expect(t.value).toBe("a\nb");
    expect(f.querySelector("input")).toBeNull();
  });
  test("a falsy-but-defined value (empty string, 0) is still applied; null/undefined leave the default", () => {
    expect(C.Input({ value: 0 }).querySelector("input").value).toBe(0);
    expect(C.Input({ value: "" }).querySelector("input").value).toBe("");
    expect(C.Input({ value: null }).querySelector("input").value).toBe("");
  });
  test("onInput and onChange receive the control's value", () => {
    const seen = [];
    const f = C.Input({ onInput: (v) => seen.push(["i", v]), onChange: (v) => seen.push(["c", v]) });
    const input = f.querySelector("input");
    input.value = "typed";
    fire(input, "input");
    fire(input, "change");
    expect(seen).toEqual([["i", "typed"], ["c", "typed"]]);
  });
  test("Select lists options, applies value and reports changes", () => {
    const seen = [];
    const f = C.Select({ label: "Kind", id: "k", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], value: "b", onChange: (v) => seen.push(v) });
    const sel = f.querySelector("select");
    expect(texts(sel.querySelectorAll("option"))).toEqual(["Alpha", "Beta"]);
    expect(sel.querySelectorAll("option").map((o) => o.value)).toEqual(["a", "b"]);
    expect(sel.value).toBe("b");
    expect(f.querySelector("label").getAttribute("for")).toBe("k");
    sel.value = "a";
    fire(sel, "change");
    expect(seen).toEqual(["a"]);
  });
  test("Select error state and missing options", () => {
    const f = C.Select({ error: "pick one" });
    expect(f.querySelector("select").getAttribute("aria-invalid")).toBe("true");
    expect(f.querySelector("select").className).toBe("select is-error");
    expect(f.querySelector(".field-msg").textContent).toBe("pick one");
    expect(f.querySelector("select").querySelectorAll("option")).toHaveLength(0);
    expect(C.Select({}).querySelector(".field-msg")).toBeNull();
  });
});

describe("StatusDot, Badge, Card", () => {
  test("StatusDot is a labelled image with the status word by default", () => {
    const d = C.StatusDot({ status: "fail" });
    expect(d.getAttribute("role")).toBe("img");
    expect(d.getAttribute("aria-label")).toBe("Failed");
    expect(d.getAttribute("title")).toBe("Failed");
    expect(d.getAttribute("data-state")).toBe("fail");
    expect(d.getAttribute("data-status")).toBe("fail");
    expect(C.StatusDot({ status: "ok", label: "Fine" }).getAttribute("aria-label")).toBe("Fine");
    expect(d.querySelector("svg").getAttribute("width")).toBe("12");
  });
  test("Badge always shows a word: the custom text, a zero, or the state word", () => {
    expect(C.Badge({ status: "ok" }).textContent).toBe("Healthy");
    expect(C.Badge({ status: "ok", text: "3 up" }).textContent).toBe("3 up");
    expect(C.Badge({ status: "ok", text: 0 }).textContent).toBe("0");
    expect(C.Badge({ status: "ok", text: null }).textContent).toBe("Healthy");
    const b = C.Badge({ status: "blocked" });
    expect([b.getAttribute("data-state"), b.getAttribute("data-tone"), b.getAttribute("data-status")]).toEqual(["input", "input", "blocked"]);
    expect(b.querySelector("svg").getAttribute("width")).toBe("10");
  });
  test("Card draws a head only when there is a title or actions", () => {
    expect(C.Card({ children: ["x"] }).querySelector(".card-head")).toBeNull();
    const c = C.Card({ title: "T", actions: [C.Button({ label: "Go" })], children: ["body"], id: "cid", class: "extra", flush: true });
    expect(c.id).toBe("cid");
    expect(c.className).toBe("card extra");
    expect(c.querySelector("h2").textContent).toBe("T");
    expect(c.querySelector(".card-actions button").textContent).toBe("Go");
    expect(c.querySelector(".card-body").className).toBe("card-body flush");
    expect(c.querySelector(".card-body").textContent).toBe("body");
    const noTitle = C.Card({ actions: [C.Button({ label: "Go" })] });
    expect(noTitle.querySelector("h2")).toBeNull();
    expect(noTitle.querySelector(".card-body").className).toBe("card-body");
  });
});

describe("Sparkline", () => {
  test("fewer than two numeric points draws no line and says so", () => {
    expect(C.Sparkline({ values: [5] }).getAttribute("aria-label")).toBe("Trend: 5");
    expect(C.Sparkline({ values: [] }).getAttribute("aria-label")).toBe("No trend data");
    expect(C.Sparkline({}).childNodes).toHaveLength(0);
    expect(C.Sparkline({ values: ["x", NaN, Infinity, 3] }).childNodes).toHaveLength(0);
  });
  test("maps points into the 96x24 box from min(0, lo) to hi and dots the last point", () => {
    const s = C.Sparkline({ values: [0, 5, 10] });
    expect(s.getAttribute("viewBox")).toBe("0 0 96 24");
    const line = s.querySelector("polyline");
    expect(line.getAttribute("points")).toBe("1.0,22.0 48.0,12.0 95.0,2.0");
    const dot = s.querySelector("circle");
    expect([dot.getAttribute("cx"), dot.getAttribute("cy"), dot.getAttribute("r")]).toEqual(["95.0", "2.0", "2"]);
    expect(s.getAttribute("aria-label")).toBe("Trend: 0, 5, 10");
  });
  test("the baseline is zero even when every value is higher", () => {
    expect(C.Sparkline({ values: [5, 10] }).querySelector("polyline").getAttribute("points")).toBe("1.0,12.0 95.0,2.0");
  });
  test("a flat series does not divide by zero", () => {
    expect(C.Sparkline({ values: [0, 0] }).querySelector("polyline").getAttribute("points")).toBe("1.0,22.0 95.0,22.0");
  });
  test("stroke follows the status tone, else the accent", () => {
    expect(C.Sparkline({ values: [1, 2] }).querySelector("polyline").getAttribute("stroke")).toBe("var(--accent)");
    expect(C.Sparkline({ values: [1, 2], status: "fail" }).querySelector("polyline").getAttribute("stroke")).toBe("var(--st-fail)");
    expect(C.Sparkline({ values: [1, 2], status: "ok" }).querySelector("circle").getAttribute("fill")).toBe("var(--st-ok)");
  });
});

describe("Kpi", () => {
  const val = (k) => k.querySelector(".kpi-value");
  test("renders label and value; a div when not interactive", () => {
    const k = C.Kpi({ label: "Runs", value: 12 });
    expect(k.tagName).toBe("DIV");
    expect(k.querySelector(".kpi-label").textContent).toBe("Runs");
    expect(val(k).textContent).toBe("12");
    expect(val(k).className).toBe("kpi-value num");
  });
  test("zero is a value; missing and error read Not measured", () => {
    expect(val(C.Kpi({ label: "x", value: 0 })).textContent).toBe("0");
    for (const k of [C.Kpi({ label: "x" }), C.Kpi({ label: "x", value: null }), C.Kpi({ label: "x", value: 5, state: "error" })]) {
      expect(val(k).textContent).toBe("Not measured");
      expect(val(k).className).toContain("is-missing");
    }
  });
  test("link and button forms", () => {
    const a = C.Kpi({ label: "x", value: 1, href: "#/h" });
    expect([a.tagName, a.getAttribute("href")]).toEqual(["A", "#/h"]);
    let n = 0;
    const b = C.Kpi({ label: "x", value: 1, onClick: () => n++ });
    expect([b.tagName, b.type]).toEqual(["BUTTON", "button"]);
    b.click();
    expect(n).toBe(1);
  });
  test("loading shows a skeleton and busy, no value", () => {
    const k = C.Kpi({ label: "x", value: 1, state: "loading" });
    expect(k.getAttribute("aria-busy")).toBe("true");
    expect(k.querySelector(".skel")).not.toBeNull();
    expect(val(k)).toBeNull();
    expect(k.className).toBe("kpi is-loading");
  });
  test("delta: up good, down good, flat, string, and hidden on error / empty", () => {
    const d = (o) => C.Kpi({ label: "x", value: 1, ...o }).querySelector(".kpi-delta");
    expect(d({ delta: 12.34 }).textContent).toBe("▲ +12.3% vs prior");
    expect(d({ delta: 12.34 }).getAttribute("data-tone")).toBe("ok");
    expect(d({ delta: -5 }).textContent).toBe("▼ 5% vs prior");
    expect(d({ delta: -5 }).getAttribute("data-tone")).toBe("fail");
    expect(d({ delta: -5, goodDirection: "down" }).getAttribute("data-tone")).toBe("ok");
    expect(d({ delta: 5, goodDirection: "down" }).getAttribute("data-tone")).toBe("fail");
    expect(d({ delta: 0 }).textContent).toBe("0% vs prior");
    expect(d({ delta: 0 }).getAttribute("data-tone")).toBeNull();
    expect(d({ delta: "n/a" }).textContent).toBe("n/a");
    expect(d({ delta: undefined })).toBeNull();
    expect(d({ delta: null })).toBeNull();
    expect(d({ delta: "" })).toBeNull();
    expect(d({ delta: 3, state: "error" })).toBeNull();
    expect(d({ delta: NaN }).textContent).toBe("NaN");
  });
  test("sparkline needs more than one point and no error", () => {
    expect(C.Kpi({ label: "x", value: 1, series: [1, 2] }).querySelector("svg.spark")).not.toBeNull();
    expect(C.Kpi({ label: "x", value: 1, series: [1] }).querySelector("svg.spark")).toBeNull();
    expect(C.Kpi({ label: "x", value: 1, series: [1, 2], state: "error" }).querySelector("svg.spark")).toBeNull();
  });
  test("hint line: stale as-of, error reason, plain hint; precedence in that order", () => {
    const hint = (o) => C.Kpi({ label: "x", value: 1, ...o }).querySelector(".kpi-hint");
    expect(hint({ state: "stale", asOf: "10:00", hint: "h" }).textContent).toBe("As of 10:00");
    expect(hint({ state: "stale", hint: "h" }).textContent).toBe("h");
    expect(hint({ state: "error", reason: "daemon down", hint: "h" }).textContent).toBe("daemon down");
    expect(hint({ state: "error", reason: "daemon down" }).getAttribute("title")).toBe("daemon down");
    expect(hint({ hint: "h" }).getAttribute("title")).toBe("h");
    expect(hint({})).toBeNull();
  });
  test("status adds a dot beside the label and a screen-reader word", () => {
    const k = C.Kpi({ label: "Fails", value: 2, status: "fail" });
    expect(k.querySelector(".kpi-label .dot")).not.toBeNull();
    expect(k.querySelector(".sr-only").textContent).toBe("status Failed");
    expect(C.Kpi({ label: "x", value: 1 }).querySelector(".sr-only")).toBeNull();
  });
});

describe("Table", () => {
  const cols = [{ key: "n", label: "Name", sortable: true }, { key: "v", label: "Val", sortable: true, align: "right", width: "80px", primary: true, render: (r) => (r.v === 0 ? "zero" : r.v) }];
  const rows = [{ id: "a", n: "b", v: 2 }, { id: "b", n: "a", v: 0 }, { id: "c", n: "c", v: null }];
  const cellTexts = (t) => t.querySelectorAll("tbody tr").map((tr) => tr.querySelectorAll("td").map((td) => td.textContent));
  test("empty rows show the message, a node, or the default", () => {
    expect(C.Table({ columns: cols, rows: [], empty: "None" }).textContent).toBe("None");
    expect(C.Table({ columns: cols, rows: [] }).textContent).toBe("Nothing here yet.");
    const node = dom.body.ownerDocument || document.createElement("p");
    expect(C.Table({ columns: cols, rows: [], empty: node }).firstChild).toBe(node);
    expect(C.Table({}).textContent).toBe("Nothing here yet.");
  });
  test("renders caption, headers, data-label cells, render() output and blank for null", () => {
    const t = C.Table({ columns: cols, rows, caption: "People", dense: true });
    expect(t.querySelector("caption").textContent).toBe("People");
    expect(t.querySelector("table").className).toBe("table dense");
    expect(texts(t.querySelectorAll("thead th"))).toEqual(["Name", "Val"]);
    expect(cellTexts(t)).toEqual([["b", "2"], ["a", "zero"], ["c", ""]]);
    const td = t.querySelectorAll("tbody tr")[0].querySelectorAll("td")[1];
    expect([td.getAttribute("data-label"), td.getAttribute("data-align"), td.getAttribute("data-primary")]).toEqual(["Val", "right", "true"]);
    expect(t.querySelectorAll("thead th")[1].style.width).toBe("80px");
    expect(C.Table({ columns: cols, rows }).querySelector("caption").textContent).toBe("Table");
    expect(C.Table({ columns: cols, rows }).querySelector("table").className).toBe("table");
  });
  test("non-sortable headers are plain text", () => {
    const t = C.Table({ columns: [{ key: "n", label: "Name" }], rows });
    expect(t.querySelector("thead button")).toBeNull();
    expect(t.querySelector("thead th").getAttribute("aria-sort")).toBeNull();
  });
  test("sorting toggles asc/desc, flags aria-sort, places nulls last and does not mutate the input", () => {
    const input = rows.slice();
    const t = C.Table({ columns: cols, rows: input });
    const head = () => t.querySelectorAll("thead th");
    expect(head().map((h) => h.getAttribute("aria-sort"))).toEqual(["none", "none"]);
    head()[0].querySelector("button").click();
    expect(cellTexts(t).map((r) => r[0])).toEqual(["a", "b", "c"]);
    expect(head()[0].getAttribute("aria-sort")).toBe("ascending");
    head()[0].querySelector("button").click();
    expect(cellTexts(t).map((r) => r[0])).toEqual(["c", "b", "a"]);
    expect(head()[0].getAttribute("aria-sort")).toBe("descending");
    head()[1].querySelector("button").click();
    expect(cellTexts(t).map((r) => r[1])).toEqual(["zero", "2", ""]);
    expect(head()[0].getAttribute("aria-sort")).toBe("none");
    head()[1].querySelector("button").click();
    expect(cellTexts(t).map((r) => r[1])).toEqual(["2", "zero", ""]);
    expect(input.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  test("equal keys keep their order; the sort icon points the way", () => {
    const t = C.Table({ columns: [{ key: "g", label: "G", sortable: true }, { key: "k", label: "K" }], rows: [{ g: 1, k: "first" }, { g: 1, k: "second" }, { g: 0, k: "zero" }] });
    t.querySelector("thead button").click();
    expect(t.querySelectorAll("tbody tr").map((tr) => tr.querySelectorAll("td")[1].textContent)).toEqual(["zero", "first", "second"]);
    expect(t.querySelector("thead button svg path").getAttribute("d")).toBe("M18 15l-6-6-6 6");
    t.querySelector("thead button").click();
    expect(t.querySelector("thead button svg path").getAttribute("d")).toBe("M6 9l6 6 6-6");
  });
  test("rows are clickable and Enter opens (Shift asks for the terminal); other keys do nothing", () => {
    const seen = [];
    const t = attach(C.Table({ columns: cols, rows, onRow: (r, o) => seen.push([r.id, o]) }));
    const tr = t.querySelectorAll("tbody tr")[1];
    expect(tr.getAttribute("data-clickable")).toBe("true");
    expect(tr.getAttribute("tabindex")).toBe("0");
    tr.click();
    fire(tr, "keydown", { key: "Enter", shiftKey: false });
    fire(tr, "keydown", { key: "Enter", shiftKey: true });
    fire(tr, "keydown", { key: "x" });
    expect(seen).toEqual([["b", {}], ["b", { terminal: false }], ["b", { terminal: true }]]);
  });
  test("keydown from a child control is ignored", () => {
    const seen = [];
    const t = attach(C.Table({ columns: [{ key: "n", label: "N", render: () => C.Button({ label: "in" }) }], rows, onRow: (r) => seen.push(r.id) }));
    const btn = t.querySelector("tbody button");
    fire(btn, "keydown", { key: "Enter" });
    expect(seen).toEqual([]);
  });
  test("arrow keys and j/k move focus between rows and stop at the ends", () => {
    const t = attach(C.Table({ columns: cols, rows, onRow() {} }));
    const trs = t.querySelectorAll("tbody tr");
    const pressed = fire(trs[0], "keydown", { key: "ArrowDown" });
    expect(pressed.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trs[1]);
    fire(trs[1], "keydown", { key: "j" });
    expect(document.activeElement).toBe(trs[2]);
    fire(trs[2], "keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(trs[2]);
    fire(trs[2], "keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(trs[1]);
    fire(trs[1], "keydown", { key: "k" });
    expect(document.activeElement).toBe(trs[0]);
    fire(trs[0], "keydown", { key: "k" });
    expect(document.activeElement).toBe(trs[0]);
  });
  test("rows without onRow or selection are not focusable or clickable", () => {
    const tr = C.Table({ columns: cols, rows }).querySelector("tbody tr");
    expect(tr.getAttribute("tabindex")).toBeNull();
    expect(tr.getAttribute("data-clickable")).toBeNull();
  });
  test("selectedKey marks the matching row (key 0 included)", () => {
    const t = C.Table({ columns: cols, rows, rowKey: "id", selectedKey: "b" });
    expect(t.querySelectorAll("tbody tr").map((r) => r.getAttribute("data-selected"))).toEqual([null, "true", null]);
    const byIndex = C.Table({ columns: cols, rows, selectedKey: 0 });
    expect(byIndex.querySelectorAll("tbody tr").map((r) => r.getAttribute("data-selected"))).toEqual(["true", null, null]);
  });
  test("selectable adds checkboxes; checking shows a bulk bar with the chosen rows; selected() lists them", () => {
    const bulkCalls = [];
    const t = attach(C.Table({ columns: cols, rows, rowKey: "id", selectable: true, bulkActions: (picked) => { bulkCalls.push(picked.map((r) => r.id)); return [C.Button({ label: "Delete" })]; } }));
    expect(t.querySelector(".bulk-bar")).toBeNull();
    expect(t.querySelectorAll("thead th")).toHaveLength(3);
    const box = (i) => t.querySelectorAll("tbody tr")[i].querySelector("input");
    box(0).checked = true;
    fire(box(0), "change");
    expect(t.querySelector(".bulk-bar span").textContent).toBe("1 selected");
    expect(t.querySelector(".bulk-bar button").textContent).toBe("Delete");
    box(2).checked = true;
    fire(box(2), "change");
    expect(t.querySelector(".bulk-bar span").textContent).toBe("2 selected");
    expect(bulkCalls.at(-1)).toEqual(["a", "c"]);
    expect(t.selected().map((r) => r.id)).toEqual(["a", "c"]);
    expect(box(0).checked).toBe(true);
    box(0).checked = false;
    fire(box(0), "change");
    expect(t.selected().map((r) => r.id)).toEqual(["c"]);
    box(2).checked = false;
    fire(box(2), "change");
    expect(t.querySelector(".bulk-bar")).toBeNull();
  });
  test("a checkbox click does not open the row", () => {
    let opened = 0;
    const t = attach(C.Table({ columns: cols, rows, selectable: true, onRow: () => opened++ }));
    t.querySelector("tbody input").click();
    expect(opened).toBe(0);
  });
  test("Space toggles selection on a focused row", () => {
    const t = attach(C.Table({ columns: cols, rows, rowKey: "id", selectable: true }));
    fire(t.querySelectorAll("tbody tr")[1], "keydown", { key: " " });
    expect(t.selected().map((r) => r.id)).toEqual(["b"]);
    fire(t.querySelectorAll("tbody tr")[1], "keydown", { key: " " });
    expect(t.selected()).toEqual([]);
  });
  test("Space does nothing when rows are not selectable", () => {
    const t = attach(C.Table({ columns: cols, rows, onRow() {} }));
    const ev = fire(t.querySelector("tbody tr"), "keydown", { key: " " });
    expect(ev.defaultPrevented).toBeFalsy();
    expect(t.selected()).toEqual([]);
  });
});

describe("Tabs and tabPanelProps", () => {
  const tabs = [{ id: "a", label: "A", count: 0 }, { id: "b", label: "B" }, { id: "c", label: "C", count: 5 }];
  const sel = (t) => t.querySelectorAll("button").map((b) => b.getAttribute("aria-selected"));
  test("tabPanelProps links panel and tab", () => {
    expect(C.tabPanelProps("x")).toEqual({ role: "tabpanel", id: "panel-x", "aria-labelledby": "tab-x", tabindex: "0" });
  });
  test("first tab is selected by default; ids, controls and counts are wired", () => {
    const t = C.Tabs({ tabs, label: "Sections" });
    expect(t.getAttribute("role")).toBe("tablist");
    expect(t.getAttribute("aria-label")).toBe("Sections");
    expect(sel(t)).toEqual(["true", "false", "false"]);
    const b = t.querySelectorAll("button");
    expect([b[1].id, b[1].getAttribute("aria-controls"), b[1].getAttribute("role")]).toEqual(["tab-b", "panel-b", "tab"]);
    expect(b.map((x) => x.tabIndex)).toEqual([0, -1, -1]);
    expect(b[0].querySelector(".count").textContent).toBe("0");
    expect(b[1].querySelector(".count")).toBeNull();
  });
  test("active prop picks the tab; click selects and reports", () => {
    const seen = [];
    const t = C.Tabs({ tabs, active: "c", onChange: (id) => seen.push(id) });
    expect(sel(t)).toEqual(["false", "false", "true"]);
    t.querySelectorAll("button")[0].click();
    expect(sel(t)).toEqual(["true", "false", "false"]);
    expect(seen).toEqual(["a"]);
  });
  test("arrow keys wrap, Home/End jump, focus moves and onChange fires; other keys are ignored", () => {
    const seen = [];
    const t = attach(C.Tabs({ tabs, onChange: (id) => seen.push(id) }));
    const b = t.querySelectorAll("button");
    fire(b[0], "keydown", { key: "ArrowLeft" });
    expect(seen).toEqual(["c"]);
    expect(document.activeElement).toBe(b[2]);
    fire(b[2], "keydown", { key: "ArrowRight" });
    expect(seen.at(-1)).toBe("a");
    fire(b[0], "keydown", { key: "ArrowRight" });
    expect(seen.at(-1)).toBe("b");
    fire(b[1], "keydown", { key: "End" });
    expect(seen.at(-1)).toBe("c");
    fire(b[2], "keydown", { key: "Home" });
    expect(seen.at(-1)).toBe("a");
    const n = seen.length;
    const ev = fire(b[0], "keydown", { key: "q" });
    expect(seen).toHaveLength(n);
    expect(ev.defaultPrevented).toBeFalsy();
    expect(sel(t)).toEqual(["true", "false", "false"]);
  });
  test(".select(id) updates selection without firing onChange", () => {
    const seen = [];
    const t = C.Tabs({ tabs, onChange: (id) => seen.push(id) });
    t.select("b");
    expect(sel(t)).toEqual(["false", "true", "false"]);
    expect(seen).toEqual([]);
  });
  test("the underline is placed under the selected tab once it has a width", () => {
    const t = C.Tabs({ tabs, active: "b" });
    attach(t);
    const b = t.querySelectorAll("button");
    b[1].offsetLeft = 40;
    b[1].offsetWidth = 55;
    t.select("b");
    expect(t._style["--tab-x"]).toBe("40px");
    expect(t._style["--tab-w"]).toBe("55px");
  });
  test("empty tab list is harmless", () => {
    expect(C.Tabs({}).querySelectorAll("button")).toHaveLength(0);
  });
});

describe("CommandBlock", () => {
  test("shows the command and copies it", async () => {
    let wrote;
    globalThis.navigator = { clipboard: { writeText: async (t) => { wrote = t; } } };
    window.isSecureContext = true;
    const c = C.CommandBlock("echo 1");
    expect(c.querySelector("code").textContent).toBe("echo 1");
    const btn = c.querySelector("button");
    expect(btn.getAttribute("aria-label")).toBe("Copy command");
    await Promise.all(btn._listeners.click.map((f) => f({ currentTarget: btn })));
    expect(wrote).toBe("echo 1");
    expect(btn.lastChild.textContent).toBe("Copied");
  });
  test("reports a failed copy", async () => {
    window.isSecureContext = false;
    document.execCommand = () => false;
    const c = C.CommandBlock(5);
    const btn = c.querySelector("button");
    await Promise.all(btn._listeners.click.map((f) => f({ currentTarget: btn })));
    expect(c.querySelector("code").textContent).toBe("5");
    expect(btn.lastChild.textContent).toBe("Copy failed");
    delete document.execCommand;
  });
});

describe("State", () => {
  test("empty (default): title, body, commands and actions", () => {
    const a = C.Button({ label: "Do" });
    const s = C.State({ title: "Nothing", body: "why", commands: ["a", "b"], action: a });
    expect(s.className).toBe("state state-empty");
    expect(s.querySelector("h2").textContent).toBe("Nothing");
    expect(s.querySelector(".state-body").textContent).toBe("why");
    expect(texts(s.querySelectorAll("code"))).toEqual(["a", "b"]);
    expect(s.querySelector(".state-actions button")).toBe(a);
    expect(C.State({}).querySelector("h2").textContent).toBe("Nothing here yet");
    expect(C.State({ commands: "one" }).querySelectorAll("code")).toHaveLength(1);
    expect(C.State({}).querySelector(".state-actions")).toBeNull();
    expect(C.State({}).querySelector(".state-body")).toBeNull();
  });
  test("inline flag adds is-inline", () => {
    expect(C.State({ inline: true }).className).toBe("state state-empty is-inline");
  });
  test("loading: busy skeleton by shape; label appears after 600ms", () => {
    const s = C.State({ variant: "loading", label: "agents", shape: "cards" });
    const armed = [...timers.values()].map((t) => t.ms).sort((a, b) => a - b);
    expect(armed).toEqual([600, 8000]);
    expect(s.getAttribute("aria-busy")).toBe("true");
    expect(s.querySelector(".skel-cards").querySelectorAll(".skel")).toHaveLength(3);
    expect(C.State({ variant: "loading", shape: "kpi" }).querySelectorAll(".skel")).toHaveLength(4);
    expect(C.State({ variant: "loading" }).querySelectorAll(".skel")).toHaveLength(5);
    expect(s.querySelector("[role=status]").textContent).toBe("");
    fireTimer(600);
    expect(s.querySelector("[role=status]").textContent).toContain("Loading ");
  });
  test("loading: after 8s while connected it times out into the error variant and calls onTimeout", () => {
    let t = 0;
    const s = attach(C.State({ variant: "loading", onTimeout: () => t++, onRetry() {} }));
    fireTimer(8000);
    expect(t).toBe(1);
    expect(s.className).toBe("state state-error");
    expect(s.getAttribute("aria-busy")).toBeNull();
    expect(s.getAttribute("role")).toBe("alert");
  });
  test("loading: a detached state never times out", () => {
    let t = 0;
    const s = C.State({ variant: "loading", onTimeout: () => t++ });
    fireTimer(8000);
    expect(t).toBe(0);
    expect(s.className).toBe("state state-loading");
  });
  test("leaving loading cancels its timers", () => {
    const s = C.State({ variant: "loading" });
    expect(timers.size).toBeGreaterThan(0);
    s.redraw("empty");
    expect(timers.size).toBe(0);
  });
  test("stale banner names the as-of time", () => {
    const sec = C.Button({ label: "Retry" });
    const s = C.State({ variant: "stale", asOf: "10:00", secondary: sec });
    expect(s.querySelector("[role=status]").textContent).toBe("Showing data from 10:00. Reconnecting.");
    expect(s.querySelector("button")).toBe(sec);
    expect(C.State({ variant: "stale" }).textContent).toBe("Showing data from earlier. Reconnecting.");
  });
  test("error: humanised title, why/do, retry, technical details", () => {
    let retried = 0;
    const s = C.State({ variant: "error", error: { error: "not_found", why: "no such run", do: "pick another", status: 404 }, onRetry: () => retried++ });
    expect(s.querySelector("h2").textContent).toBe("Not found");
    expect(texts(s.querySelectorAll(".state-body"))).toEqual(["no such run", "pick another"]);
    expect(texts(s.querySelectorAll(".state-actions button"))).toEqual(["Retry", "Copy details"]);
    s.querySelector(".state-actions button").click();
    expect(retried).toBe(1);
    expect(s.querySelector("details pre").textContent).toBe("error: not_found\nstatus: 404\nwhy: no such run\ndo: pick another");
    expect(s.getAttribute("role")).toBe("alert");
  });
  test("error: explicit title and body win/fall back; status 0 is shown; no detail means no details block", () => {
    const s = C.State({ variant: "error", title: "Custom", body: "fallback body", error: { status: 0 } });
    expect(s.querySelector("h2").textContent).toBe("Custom");
    expect(s.querySelector(".state-body").textContent).toBe("fallback body");
    expect(s.querySelector("pre").textContent).toBe("status: 0");
    const bare = C.State({ variant: "error" });
    expect(bare.querySelector("h2").textContent).toBe("Something went wrong");
    expect(bare.querySelector("details")).toBeNull();
    expect(bare.querySelector(".state-actions").childNodes).toHaveLength(0);
    expect(C.State({ variant: "error", error: { message: "boom" } }).querySelector("h2").textContent).toBe("Boom");
    expect(C.State({ variant: "error", error: { error: "a-b__c" } }).querySelector("h2").textContent).toBe("A b c");
  });
  test("EmptyState adapts the legacy shape", () => {
    const e = C.EmptyState({ title: "T", body: "B", command: "cmd", actions: [C.Button({ label: "X" })] });
    expect(e.className).toBe("state state-empty");
    expect(e.querySelector("code").textContent).toBe("cmd");
    expect(e.querySelector(".state-actions button").textContent).toBe("X");
    expect(C.EmptyState({ title: "T", actions: [] }).querySelector(".state-actions")).toBeNull();
    expect(C.EmptyState({}).querySelector("h2").textContent).toBe("Nothing here yet");
  });
});

describe("DegradedState", () => {
  test("no layer means nothing to show", () => {
    expect(C.DegradedState({})).toBeNull();
    expect(C.DegradedState()).toBeNull();
  });
  test("daemon: alert with the start command and a Retry", () => {
    let n = 0;
    const d = C.DegradedState({ layer: "daemon", reason: "ECONNREFUSED", onRecheck: () => n++ });
    expect(d.getAttribute("role")).toBe("alert");
    expect(d.getAttribute("data-layer")).toBe("daemon");
    expect(d.querySelector("h2").textContent).toBe("Atlas isn't responding");
    expect(d.querySelector("code").textContent).toBe(C.DAEMON_START);
    const retry = d.querySelector(".state-actions button");
    expect(retry.textContent).toBe("Retry");
    expect(retry.className).toBe("btn btn-primary");
    retry.click();
    expect(n).toBe(1);
    expect(d.querySelector("details pre").textContent).toBe("ECONNREFUSED");
    expect(C.DegradedState({ layer: "daemon" }).querySelector("details")).toBeNull();
  });
  test("herdr: Start runtime only when onStart is given; busy swaps its label; inline flag", () => {
    let started = 0;
    const d = C.DegradedState({ layer: "herdr", onStart: () => started++, onRecheck() {} });
    expect(d.getAttribute("role")).toBe("status");
    expect(texts(d.querySelectorAll(".state-actions button"))).toEqual(["Start runtime", "Recheck"]);
    d.querySelector(".state-actions button").click();
    expect(started).toBe(1);
    const busy = C.DegradedState({ layer: "herdr", onStart() {}, busy: true });
    expect(busy.querySelector(".state-actions button").textContent).toBe("Starting runtime");
    expect(busy.querySelector(".state-actions button").getAttribute("aria-busy")).toBe("true");
    expect(texts(C.DegradedState({ layer: "herdr" }).querySelectorAll(".state-actions button"))).toEqual(["Recheck"]);
    expect(C.DegradedState({ layer: "herdr", inline: true }).className).toBe("state state-degraded is-inline");
    expect(C.DegradedState({ layer: "herdr" }).className).toBe("state state-degraded");
  });
  test("webui: inline terminal-service notice with a secondary recheck", () => {
    const d = C.DegradedState({ layer: "webui", busy: true, onStart() {} });
    expect(d.className).toBe("state state-degraded is-inline");
    expect(d.getAttribute("data-layer")).toBe("webui");
    expect(d.querySelector("button").textContent).toBe("Starting");
    expect(d.querySelectorAll(".state-actions button")[1].className).toBe("btn");
    expect(C.DegradedState({ layer: "webui" }).querySelector("button").textContent).toBe("Start terminal service");
  });
});
