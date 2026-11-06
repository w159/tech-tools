import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body, installDom, restoreDom } from "./operate-dom-stub.js";
import { icon } from "./dom.js";

installDom();
const U = await import("./ui-data.js");
restoreDom();
const { LineChart, BarChart, StateBar, DayHeader, FeedItem, Timeline, ChannelMessage, ChannelList, Composer, PaneTile, stripAnsi, Terminal, LogView, FilterBar, PROMPT_MAX } = U;

let protoSaved;
const KEYS = ["removeChild", "append", "querySelectorAll"];
beforeEach(() => {
  installDom();
  const proto = Object.getPrototypeOf(document.createElement("div"));
  protoSaved = Object.fromEntries(KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)]));
  const origQsa = protoSaved.querySelectorAll.value;
  Object.defineProperties(proto, {
    // descendant selectors ("div.seg button"): chain the stub's simple-selector matcher
    querySelectorAll: { value(sel) { let cur = [this]; for (const part of String(sel).trim().split(/\s+/)) { const next = []; for (const n of cur) for (const m of origQsa.call(n, part)) if (!next.includes(m)) next.push(m); cur = next; } return cur; }, configurable: true, writable: true },
    removeChild: { value(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; return c; }, configurable: true, writable: true },
    append: { value(...c) { c.forEach((x) => this.appendChild(typeof x === "string" ? document.createTextNode(x) : x)); }, configurable: true, writable: true },
  });
});
afterEach(() => {
  const proto = Object.getPrototypeOf(document.createElement("div"));
  for (const k of KEYS) { if (protoSaved[k]) Object.defineProperty(proto, k, protoSaved[k]); else delete proto[k]; }
  restoreDom();
});

const all = (root, sel) => root.querySelectorAll(sel);
const one = (root, sel) => root.querySelector(sel);
const texts = (root, sel) => all(root, sel).map((n) => n.textContent);
const fire = (n, type, e) => { const ev = { preventDefault() { this.prevented = true; }, ...e }; (n.listeners[type] || []).forEach((f) => f(ev)); return ev; };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("charts", () => {
  test("a chart with no usable series says so and draws nothing", () => {
    for (const args of [{}, { labels: [], series: [] }, { series: [{ name: "a" }] }, { series: [{ name: "a", values: "x" }, null] }, { series: [{ name: "a", values: [] }] }]) {
      for (const C of [LineChart, BarChart]) {
        const c = C(args);
        expect(c.tag).toBe("figure");
        expect(c.className).toBe("stack");
        expect(texts(c, "p")).toEqual(["No data in this window."]);
        expect(one(c, "svg")).toBeNull();
      }
    }
  });

  test("labels alone, with no series, are still no data", () => {
    expect(texts(LineChart({ labels: ["a", "b"], series: [] }), "p")).toEqual(["No data in this window."]);
  });

  test("a line chart draws the polyline between the label slots, one point circle per value, with titles", () => {
    const c = LineChart({ labels: ["a", "b"], series: [{ name: "s", values: [0, 10] }] });
    const svg = one(c, "svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 640 180");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Line chart: s");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    const line = one(svg, "polyline");
    expect(line.getAttribute("points")).toBe("34.0,158.0 630.0,8.0");
    expect(line.getAttribute("stroke")).toBe("var(--accent)");
    expect(line.getAttribute("fill")).toBe("none");
    const circles = all(svg, "circle");
    expect(circles.map((n) => [n.getAttribute("cx"), n.getAttribute("cy"), n.getAttribute("r"), n.getAttribute("fill")])).toEqual([["34", "158", "2.4", "var(--accent)"], ["630", "8", "2.4", "var(--accent)"]]);
    expect(texts(svg, "title")).toEqual(["a s: 0", "b s: 10"]);
  });

  test("the chart height can be set and defaults to 180", () => {
    const c = LineChart({ labels: ["a"], series: [{ values: [1] }], height: 100 });
    expect(one(c, "svg").getAttribute("viewBox")).toBe("0 0 640 100");
    expect(one(LineChart({ labels: ["a"], series: [{ values: [1] }] }), "svg").getAttribute("viewBox")).toBe("0 0 640 180");
  });

  test("a single point sits at the left padding; unlabeled points are numbered in titles", () => {
    const c = LineChart({ series: [{ name: "s", values: [4] }] });
    const circle = one(c, "circle");
    expect(circle.getAttribute("cx")).toBe("34");
    expect(texts(c, "title")).toEqual(["1 s: 4"]);
    expect(texts(one(c, "svg"), "text").slice(-1)).toEqual(["1"]);
  });

  test("y ticks run from the top value down to the floor, floor at zero unless values go below", () => {
    const ticks = (series) => texts(one(LineChart({ labels: ["a", "b"], series }), "svg"), "text").slice(0, 4);
    expect(ticks([{ values: [0, 3] }])).toEqual(["3", "2", "1", "0"]);
    expect(ticks([{ values: [2, 5] }])).toEqual(["5", "3.3", "1.7", "0"]);
    expect(ticks([{ values: [-4, -2] }])).toEqual(["-2", "-2.7", "-3.3", "-4"]);
    expect(ticks([{ values: [0, 1] }])).toEqual(["1", "0.7", "0.3", "0"]);
  });

  test("a flat series gets a one-unit range; non-numbers are ignored for the range", () => {
    const ticks = (series) => texts(one(LineChart({ labels: ["a", "b"], series }), "svg"), "text").slice(0, 4);
    expect(ticks([{ values: [0, 0] }])).toEqual(["1", "0.7", "0.3", "0"]);
    expect(ticks([{ values: [Infinity, 2, "9", NaN] }])).toEqual(["2", "1.3", "0.7", "0"]);
    expect(ticks([{ values: ["x", "y"] }])).toEqual(["1", "0.7", "0.3", "0"]);
  });

  test("gridlines span the plot width at four evenly spaced heights", () => {
    const grid = all(one(LineChart({ labels: ["a", "b"], series: [{ values: [1, 2] }] }), "svg"), "line");
    expect(grid.map((l) => [l.getAttribute("class"), l.getAttribute("x1"), l.getAttribute("x2"), l.getAttribute("y1")])).toEqual([["grid", "34", "630", "8"], ["grid", "34", "630", "58"], ["grid", "34", "630", "108"], ["grid", "34", "630", "158"]]);
    const labels = all(one(LineChart({ labels: ["a", "b"], series: [{ values: [1, 2] }] }), "svg"), "text").slice(0, 4);
    expect(labels.map((t) => [t.getAttribute("x"), t.getAttribute("y"), t.getAttribute("text-anchor")])).toEqual([["28", "11", "end"], ["28", "61", "end"], ["28", "111", "end"], ["28", "161", "end"]]);
  });

  test("x labels: first anchors start, last anchors end, positions follow the slot", () => {
    const c = LineChart({ labels: ["a", "b", "c"], series: [{ values: [1, 2, 3] }] });
    const xs = all(one(c, "svg"), "text").slice(4);
    expect(xs.map((t) => [t.textContent, t.getAttribute("x"), t.getAttribute("y"), t.getAttribute("text-anchor")])).toEqual([["a", "34", "174", "start"], ["b", "332", "174", "middle"], ["c", "630", "174", "end"]]);
  });

  test("with many labels only every few are shown, always including the last", () => {
    const labels = Array.from({ length: 10 }, (_v, i) => "L" + i);
    const c = LineChart({ labels, series: [{ values: labels.map((_l, i) => i) }] });
    expect(texts(one(c, "svg"), "text").slice(4)).toEqual(["L0", "L2", "L4", "L6", "L8", "L9"]);
    const odd = Array.from({ length: 13 }, (_v, i) => "M" + i);
    const c2 = LineChart({ labels: odd, series: [{ values: odd.map((_l, i) => i) }] });
    expect(texts(one(c2, "svg"), "text").slice(4)).toEqual(["M0", "M3", "M6", "M9", "M12"]);
    const six = Array.from({ length: 6 }, (_v, i) => "N" + i);
    expect(texts(one(LineChart({ labels: six, series: [{ values: six.map((_l, i) => i) }] }), "svg"), "text").slice(4)).toEqual(six);
    const seven = Array.from({ length: 7 }, (_v, i) => "P" + i);
    expect(texts(one(LineChart({ labels: seven, series: [{ values: seven.map((_l, i) => i) }] }), "svg"), "text").slice(4)).toEqual(["P0", "P2", "P4", "P6"]);
  });

  test("same-day detection looks at the first ten characters of each label", () => {
    const text = (labels) => texts(one(LineChart({ labels, series: [{ values: [1, 2] }] }), "svg"), "text").slice(4);
    expect(text(["2026-03-01", "2026-03-01T10:15:00Z"])).toEqual(["03-01", "10:15"]);
    expect(text(["2026-03-01T10:15:00Z", "3026-03-01T11:20:00Z"])).toEqual(["03-01", "03-01"]);
  });

  test("skipping near the end: a label too close to the last one is dropped", () => {
    const labels = Array.from({ length: 14 }, (_v, i) => "Q" + i);
    const c = LineChart({ labels, series: [{ values: labels.map((_l, i) => i) }] });
    expect(texts(one(c, "svg"), "text").slice(4)).toEqual(["Q0", "Q3", "Q6", "Q9", "Q13"]);
    const labels12 = Array.from({ length: 12 }, (_v, i) => "R" + i);
    expect(texts(one(LineChart({ labels: labels12, series: [{ values: labels12.map((_l, i) => i) }] }), "svg"), "text").slice(4)).toEqual(["R0", "R2", "R4", "R6", "R8", "R10", "R11"]);
  });

  test("two labels sit at the two ends of the plot", () => {
    const xs = all(one(LineChart({ labels: ["a", "b"], series: [{ values: [1, 2] }] }), "svg"), "text").slice(4);
    expect(xs.map((t) => t.getAttribute("x"))).toEqual(["34", "630"]);
  });

  test("a line over several points is spaced evenly in x and scaled in y", () => {
    const c = LineChart({ labels: ["a", "b", "c", "d"], series: [{ values: [0, 3, 6, 9] }] });
    expect(one(c, "polyline").getAttribute("points")).toBe("34.0,158.0 232.7,108.0 431.3,58.0 630.0,8.0");
    const neg = LineChart({ labels: ["a", "b"], series: [{ values: [-5, 5] }] });
    expect(one(neg, "polyline").getAttribute("points")).toBe("34.0,158.0 630.0,8.0");
    const tall = LineChart({ labels: ["a", "b"], series: [{ values: [0, 10] }], height: 100 });
    expect(one(tall, "polyline").getAttribute("points")).toBe("34.0,78.0 630.0,8.0");
  });

  test("date labels show month-day, or the clock when all fall on one day", () => {
    const days = LineChart({ labels: ["2026-03-01T10:15:00Z", "2026-03-02T11:20:00Z"], series: [{ values: [1, 2] }] });
    expect(texts(one(days, "svg"), "text").slice(4)).toEqual(["03-01", "03-02"]);
    const same = LineChart({ labels: ["2026-03-01T10:15:00Z", "2026-03-01T11:20:00Z"], series: [{ values: [1, 2] }] });
    expect(texts(one(same, "svg"), "text").slice(4)).toEqual(["10:15", "11:20"]);
    const dateOnly = LineChart({ labels: ["2026-03-01", "2026-03-01"], series: [{ values: [1, 2] }] });
    expect(texts(one(dateOnly, "svg"), "text").slice(4)).toEqual(["03-01", "03-01"]);
    const mixed = LineChart({ labels: ["Mon", "2026-03-02"], series: [{ values: [1, 2] }] });
    expect(texts(one(mixed, "svg"), "text").slice(4)).toEqual(["Mon", "03-02"]);
  });

  test("a line chart always has a legend, defaulting names; a bar chart only with several series", () => {
    const line = LineChart({ labels: ["a"], series: [{ values: [1] }, { name: "two", values: [2] }] });
    const legend = one(line, "div.chart-legend");
    expect(legend.children.map((sp) => sp.children[1].textContent)).toEqual(["series 1", "two"]);
    expect(legend.children.map((sp) => [sp.style.color, sp.children[1].style.color])).toEqual([["var(--accent)", "var(--text-dim)"], ["var(--st-sub)", "var(--text-dim)"]]);
    expect(one(LineChart({ labels: ["a"], series: [{ values: [1] }] }), "div.chart-legend")).not.toBeNull();
    expect(one(BarChart({ labels: ["a"], series: [{ values: [1] }] }), "div.chart-legend")).toBeNull();
    expect(one(BarChart({ labels: ["a"], series: [{ values: [1] }, { values: [2] }] }), "div.chart-legend")).not.toBeNull();
  });

  test("series colors cycle after six", () => {
    const series = Array.from({ length: 7 }, (_v, i) => ({ name: "s" + i, values: [i] }));
    const strokes = all(one(LineChart({ labels: ["a"], series }), "svg"), "polyline").map((p) => p.getAttribute("stroke"));
    expect(strokes).toEqual(["var(--accent)", "var(--st-sub)", "var(--st-working)", "var(--st-input)", "var(--st-ok)", "var(--st-fail)", "var(--accent)"]);
  });

  test("series that are not arrays of values are dropped from the chart", () => {
    const c = LineChart({ labels: ["a"], series: [null, { name: "bad" }, { name: "ok", values: [3] }] });
    expect(one(c, "svg").getAttribute("aria-label")).toBe("Line chart: ok");
    expect(all(c, "polyline").length).toBe(1);
  });

  test("a bar chart draws one rect per value from the baseline, scaled to the range", () => {
    const c = BarChart({ labels: ["a", "b"], series: [{ name: "s", values: [0, 10] }] });
    expect(one(c, "svg").getAttribute("aria-label")).toBe("Bar chart: s");
    const rects = all(c, "rect");
    expect(rects.length).toBe(2);
    const slot = (640 - 34 - 10) / 2;
    const bw = slot * 0.72;
    expect(Number(rects[0].getAttribute("x"))).toBeCloseTo(34 + slot * 0.14, 6);
    expect(Number(rects[1].getAttribute("x"))).toBeCloseTo(34 + slot + slot * 0.14, 6);
    expect(Number(rects[0].getAttribute("width"))).toBeCloseTo(bw, 6);
    expect(rects.map((r) => [r.getAttribute("y"), r.getAttribute("height"), r.getAttribute("rx"), r.getAttribute("fill")])).toEqual([["158", "0", "2", "var(--accent)"], ["8", "150", "2", "var(--accent)"]]);
    expect(texts(c, "title")).toEqual(["a s: 0", "b s: 10"]);
  });

  test("several series split each slot into side by side bars, in their own colors", () => {
    const c = BarChart({ labels: ["a", "b"], series: [{ name: "x", values: [5, 5] }, { name: "y", values: [5, 5] }] });
    const rects = all(c, "rect");
    expect(rects.length).toBe(4);
    const slot = (640 - 34 - 10) / 2;
    const bw = (slot * 0.72) / 2;
    expect(rects.map((r) => Number(r.getAttribute("width")))).toEqual([bw, bw, bw, bw].map((v) => expect.closeTo(v, 6)));
    expect(Number(rects[2].getAttribute("x")) - Number(rects[0].getAttribute("x"))).toBeCloseTo(bw, 6);
    expect(Number(rects[1].getAttribute("x")) - Number(rects[0].getAttribute("x"))).toBeCloseTo(slot, 6);
    expect(rects.map((r) => r.getAttribute("fill"))).toEqual(["var(--accent)", "var(--accent)", "var(--st-sub)", "var(--st-sub)"]);
  });

  test("bars measure from the range floor when values go negative; unlabeled bars are numbered", () => {
    const c = BarChart({ series: [{ name: "s", values: [-5, 5] }] });
    expect(all(c, "rect").map((r) => [r.getAttribute("y"), r.getAttribute("height")])).toEqual([["158", "0"], ["8", "150"]]);
    expect(texts(c, "title")).toEqual(["1 s: -5", "2 s: 5"]);
    const noName = BarChart({ series: [{ values: [1] }] });
    expect(texts(noName, "title")).toEqual(["1 : 1"]);
    const tall = BarChart({ labels: ["a"], series: [{ values: [4] }], height: 100 });
    expect(one(tall, "rect").getAttribute("height")).toBe("70");
  });

  test("bars never get thinner than 2 and negative heights clamp to zero", () => {
    const many = Array.from({ length: 400 }, (_v, i) => i);
    const c = BarChart({ series: [{ values: many }] });
    expect(Number(one(c, "rect").getAttribute("width"))).toBe(2);
    const neg = BarChart({ labels: ["a", "b"], series: [{ values: [-5, 5] }] });
    expect(all(neg, "rect").map((r) => Number(r.getAttribute("height")) >= 0)).toEqual([true, true]);
  });

  test("a screen-reader summary gives the range and latest value per series", () => {
    const c = LineChart({ labels: ["a", "b", "c"], series: [{ name: "x", values: [3, 9, 5] }, { values: ["n/a"] }, { name: "z", values: ["4", 6] }] });
    expect(one(c, "p.sr-only").textContent).toBe("Line chart over 3 points. x: min 3, max 9, latest 5; series: no data; z: min 4, max 6, latest 6");
    expect(one(BarChart({ labels: ["a"], series: [{ name: "q", values: [1] }] }), "p.sr-only").textContent).toBe("Bar chart over 1 points. q: min 1, max 1, latest 1");
  });

  test("the data table lists each label with each series' value, numbering unlabeled rows", () => {
    const c = LineChart({ labels: ["a"], series: [{ name: "x", values: [1, 2] }, { values: [3] }] });
    const det = one(c, "details.chart-data");
    expect(one(det, "summary").textContent).toBe("Show data");
    expect(one(det, "caption").textContent).toBe("Chart data");
    expect(texts(det, "th")).toEqual(["Label", "x", "value"]);
    expect(all(det, "th").map((t) => t.getAttribute("scope"))).toEqual(["col", "col", "col"]);
    const rows = all(det, "tbody tr").map((r) => r.children.map((c2) => c2.textContent));
    expect(rows).toEqual([["a", "1", "3"], ["2", "2", ""]]);
    expect(all(det, "td.num").length).toBe(4);
    expect(one(det, "table").className).toBe("table dense");
  });
});

describe("StateBar", () => {
  test("one segment per non-empty state, sized by count, with a text alternative", () => {
    const bar = StateBar({ segments: [{ state: "working", count: 3 }, { state: "idle", count: 0 }, { state: "input", count: 1 }], label: "Fleet" });
    expect(bar.getAttribute("role")).toBe("img");
    expect(bar.getAttribute("aria-label")).toMatch(/^Fleet: 3 \S.*, 1 \S.*$/);
    const segs = all(bar, "span");
    expect(segs.length).toBe(2);
    expect(segs.map((s) => s.style.flexGrow)).toEqual([3, 1]);
    expect(segs[0].getAttribute("data-tone")).not.toBe(segs[1].getAttribute("data-tone"));
  });

  test("with nothing to show the label says none and an empty bar is drawn", () => {
    for (const segments of [undefined, [], [{ state: "working", count: 0 }]]) {
      const bar = StateBar({ segments });
      expect(bar.getAttribute("aria-label")).toBe("States: none");
      expect(bar.className).toBe("statebar");
      expect(all(bar, "span").map((s) => s.className)).toEqual(["statebar-empty"]);
    }
  });
});

describe("feed", () => {
  test("DayHeader is a level-3 heading with the label", () => {
    const d = DayHeader("Today");
    expect(d.className).toBe("day-header");
    expect(d.getAttribute("role")).toBe("heading");
    expect(d.getAttribute("aria-level")).toBe("3");
    expect(d.textContent).toBe("Today");
  });

  test("a feed item shows time, glyph, title, detail, project and a repeat count", () => {
    const it = FeedItem({ ts: "2026-03-01T10:15:30Z", kind: "chat", title: "Did a thing", detail: "more words", project: "atlas", count: 3 });
    expect(it.tag).toBe("div");
    expect(it.className).toBe("feed-item");
    const t = one(it, "time");
    expect(t.getAttribute("datetime")).toBe("2026-03-01T10:15:30Z");
    expect(t.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(one(it, "span.feed-glyph svg.icon")).not.toBeNull();
    expect(one(it, "span.feed-title").textContent).toBe("Did a thing");
    expect(one(it, "span.feed-detail").textContent).toBe("more words");
    expect(one(it, "span.tag").textContent).toBe("atlas");
    expect(one(it, "span.feed-count").textContent).toBe("x3");
    expect(one(it, "svg.icon path")).not.toBeNull();
  });

  test("optional parts are left out: no time, detail, project, or a count of one", () => {
    const it = FeedItem({ title: "Bare", count: 1 });
    expect(one(it, "time").textContent).toBe("");
    expect(one(it, "time").getAttribute("datetime")).toBeNull();
    expect(one(it, "span.feed-detail")).toBeNull();
    expect(one(it, "span.tag")).toBeNull();
    expect(one(it, "span.feed-count")).toBeNull();
    expect(one(it, "span.feed-glyph").children.length).toBe(0);
    expect(it.getAttribute("data-tone")).toBeNull();
    expect(FeedItem({ title: "x", count: 2 }).textContent).toContain("x2");
    expect(FeedItem({ title: undefined }).textContent).toBe("");
    expect(one(FeedItem({ title: undefined, onClick() {} }), "span.feed-title").textContent).toBe("");
    expect(one(FeedItem({ title: null, onClick() {} }), "span.feed-title").textContent).toBe("");
    expect(one(FeedItem({ title: null }), "span.feed-title").textContent).toBe("");
    expect(one(FeedItem({ title: 0 }), "span.feed-title").textContent).toBe("0");
  });

  test("a status gives the left-edge tone and a status dot unless a glyph kind is given", () => {
    const failed = FeedItem({ title: "x", status: "fail" });
    expect(failed.getAttribute("data-tone")).toBeTruthy();
    expect(one(failed, "span.feed-glyph span.dot")).not.toBeNull();
    const withKind = FeedItem({ title: "x", status: "fail", kind: "chat" });
    expect(one(withKind, "span.feed-glyph span.dot")).toBeNull();
    expect(withKind.getAttribute("data-tone")).toBe(failed.getAttribute("data-tone"));
  });

  test("a clickable item is a button with a chevron, fires its handler, and does not linkify its text", () => {
    let clicks = 0;
    const it = FeedItem({ title: "see /tmp/x/file.js:3", detail: "also /tmp/x/file.js", root: "/tmp/x", onClick: () => { clicks += 1; } });
    expect(it.tag).toBe("button");
    expect(it.getAttribute("type")).toBe("button");
    expect(it.className).toBe("feed-item");
    expect(one(it, "span.feed-title").textContent).toBe("see /tmp/x/file.js:3");
    expect(one(it, "span.feed-title").children.length).toBe(1);
    expect(one(it, "span.feed-detail").textContent).toBe("also /tmp/x/file.js");
    expect(all(it, "button").length).toBe(0);
    expect(it.querySelectorAll("svg.icon").length).toBe(1);
    it.click();
    expect(clicks).toBe(1);
  });

  test("a plain item linkifies paths in title and detail when it has a root", () => {
    const it = FeedItem({ title: "see /tmp/x/file.js:3", detail: "also /tmp/x/file.js", root: "/tmp/x" });
    expect(all(it, "button").length).toBeGreaterThan(1);
    expect(it.textContent).toContain("see ");
    const noRoot = FeedItem({ title: "see /tmp/x/file.js:3", detail: "d" });
    expect(all(noRoot, "button").length).toBe(0);
  });
});

describe("Timeline", () => {
  test("no items shows the empty text", () => {
    expect(Timeline().textContent).toBe("No events yet.");
    expect(Timeline({ items: [] }).className).toBe("dim");
    expect(Timeline({ items: [], empty: "Quiet" }).textContent).toBe("Quiet");
    expect(Timeline({ items: null }).tag).toBe("p");
  });

  test("each item has a status dot, title, optional time, meta tag and detail", () => {
    const tl = Timeline({ items: [{ ts: "10:00", title: "First", detail: "why", meta: "m", status: "fail" }, { title: null }, { title: 5, status: "ok" }] });
    expect(tl.tag).toBe("ol");
    expect(tl.className).toBe("timeline");
    const items = all(tl, "li.tl-item");
    expect(items.length).toBe(3);
    expect(texts(tl, "span.tl-title")).toEqual(["First", "", "5"]);
    expect(texts(tl, "time.tl-time")).toEqual(["10:00"]);
    expect(one(tl, "time.tl-time").getAttribute("datetime")).toBe("10:00");
    expect(texts(tl, "span.tag")).toEqual(["m"]);
    expect(texts(tl, "div.tl-detail")).toEqual(["why"]);
    expect(items[0].querySelector("span.dot").getAttribute("data-status")).toBe("fail");
    expect(items[1].querySelector("span.dot").getAttribute("data-status")).toBe("info");
  });
});

describe("ChannelMessage", () => {
  const msg = (o) => ChannelMessage({ ts: "2026-03-01T10:15:30Z", from: "lead", to: "all", body: "hello", ...o });

  test("a note shows time, sender, recipient and body with its kind and tone", () => {
    const m = msg();
    expect(m.className).toBe("chmsg");
    expect(m.getAttribute("data-kind")).toBe("note");
    expect(m.getAttribute("data-tone")).toBe("agent");
    expect(one(m, "time").textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(one(m, "time").getAttribute("datetime")).toBe("2026-03-01T10:15:30Z");
    expect(one(m, "span.who").textContent).toBe("lead");
    expect(one(m, "span.who").getAttribute("title")).toBe("lead");
    expect(one(m, "span.to").textContent).toBe("all");
    expect(one(m, "span.to").className).toBe("to dim");
    expect(one(m, "span.body").textContent).toBe("hello");
    expect(one(m, "span.body").className).toBe("body mono");
  });

  test("recipient shows with @ unless it is all or empty; sender defaults to system", () => {
    expect(one(msg({ to: "bob" }), "span.to").textContent).toBe("@bob");
    expect(one(msg({ to: undefined }), "span.to").textContent).toBe("all");
    expect(one(msg({ to: "" }), "span.to").textContent).toBe("all");
    const sys = msg({ from: undefined });
    expect(one(sys, "span.who").textContent).toBe("system");
    expect(sys.getAttribute("data-tone")).toBe("system");
  });

  test("tone: human, system by kind or sender, otherwise agent", () => {
    expect(msg({ from: "human" }).getAttribute("data-tone")).toBe("human");
    expect(msg({ kind: "system" }).getAttribute("data-tone")).toBe("system");
    expect(msg({ from: "system" }).getAttribute("data-tone")).toBe("system");
    expect(msg({ kind: "irc" }).getAttribute("data-tone")).toBe("agent");
    expect(msg({ kind: "irc" }).getAttribute("data-kind")).toBe("irc");
  });

  test("time is blank without a timestamp; body defaults to empty", () => {
    const m = msg({ ts: undefined, body: undefined });
    expect(one(m, "time").textContent).toBe("");
    expect(one(m, "time").getAttribute("datetime")).toBeNull();
    expect(one(m, "span.body").textContent).toBe("");
    expect(one(msg({ body: null }), "span.body").textContent).toBe("");
    expect(one(msg({ body: undefined, plain: true }), "span.body").textContent).toBe("");
    expect(one(msg({ body: null, plain: true, onPane() {} }), "span.body").textContent).toBe("");
    expect(one(msg({ body: 0 }), "span.body").textContent).toBe("0");
  });

  test("delivery states show a titled glyph; unknown or missing status shows an empty slot", () => {
    for (const [status, text] of [["queued", "Queued: the agent has not read it yet"], ["read", "Read"], ["delivered", "Delivered to the pane"], ["refused", "Refused"], ["undeliverable", "Undeliverable: no agent by that name is listening"]]) {
      const d = one(msg({ status }), "span.delivery");
      expect(d.getAttribute("title")).toBe(text);
      expect(d.getAttribute("aria-label")).toBe(text);
      expect(d.getAttribute("role")).toBe("img");
      expect(d.getAttribute("data-status")).toBe(status);
      expect(one(d, "svg.icon")).not.toBeNull();
    }
    const pathOf = (status) => one(one(msg({ status }), "span.delivery"), "path").getAttribute("d");
    expect(pathOf("queued")).toBe(icon("clock").children[0].getAttribute("d"));
    expect(pathOf("read")).toBe(icon("check").children[0].getAttribute("d"));
    expect(pathOf("delivered")).toBe(icon("check").children[0].getAttribute("d"));
    expect(pathOf("refused")).toBe(icon("close").children[0].getAttribute("d"));
    expect(pathOf("undeliverable")).toBe(icon("close").children[0].getAttribute("d"));
    expect(pathOf("queued")).not.toBe(pathOf("refused"));
    for (const status of [undefined, "weird"]) {
      const d = one(msg({ status }), "span.delivery");
      expect(d.getAttribute("title")).toBeNull();
      expect(d.children.length).toBe(0);
    }
  });

  test("plain mode shows a delivery glyph only for refused and undeliverable, and no empty slot", () => {
    expect(msg({ plain: true }).className).toBe("chmsg chmsg-plain");
    expect(one(msg({ plain: true, status: "delivered" }), "span.delivery")).toBeNull();
    expect(one(msg({ plain: true }), "span.delivery")).toBeNull();
    expect(one(msg({ plain: true, status: "refused" }), "span.delivery").getAttribute("title")).toBe("Refused");
    expect(one(msg({ plain: true, status: "undeliverable" }), "span.delivery").getAttribute("data-status")).toBe("undeliverable");
  });

  test("delivery text is appended with the status", () => {
    const t = one(msg({ status: "queued", delivery_text: "waiting on bob" }), "span.delivery-text");
    expect(t.textContent).toBe("waiting on bob");
    expect(t.getAttribute("data-status")).toBe("queued");
    expect(t.className).toBe("delivery-text dim");
    expect(one(msg(), "span.delivery-text")).toBeNull();
  });

  test("pane ids in the body become links to the agent when a handler is given", () => {
    const seen = [];
    const m = msg({ body: "see wA:p1 and wB2:p33 now", onPane: (id) => seen.push(id) });
    const links = all(m, "a");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["wA:p1", "#/agents?agent=wA%3Ap1"], ["wB2:p33", "#/agents?agent=wB2%3Ap33"]]);
    expect(one(m, "span.body").textContent).toBe("see wA:p1 and wB2:p33 now");
    const ev = fire(links[1], "click");
    expect(ev.prevented).toBe(true);
    expect(seen).toEqual(["wB2:p33"]);
    expect(all(msg({ body: "see wA:p1" }), "a").length).toBe(0);
    expect(all(msg({ body: "see wA:p1", onPane: () => {}, plain: true }), "a").length).toBe(1);
    expect(all(msg({ body: "no panes here", onPane: () => {} }), "a").length).toBe(0);
    expect(all(msg({ body: "xwA:p1y", onPane: () => {} }), "a").length).toBe(0);
  });

  test("an exit message reads the code: clean, failed with reason, failed, or unparsed", () => {
    const exit = (body, from) => ChannelMessage({ ts: "2026-03-01T10:15:30Z", from, kind: "exit", body });
    const ok = exit("exit 0", "bob");
    expect(ok.className).toBe("chmsg chmsg-exit");
    expect(ok.getAttribute("data-kind")).toBe("exit");
    expect(one(ok, "span.body").textContent).toBe("exited 0");
    expect(one(ok, "span.who").textContent).toBe("bob");
    expect(one(ok, "svg.hex").getAttribute("data-state")).toBe("done");
    expect(one(ok, "time").textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    const bad = exit("exit 2 [failed: boom]");
    expect(one(bad, "span.body").textContent).toBe("exited 2, failed: boom");
    expect(one(bad, "svg.hex").getAttribute("data-state")).toBe("fail");
    expect(one(bad, "span.who").textContent).toBe("agent");
    expect(one(exit("exit 3"), "span.body").textContent).toBe("exited 3, failed");
    expect(one(exit("exit -1"), "span.body").textContent).toBe("exited -1, failed");
    expect(one(exit("crashed hard"), "span.body").textContent).toBe("crashed hard");
    expect(one(exit(undefined), "span.body").textContent).toBe("exited");
    expect(one(exit("exit 0 extra"), "span.body").textContent).toBe("exited 0");
    expect(one(exit("not exit 5"), "span.body").textContent).toBe("not exit 5");
    expect(one(ChannelMessage({ kind: "exit", body: "exit 0" }), "time").textContent).toBe("");
  });
});

describe("ChannelList", () => {
  const scroller = (list) => list.children[0];
  const m = (i, ts) => ({ ts, from: "a", to: "all", body: "msg " + i });

  test("an empty list shows the empty text, default or given", () => {
    expect(texts(ChannelList({ messages: [] }), "p")).toEqual(["No messages."]);
    expect(texts(ChannelList({ messages: [], empty: "Nothing" }), "p")).toEqual(["Nothing"]);
    expect(texts(ChannelList(), "p")).toEqual(["No messages."]);
  });

  test("the log container and its new-messages button are labelled", () => {
    const w = ChannelList({ messages: [] });
    const box = scroller(w);
    expect(w.className).toBe("channel-wrap");
    expect([box.className, box.getAttribute("role"), box.getAttribute("aria-live"), box.getAttribute("tabindex"), box.getAttribute("aria-label")]).toEqual(["channel-list", "log", "off", "0", "Channel messages"]);
    expect(w.children[1].className).toBe("btn btn-sm new-msgs");
    expect(w.children[1].hidden).toBe(true);
  });

  test("messages get a day header when the day changes, and each is rendered", () => {
    const d1 = new Date(2026, 2, 1, 10).toISOString();
    const d1b = new Date(2026, 2, 1, 11).toISOString();
    const d2 = new Date(2026, 2, 2, 9).toISOString();
    const w = ChannelList({ messages: [m(1, d1), m(2, d1b), m(3, d2), m(4)] });
    expect(all(w, "div.day-header").length).toBe(2);
    expect(all(w, "div.chmsg").length).toBe(4);
    expect(texts(w, "span.body")).toEqual(["msg 1", "msg 2", "msg 3", "msg 4"]);
    const order = scroller(w).children.map((c) => c.className.split(" ")[0]);
    expect(order).toEqual(["day-header", "chmsg", "chmsg", "day-header", "chmsg", "chmsg"]);
  });

  test("handlers and options pass through to each message", () => {
    const seen = [];
    const w = ChannelList({ messages: [{ ...m(1), body: "go wA:p1" }], onPane: (id) => seen.push(id), plain: true });
    fire(one(w, "a"), "click");
    expect(seen).toEqual(["wA:p1"]);
    expect(all(w, "div.chmsg-plain").length).toBe(1);
  });

  test("it sticks to the bottom on draw and follows new messages while pinned", () => {
    const w = ChannelList({ messages: [m(1)] });
    const box = scroller(w);
    box.scrollHeight = 500;
    w.update([m(1), m(2)]);
    expect(box.scrollTop).toBe(500);
    expect(w.children[1].hidden).toBe(true);
  });

  test("once scrolled up it stops following and offers an N new button that sticks again", () => {
    const w = ChannelList({ messages: [m(1)] });
    const box = scroller(w);
    const more = w.children[1];
    Object.assign(box, { scrollHeight: 1000, scrollTop: 100, clientHeight: 300 });
    fire(box, "scroll");
    w.update([m(1), m(2), m(3)]);
    expect(box.scrollTop).toBe(100);
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe("2 new");
    w.update([m(1), m(2), m(3), m(4)]);
    expect(more.textContent).toBe("1 new");
    more.click();
    expect(box.scrollTop).toBe(1000);
    expect(more.hidden).toBe(true);
    w.update([m(1), m(2), m(3), m(4), m(5)]);
    expect(more.hidden).toBe(true);
  });

  test("scrolling back near the bottom (within 24px) pins again and hides the button", () => {
    const w = ChannelList({ messages: [m(1)] });
    const box = scroller(w);
    const more = w.children[1];
    Object.assign(box, { scrollHeight: 1000, scrollTop: 100, clientHeight: 300 });
    fire(box, "scroll");
    w.update([m(1), m(2)]);
    expect(more.hidden).toBe(false);
    Object.assign(box, { scrollTop: 677 }); // 1000 - 677 - 300 = 23
    fire(box, "scroll");
    expect(more.hidden).toBe(true);
    Object.assign(box, { scrollTop: 100 });
    fire(box, "scroll");
    Object.assign(box, { scrollTop: 676 }); // exactly 24: not pinned
    fire(box, "scroll");
    w.update([m(1), m(2), m(3)]);
    expect(box.scrollTop).toBe(676);
    expect(more.hidden).toBe(false);
  });

  test("a redraw with no new messages while scrolled up shows no button", () => {
    const w = ChannelList({ messages: [m(1), m(2)] });
    const box = scroller(w);
    Object.assign(box, { scrollHeight: 1000, scrollTop: 100, clientHeight: 300 });
    fire(box, "scroll");
    w.update([m(1), m(2)]);
    expect(w.children[1].hidden).toBe(true);
  });
});

describe("Composer", () => {
  const ta = (c) => one(c, "textarea");
  const sendBtn = (c) => all(c, "button").find((b) => b.className.includes("btn-primary") && b.textContent.startsWith("Send"));
  const seg = (c) => all(c, "div.seg button");

  test("an idle agent defaults to prompting it; the mode switch reflects that", () => {
    const c = Composer({ agent: { state: "idle", name: "bob" }, onSend() {} });
    expect(c.getAttribute("data-mode")).toBe("prompt");
    expect(c.className).toBe("cc-composer");
    expect(ta(c).getAttribute("placeholder")).toBe("Prompt bob");
    expect(seg(c).map((b) => [b.textContent, b.getAttribute("aria-checked"), b.attrs.disabled === undefined])).toEqual([["Prompt agent", "true", true], ["Post to channel", "false", true]]);
    expect(one(c, "div.seg").getAttribute("aria-label")).toBe("Send as");
    expect(one(c, "p.composer-note").hidden).toBe(true);
    expect(one(c, "div.field-msg").hidden).toBe(true);
    expect(one(c, "span.composer-count").hidden).toBe(true);
  });

  test("a busy or missing agent can only post; the note says why", () => {
    const working = Composer({ agent: { state: "working", name: "bob" }, onSend() {} });
    expect(working.getAttribute("data-mode")).toBe("post");
    expect(ta(working).getAttribute("placeholder")).toBe("Post to channel");
    expect(seg(working)[0].attrs.disabled).toBe("");
    expect(seg(working)[0].getAttribute("aria-disabled")).toBe("true");
    expect(seg(working)[1].getAttribute("aria-disabled")).toBeNull();
    expect(one(working, "p.composer-note").hidden).toBe(false);
    expect(one(working, "p.composer-note").textContent).toBe("Working. Post to channel to leave a note it will read.");
    const done = Composer({ agent: { state: "done", name: "bob" }, onSend() {} });
    expect(one(done, "p.composer-note").textContent).toBe("Prompting needs a Ready agent. Post to the channel instead.");
    const none = Composer({ agent: null, onSend() {} });
    expect(none.getAttribute("data-mode")).toBe("post");
    expect(one(none, "p.composer-note").hidden).toBe(true);
    expect(seg(none)[0].attrs.disabled).toBe("");
  });

  test("an agent waiting on input offers the terminal", () => {
    let opened = 0;
    const c = Composer({ agent: { state: "input", name: "bob" }, onSend() {}, onOpenTerminal: () => { opened += 1; } });
    const note = one(c, "p.composer-note");
    expect(note.textContent).toBe("Waiting on you in the terminal. Open terminal");
    const b = all(note, "button")[0];
    expect(b.className).toContain("btn-primary");
    expect(b.className).toContain("btn-sm");
    b.click();
    expect(opened).toBe(1);
    const noHandler = Composer({ agent: { state: "input", name: "bob" }, onSend() {} });
    expect(() => all(one(noHandler, "p.composer-note"), "button")[0].click()).not.toThrow();
  });

  test("a requested mode is honoured when possible, and prompt falls back to post when not allowed", () => {
    expect(Composer({ agent: { state: "idle", name: "b" }, mode: "post", onSend() {} }).getAttribute("data-mode")).toBe("post");
    expect(Composer({ agent: { state: "working", name: "b" }, mode: "prompt", onSend() {} }).getAttribute("data-mode")).toBe("post");
    expect(Composer({ agent: null, mode: "prompt", onSend() {} }).getAttribute("data-mode")).toBe("post");
    expect(Composer({ agent: { state: "idle", name: "b" }, mode: "prompt", onSend() {} }).getAttribute("data-mode")).toBe("prompt");
  });

  test("the prompt placeholder names the agent, or says agent; a custom placeholder wins", () => {
    expect(ta(Composer({ agent: { state: "idle" }, onSend() {} })).getAttribute("placeholder")).toBe("Prompt undefined");
    expect(ta(Composer({ agent: { state: "idle", name: "bob" }, placeholder: "Say it", onSend() {} })).getAttribute("placeholder")).toBe("Say it");
  });

  test("the textarea is a labelled message box limited to the prompt size", () => {
    const t = ta(Composer({ agent: null, onSend() {} }));
    expect(t.getAttribute("maxlength")).toBe(String(PROMPT_MAX));
    expect(PROMPT_MAX).toBe(8000);
    expect(t.getAttribute("aria-label")).toBe("Message");
    expect(t.getAttribute("rows")).toBe("1");
    expect(t.className).toBe("textarea composer-text");
  });

  test("clicking a mode in the switch changes it, repaints, and keeps the typed text", () => {
    const c = Composer({ agent: { state: "idle", name: "bob" }, onSend() {} });
    ta(c).value = "draft";
    seg(c)[1].click();
    expect(seg(c).map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(ta(c).placeholder).toBe("Post to channel");
    expect(ta(c).value).toBe("draft");
    seg(c)[0].click();
    expect(seg(c).map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(ta(c).placeholder).toBe("Prompt bob");
  });

  test("focusPost switches to posting and focus focuses the box", () => {
    let focused = 0;
    const c = Composer({ agent: { state: "idle", name: "bob" }, onSend() {} });
    ta(c).focus = () => { focused += 1; };
    c.focusPost();
    expect(seg(c).map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(focused).toBe(1);
    c.focus();
    expect(focused).toBe(2);
  });

  test("simple mode has no switch or note, always posts, and shows the lead node", () => {
    const lead = document.createElement("span");
    lead.textContent = "To: bob";
    const sent = [];
    const c = Composer({ agent: { state: "idle", name: "bob" }, simple: true, lead, onSend: async (m, t) => { sent.push([m, t]); } });
    expect(c.className).toBe("cc-composer cc-composer-simple");
    expect(c.getAttribute("data-mode")).toBe("prompt");
    expect(one(c, "div.seg")).toBeNull();
    expect(one(c, "p.composer-note")).toBeNull();
    expect(one(c, "div.composer-row").children[0]).toBe(lead);
    expect(one(c, "div.composer-row").children.length).toBe(3);
    expect(one(Composer({ agent: null, onSend() {} }), "div.composer-row").children.length).toBe(2);
  });

  test("Send submits the trimmed text in the current mode and clears the box on success", async () => {
    const sent = [];
    const c = Composer({ agent: { state: "idle", name: "bob" }, onSend: async (m, t) => { sent.push([m, t]); } });
    ta(c).value = "  hello there \n";
    ta(c).scrollHeight = 10;
    sendBtn(c).click();
    await flush();
    expect(sent).toEqual([["prompt", "hello there"]]);
    expect(ta(c).value).toBe("");
    expect(ta(c).style.height).toBe("56px");
    expect(sendBtn(c).textContent).toBe("Send");
    expect(ta(c).readOnly).toBe(false);
  });

  test("blank text is not sent and a second send during the first is ignored", async () => {
    let n = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const c = Composer({ agent: null, onSend: async () => { n += 1; await gate; } });
    ta(c).value = "   ";
    sendBtn(c).click();
    await flush();
    expect(n).toBe(0);
    ta(c).value = "x";
    sendBtn(c).click();
    sendBtn(c).click();
    await flush();
    expect(n).toBe(1);
    release();
    await flush();
  });

  test("while sending the box is read only and the button reads Sending and is busy", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const c = Composer({ agent: null, onSend: () => gate });
    ta(c).value = "x";
    sendBtn(c).click();
    await flush();
    expect(ta(c).readOnly).toBe(true);
    const b = all(c, "button").find((x) => x.textContent === "Sending");
    expect(b.getAttribute("aria-busy")).toBe("true");
    release();
    await flush();
    expect(ta(c).readOnly).toBe(false);
    expect(sendBtn(c).textContent).toBe("Send");
    expect(sendBtn(c).getAttribute("aria-busy")).toBeNull();
  });

  test("a failed send keeps the text and shows the error, why and what to do", async () => {
    const c = Composer({ agent: null, onSend: async () => { throw { error: "Pane is gone", why: "It exited", do: "Relaunch it" }; } });
    ta(c).value = "keep me";
    sendBtn(c).click();
    await flush();
    const err = one(c, "div.field-msg");
    expect(err.hidden).toBe(false);
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.children.map((n) => n.textContent)).toEqual(["Pane is gone", "It exited", "Relaunch it"]);
    expect(all(err, "div.dim").length).toBe(2);
    expect(ta(c).value).toBe("keep me");
    expect(ta(c).readOnly).toBe(false);
  });

  test("errors fall back to the message, then to a generic line; a retry clears the old error", async () => {
    let fail = new Error("plain message");
    const c = Composer({ agent: null, onSend: async () => { if (fail) throw fail; } });
    ta(c).value = "x";
    sendBtn(c).click();
    await flush();
    expect(one(c, "div.field-msg").textContent).toBe("plain message");
    expect(all(one(c, "div.field-msg"), "div.dim").length).toBe(0);
    fail = undefined;
    sendBtn(c).click();
    await flush();
    expect(one(c, "div.field-msg").hidden).toBe(true);
    fail = null;
    const c2 = Composer({ agent: null, onSend: async () => { throw undefined; } });
    ta(c2).value = "x";
    sendBtn(c2).click();
    await flush();
    expect(one(c2, "div.field-msg").textContent).toBe("Could not send");
  });

  test("Enter sends; Shift+Enter, composition and other keys do not; Mod+Enter always sends", async () => {
    const sent = [];
    const c = Composer({ agent: null, onSend: async (m, t) => { sent.push(t); } });
    const key = (e) => fire(ta(c), "keydown", e);
    ta(c).value = "one";
    let ev = key({ key: "Enter", shiftKey: false });
    expect(ev.prevented).toBe(true);
    await flush();
    ta(c).value = "two";
    ev = key({ key: "Enter", shiftKey: true });
    expect(ev.prevented).toBeUndefined();
    ev = key({ key: "a" });
    expect(ev.prevented).toBeUndefined();
    ev = key({ key: "Enter", shiftKey: true, ctrlKey: true });
    expect(ev.prevented).toBe(true);
    await flush();
    ta(c).value = "three";
    key({ key: "Enter", shiftKey: true, metaKey: true });
    await flush();
    ta(c).value = "four";
    fire(ta(c), "compositionstart");
    ev = key({ key: "Enter" });
    expect(ev.prevented).toBeUndefined();
    fire(ta(c), "compositionend");
    ev = key({ key: "Enter", isComposing: true });
    expect(ev.prevented).toBeUndefined();
    key({ key: "Enter" });
    await flush();
    expect(sent).toEqual(["one", "two", "three", "four"]);
  });

  test("the box grows with its content within 56 to 180px", () => {
    const c = Composer({ agent: null, onSend() {} });
    const t = ta(c);
    for (const [h, want] of [[10, "56px"], [56, "56px"], [100, "100px"], [180, "180px"], [400, "180px"]]) {
      t.scrollHeight = h;
      t.value = "x";
      fire(t, "input");
      expect(t.style.height).toBe(want);
    }
  });

  test("a character counter appears from 6000 characters", () => {
    const c = Composer({ agent: null, onSend() {} });
    const t = ta(c);
    const counter = one(c, "span.composer-count");
    expect(counter.hidden).toBe(true);
    t.value = "x".repeat(5999);
    fire(t, "input");
    expect(counter.hidden).toBe(true);
    t.value = "x".repeat(6000);
    fire(t, "input");
    expect(counter.hidden).toBe(false);
    expect(counter.textContent).toBe((6000).toLocaleString() + " of " + (8000).toLocaleString());
    t.value = "x";
    fire(t, "input");
    expect(counter.hidden).toBe(true);
  });

  test("a successful send hides the counter", async () => {
    const c = Composer({ agent: null, onSend: async () => {} });
    ta(c).value = "x".repeat(6500);
    fire(ta(c), "input");
    const counter = one(c, "span.composer-count");
    expect(counter.hidden).toBe(false);
    sendBtn(c).click();
    await flush();
    expect(counter.hidden).toBe(true);
  });
});

describe("PaneTile", () => {
  const agent = { state: "working", title: "Fix it", name: "fixer", workspace: "ws", cwd: "/p", pane_id: "wA:p1" };

  test("a tile shows its state, title and the project meta when there is no preview", () => {
    const t = PaneTile({ agent });
    expect(t.tag).toBe("article");
    expect(t.className).toBe("pane-tile");
    expect(t.getAttribute("data-state")).toBe("working");
    expect(one(t, "button.pane-title").textContent).toBe("Fix it");
    expect(one(t, "svg.hex")).not.toBeNull();
    expect(texts(t, "div.pane-meta div")).toEqual(["ws", "/p"]);
    expect(one(t, "pre")).toBeNull();
    expect(texts(t, "footer button")).toEqual(["Open terminal", "Prompt"]);
    expect(PaneTile({ agent: { state: "idle", name: "n" } }).querySelector("button.pane-title").textContent).toBe("n");
    expect(texts(PaneTile({ agent: { state: "idle", pane_id: "wA:p9" } }), "div.pane-meta div")).toEqual(["", "wA:p9"]);
  });

  test("a preview shows the last 8 lines, from an array or a newline string", () => {
    const lines = Array.from({ length: 12 }, (_v, i) => "l" + i);
    expect(one(PaneTile({ agent, preview: lines }), "pre.pane-out").textContent).toBe(lines.slice(4).join("\n"));
    expect(one(PaneTile({ agent, preview: lines.join("\n") }), "pre.pane-out").textContent).toBe(lines.slice(4).join("\n"));
    expect(one(PaneTile({ agent, preview: ["a", "b"] }), "pre").textContent).toBe("a\nb");
    expect(one(PaneTile({ agent, preview: [] }), "pre")).toBeNull();
    expect(one(PaneTile({ agent, preview: "" }), "pre")).toBeNull();
  });

  test("the tile's buttons call their handlers", () => {
    const log = [];
    const t = PaneTile({ agent, onOpen: () => log.push("open"), onTerminal: () => log.push("term"), onPrompt: () => log.push("prompt") });
    one(t, "button.pane-title").click();
    all(t, "footer button").forEach((b) => b.click());
    expect(log).toEqual(["open", "term", "prompt"]);
    expect(all(t, "footer button").map((b) => b.className)).toEqual(["btn btn-sm", "btn btn-ghost btn-sm"]);
  });
});

describe("terminal and log helpers", () => {
  test("stripAnsi removes colour, cursor, title and charset codes and stray control bytes but keeps text", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
    expect(stripAnsi("a\u001b[2Kb\u001b[?25hc")).toBe("abc");
    expect(stripAnsi("\u001b]0;title\u0007text")).toBe("text");
    expect(stripAnsi("\u001b]0;title\u001b\\text")).toBe("text");
    expect(stripAnsi("\u001b(Bx\u001b=y\u001b>z")).toBe("xyz");
    expect(stripAnsi("a\u0000b\u0007c\u0008d\u000be\u000cf\u000eg\u001ah\u001ci\u001fj")).toBe("abcdefghij");
    expect(stripAnsi("keep\ttabs\nand\r\nnewlines")).toBe("keep\ttabs\nand\r\nnewlines");
    expect(stripAnsi(undefined)).toBe("");
    expect(stripAnsi(null)).toBe("");
    expect(stripAnsi(0)).toBe("0");
  });

  test("Terminal is a labelled log with ansi and trailing whitespace removed", () => {
    const t = Terminal({ text: "\u001b[32mok\u001b[0m line\n\n  " });
    expect(t.tag).toBe("pre");
    expect([t.className, t.getAttribute("role"), t.getAttribute("aria-live"), t.getAttribute("tabindex"), t.getAttribute("aria-label")]).toEqual(["terminal", "log", "off", "0", "Terminal output"]);
    expect(t.textContent).toBe("ok line");
    expect(Terminal({ label: "Seat" }).getAttribute("aria-label")).toBe("Seat");
    expect(Terminal().textContent).toBe("");
  });

  test("Terminal sticks to the bottom while following, and only follows when pinned", () => {
    const t = Terminal({ text: "a" });
    Object.assign(t, { scrollHeight: 400, scrollTop: 0, clientHeight: 100 });
    fire(t, "scroll");
    t.update("a\nb");
    expect(t.scrollTop).toBe(0); // scrolled up: not pinned
    expect(t.textContent).toBe("a\nb");
    fire(t, "scroll");
    Object.assign(t, { scrollTop: 0 });
    t.update("c");
    expect(t.scrollTop).toBe(0);
    Object.assign(t, { scrollTop: 280 }); // 400 - 280 - 100 = 20 < 24
    fire(t, "scroll");
    t.update("d");
    expect(t.scrollTop).toBe(400);
  });

  test("Terminal starts pinned, honours follow=false, and setFollow(true) jumps to the end", () => {
    const t = Terminal({ text: "a" });
    Object.assign(t, { scrollHeight: 300 });
    t.update("b"); // never scrolled: still pinned
    expect(t.scrollTop).toBe(300);
    const f = Terminal({ text: "a", follow: false });
    Object.assign(f, { scrollHeight: 300, scrollTop: 0, clientHeight: 100 });
    f.update("b");
    expect(f.scrollTop).toBe(0);
    f.setFollow(true);
    expect(f.scrollTop).toBe(300);
    Object.assign(f, { scrollTop: 0 });
    f.setFollow(false);
    expect(f.scrollTop).toBe(0);
    f.update("c");
    expect(f.scrollTop).toBe(0);
    f.setFollow(1);
    expect(f.scrollTop).toBe(300);
    const s = Terminal({ text: "x" });
    Object.assign(s, { scrollHeight: 50 });
    s.setFollow(true);
    expect(s.scrollTop).toBe(50);
  });

  test("the pinned test is within 24px of the bottom, exclusive", () => {
    for (const make of [() => Terminal({ text: "a" }), () => LogView({ lines: ["a"] })]) {
      const n = make();
      Object.assign(n, { scrollHeight: 1000, clientHeight: 100, scrollTop: 877 }); // gap 23
      fire(n, "scroll");
      n.update(n.tag === "pre" ? "b" : ["b"]);
      expect(n.scrollTop).toBe(1000);
      Object.assign(n, { scrollTop: 876 }); // gap 24
      fire(n, "scroll");
      n.update(n.tag === "pre" ? "c" : ["c"]);
      expect(n.scrollTop).toBe(876);
    }
  });

  test("with follow=false nothing is scrolled even while at the bottom", () => {
    const t = Terminal({ text: "a", follow: false });
    Object.assign(t, { scrollHeight: 300 });
    t.update("b");
    expect(t.scrollTop).toBeUndefined();
    const v = LogView({ lines: ["a"], follow: false });
    Object.assign(v, { scrollHeight: 300 });
    v.update(["b"]);
    expect(v.scrollTop).toBeUndefined();
    const on = LogView({ lines: ["a"], follow: true });
    Object.assign(on, { scrollHeight: 300 });
    on.update(["b"]);
    expect(on.scrollTop).toBe(300);
  });

  test("an initial Terminal with follow on is scrolled to its height", () => {
    const pre = Terminal({ text: "a" });
    expect(pre.scrollTop).toBe(pre.scrollHeight);
    const off = Terminal({ text: "a", follow: false });
    expect(off.scrollTop).toBeUndefined();
  });

  test("LogView renders a line per item with optional timestamp, stripping ansi", () => {
    const v = LogView({ lines: ["plain", { text: "\u001b[1mbold\u001b[0m", ts: "10:00" }, { text: "x" }] });
    expect([v.className, v.getAttribute("role"), v.getAttribute("aria-live"), v.getAttribute("tabindex"), v.getAttribute("aria-label")]).toEqual(["logview", "log", "off", "0", "Log"]);
    expect(all(v, "div.log-line").length).toBe(3);
    expect(texts(v, "span.ts")).toEqual(["", "10:00", ""]);
    expect(texts(v, "span.mono")).toEqual(["", "plain", "10:00", "bold", "", "x"]);
    expect(LogView({ label: "Out" }).getAttribute("aria-label")).toBe("Out");
    expect(all(LogView(), "div.log-line").length).toBe(0);
  });

  test("LogView update replaces the lines and follows only while pinned", () => {
    const v = LogView({ lines: ["a"] });
    expect(v.isPinned()).toBe(true);
    Object.assign(v, { scrollHeight: 400, scrollTop: 0, clientHeight: 100 });
    fire(v, "scroll");
    expect(v.isPinned()).toBe(false);
    v.update(["x", "y"]);
    expect(all(v, "div.log-line").length).toBe(2);
    expect(v.scrollTop).toBe(0);
    v.update(null);
    expect(all(v, "div.log-line").length).toBe(0);
    Object.assign(v, { scrollTop: 280 });
    fire(v, "scroll");
    expect(v.isPinned()).toBe(true);
    v.update(["z"]);
    expect(v.scrollTop).toBe(400);
  });

  test("LogView follow controls: setFollow, stick, and follow=false", () => {
    const v = LogView({ lines: ["a"], follow: false });
    Object.assign(v, { scrollHeight: 300, scrollTop: 0, clientHeight: 100 });
    fire(v, "scroll");
    v.update(["b"]);
    expect(v.scrollTop).toBe(0);
    v.setFollow(true);
    expect(v.scrollTop).toBe(300);
    Object.assign(v, { scrollTop: 0 });
    v.setFollow(false);
    expect(v.scrollTop).toBe(0);
    v.stick();
    expect(v.scrollTop).toBe(300);
    expect(v.isPinned()).toBe(true);
    const first = LogView({ lines: ["a"] });
    expect(first.scrollTop).toBe(first.scrollHeight);
  });
});

describe("FilterBar", () => {
  test("a search box is labelled from its label, placeholder or Search, and reports input", () => {
    const seen = [];
    const bar = FilterBar({ search: { value: "q", placeholder: "Find", onInput: (v) => seen.push(v) } });
    expect(bar.className).toBe("filterbar");
    expect(bar.getAttribute("role")).toBe("search");
    const input = one(bar, "input");
    expect([input.className, input.getAttribute("type"), input.value, input.getAttribute("placeholder"), input.getAttribute("aria-label")]).toEqual(["input search", "search", "q", "Find", "Find"]);
    fire(input, "input", { target: { value: "abc" } });
    expect(seen).toEqual(["abc"]);
    const labelled = one(FilterBar({ search: { label: "Look up", placeholder: "Find" } }), "input");
    expect(labelled.getAttribute("aria-label")).toBe("Look up");
    const bare = one(FilterBar({ search: {} }), "input");
    expect([bare.getAttribute("placeholder"), bare.getAttribute("aria-label"), bare.value]).toEqual(["Search", "Search", ""]);
    expect(() => fire(bare, "input", { target: { value: "x" } })).not.toThrow();
    expect(one(FilterBar({}), "input")).toBeNull();
  });

  test("each facet is a labelled select with counted options and the current one selected", () => {
    const changes = [];
    const bar = FilterBar({ facets: [{ key: "state", label: "State", value: 2, options: [{ value: 1, label: "One" }, { value: 2, label: "Two", count: 5 }, { value: 0, label: "Zero", count: 0 }] }], onChange: (k, v) => changes.push([k, v]) });
    const label = one(bar, "label.row");
    expect(one(label, "span.dim").textContent).toBe("State");
    const sel = one(label, "select");
    expect(sel.getAttribute("aria-label")).toBe("State");
    expect(sel.className).toBe("select");
    const opts = all(sel, "option");
    expect(opts.map((o) => o.textContent)).toEqual(["One", "Two (5)", "Zero (0)"]);
    expect(opts.map((o) => o.value)).toEqual([1, 2, 0]);
    expect(opts.map((o) => Boolean(o.selected))).toEqual([false, true, false]);
    fire(sel, "change", { target: { value: "1" } });
    expect(changes).toEqual([["state", "1"]]);
    const noHandler = one(FilterBar({ facets: [{ key: "k", label: "K", options: [] }] }), "select");
    expect(() => fire(noHandler, "change", { target: { value: "" } })).not.toThrow();
    expect(all(noHandler, "option").length).toBe(0);
  });

  test("actions sit in a right-aligned row, only when there are some", () => {
    const b = document.createElement("button");
    const bar = FilterBar({ actions: [b] });
    const row = bar.children[bar.children.length - 1];
    expect(row.className).toBe("row");
    expect(row.style.marginLeft).toBe("auto");
    expect(row.children[0]).toBe(b);
    expect(FilterBar({ actions: [] }).children.length).toBe(0);
    expect(FilterBar({}).children.length).toBe(0);
  });
});
