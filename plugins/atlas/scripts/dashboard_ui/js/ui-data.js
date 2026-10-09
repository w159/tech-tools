// Command Center components, part 3: charts, feed, channel message, composer, pane tile, terminal/log
// (MASTER 9.4, 9.5, 9.11, 9.12 and the legacy chart/log helpers). Import from components.js, not from here.

import { h, s, icon, clear, append, fmtTime } from "./dom.js";
import { StatusDot, Button, describeStatus } from "./ui-core.js";
import { HexGlyph } from "./glyphs.js";
import { linkifyPaths } from "./integrations.js";

// ---- charts (hand-rolled SVG; every chart has a text summary + a "Show data" table) -------------------

const SERIES_COLORS = ["var(--accent)", "var(--st-sub)", "var(--st-working)", "var(--st-input)", "var(--st-ok)", "var(--st-fail)"];

function extent(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return [0, 1];
  const lo = Math.min(0, ...nums);
  const hi = Math.max(...nums);
  return [lo, hi === lo ? lo + 1 : hi];
}

function legend(series) {
  return h("div", { class: "chart-legend" }, series.map((ser, i) => h("span", { style: { color: SERIES_COLORS[i % SERIES_COLORS.length] } }, h("i"), h("span", { style: { color: "var(--text-dim)" } }, ser.name || "series " + (i + 1)))));
}

function tickLabel(l, sameDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(l));
  if (!m) return String(l);
  return sameDay && m[4] ? m[4] + ":" + m[5] : m[2] + "-" + m[3];
}

function axes(svg, w, h2, pad, lo, hi, labels) {
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.t + ((h2 - pad.t - pad.b) * i) / 3;
    const v = hi - ((hi - lo) * i) / 3;
    svg.appendChild(s("line", { class: "grid", x1: pad.l, x2: w - pad.r, y1: y, y2: y }));
    svg.appendChild(s("text", { x: pad.l - 6, y: y + 3, "text-anchor": "end" }, Number.isInteger(v) ? String(v) : v.toFixed(1)));
  }
  const n = labels.length;
  const sameDay = new Set(labels.map((l) => String(l).slice(0, 10))).size === 1;
  const step = Math.max(1, Math.ceil(n / 6));
  labels.forEach((l, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    if (i !== n - 1 && n - 1 - i < step / 2) return;
    const x = n === 1 ? pad.l : pad.l + ((w - pad.l - pad.r) * i) / (n - 1);
    svg.appendChild(s("text", { x, y: h2 - 6, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" }, tickLabel(l, sameDay)));
  });
}

function dataTable(lab, ser) {
  const n = Math.max(lab.length, ...ser.map((x) => x.values.length));
  const head = h("tr", null, h("th", { scope: "col" }, "Label"), ser.map((x) => h("th", { scope: "col" }, x.name || "value")));
  const rows = Array.from({ length: n }, (_v, i) =>
    h("tr", null, h("td", null, String(lab[i] === undefined ? i + 1 : lab[i])), ser.map((x) => h("td", { class: "num" }, x.values[i] === undefined ? "" : String(x.values[i]))))
  );
  const table = h("table", { class: "table dense" }, h("caption", { class: "sr-only" }, "Chart data"), h("thead", null, head), h("tbody", null, rows));
  return h("details", { class: "chart-data" }, h("summary", null, "Show data"), h("div", { class: "table-wrap" }, table));
}

function summary(kind, lab, ser) {
  const parts = ser.map((x) => {
    const v = x.values.filter((n) => Number.isFinite(Number(n))).map(Number);
    return (x.name || "series") + ": " + (v.length ? "min " + Math.min(...v) + ", max " + Math.max(...v) + ", latest " + v[v.length - 1] : "no data");
  });
  return h("p", { class: "sr-only" }, kind + " over " + Math.max(lab.length, ...ser.map((x) => x.values.length)) + " points. " + parts.join("; "));
}

function chartBase(kind, labels, series, height, plot) {
  const ser = (series || []).filter((x) => x && Array.isArray(x.values));
  const lab = labels || [];
  const n = Math.max(lab.length, ...ser.map((x) => x.values.length), 0);
  const wrap = h("figure", { class: "stack" });
  if (!n || !ser.length) {
    wrap.appendChild(h("p", { class: "dim" }, "No data in this window."));
    return wrap;
  }
  const H = height || 180;
  const W = 640;
  const pad = { l: 34, r: 10, t: 8, b: 22 };
  const [lo, hi] = extent(ser.flatMap((x) => x.values));
  const svg = s("svg", { class: "chart", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": kind + ": " + ser.map((x) => x.name).join(", "), preserveAspectRatio: "xMidYMid meet" });
  axes(svg, W, H, pad, lo, hi, lab.length ? lab : ser[0].values.map((_v, i) => i + 1));
  plot(svg, { ser, lab, n, W, H, pad, lo, hi });
  wrap.append(svg, summary(kind, lab, ser));
  if (ser.length > 1 || kind === "Line chart") wrap.appendChild(legend(ser));
  wrap.appendChild(dataTable(lab, ser));
  return wrap;
}

export function LineChart({ labels, series, height } = {}) {
  return chartBase("Line chart", labels, series, height, (svg, { ser, lab, n, W, H, pad, lo, hi }) => {
    ser.forEach((x, idx) => {
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      const pts = x.values.map((v, i) => [n === 1 ? pad.l : pad.l + ((W - pad.l - pad.r) * i) / (n - 1), pad.t + (H - pad.t - pad.b) * (1 - (Number(v) - lo) / (hi - lo))]);
      svg.appendChild(s("polyline", { points: pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "), fill: "none", stroke: color, "stroke-width": "1.75", "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
      pts.forEach((p, i) => svg.appendChild(s("circle", { cx: p[0], cy: p[1], r: "2.4", fill: color }, s("title", null, (lab[i] || i + 1) + " " + (x.name || "") + ": " + x.values[i]))));
    });
  });
}

export function BarChart({ labels, series, height } = {}) {
  return chartBase("Bar chart", labels, series, height, (svg, { ser, lab, n, W, H, pad, lo, hi }) => {
    const slot = (W - pad.l - pad.r) / n;
    const bw = Math.max(2, (slot * 0.72) / ser.length);
    ser.forEach((x, idx) => {
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      x.values.forEach((v, i) => {
        const hgt = (H - pad.t - pad.b) * ((Number(v) - lo) / (hi - lo));
        svg.appendChild(s("rect", { x: pad.l + slot * i + slot * 0.14 + bw * idx, y: H - pad.b - hgt, width: bw, height: Math.max(0, hgt), rx: 2, fill: color }, s("title", null, (lab[i] || i + 1) + " " + (x.name || "") + ": " + v)));
      });
    });
  });
}

// StateBar({ segments: [{ state, count }] }): stacked bar of agent states with text alternative.
export function StateBar({ segments, label } = {}) {
  const segs = (segments || []).filter((x) => x.count > 0);
  const total = segs.reduce((n, x) => n + x.count, 0);
  const text = segs.map((x) => x.count + " " + describeStatus(x.state).word.toLowerCase()).join(", ");
  return h("div", { class: "statebar", role: "img", "aria-label": (label || "States") + ": " + (text || "none") }, total ? segs.map((x) => h("span", { "data-tone": describeStatus(x.state).tone, style: { flexGrow: x.count } })) : h("span", { class: "statebar-empty" }));
}

// ---- 9.5 feed item / timeline ---------------------------------------------------------------------------

// DayHeader(label): sticky 28px header, sentence case.
export function DayHeader(label) {
  return h("div", { class: "day-header", role: "heading", "aria-level": "3" }, label);
}

// FeedItem({ ts, kind (icon), title, detail, status, project, count, onClick }): min 44px; status color only on glyph + left edge.
export function FeedItem({ ts, kind, title, detail, status, project, count, onClick, root } = {}) {
  const d = status ? describeStatus(status) : null;
  const body = [
    h("time", { class: "feed-time num", datetime: ts ? String(ts) : null }, ts ? fmtTime(ts) : ""),
    h("span", { class: "feed-glyph" }, kind ? icon(kind) : d ? StatusDot({ status: d.raw }) : null),
    h("span", { class: "feed-body" }, h("span", { class: "feed-title" }, title === undefined || title === null ? "" : onClick ? String(title) : linkifyPaths(title, root)), detail ? h("span", { class: "feed-detail" }, onClick ? String(detail) : linkifyPaths(detail, root)) : null),
    project ? h("span", { class: "tag" }, String(project)) : null,
    count && count > 1 ? h("span", { class: "feed-count num" }, "x" + count) : null,
    onClick ? icon("chevron-right") : null,
  ];
  const attrs = { class: "feed-item", "data-tone": d ? d.tone : null };
  return onClick ? h("button", { ...attrs, type: "button", onClick }, body) : h("div", attrs, body);
}

// Legacy vertical timeline (Timeline({ items: [{ ts, title, detail?, status?, meta? }] })).
export function Timeline({ items, empty } = {}) {
  const list = items || [];
  if (!list.length) return h("p", { class: "dim" }, empty || "No events yet.");
  return h(
    "ol",
    { class: "timeline" },
    list.map((it) =>
      h("li", { class: "tl-item" }, StatusDot({ status: it.status || "info" }), h("div", null, h("div", { class: "tl-head" }, h("span", { class: "tl-title" }, it.title === undefined || it.title === null ? "" : String(it.title)), it.ts ? h("time", { class: "tl-time num", datetime: String(it.ts) }, String(it.ts)) : null, it.meta ? h("span", { class: "tag" }, String(it.meta)) : null), it.detail ? h("div", { class: "tl-detail" }, String(it.detail)) : null))
    )
  );
}

// ---- 9.11 channel (IRC) message ---------------------------------------------------------------------------

const DELIVERY = {
  queued: ["clock", "Queued: the agent has not read it yet"],
  read: ["check", "Read"],
  delivered: ["check", "Delivered to the pane"],
  refused: ["close", "Refused"],
  undeliverable: ["close", "Undeliverable: no agent by that name is listening"],
};
const PANE_REF = /\b(w[A-Za-z0-9]+:p\d+)\b/g;

// Body text with pane ids (wA:p1) linkified into inspector links via onPane(paneId).
function linkify(text, onPane, root) {
  return linkifyPaths(text, root, (s) => paneLinks(s, onPane));
}

function paneLinks(text, onPane) {
  if (!onPane) return String(text);
  const out = [];
  let last = 0;
  String(text).replace(PANE_REF, (m, id, at) => {
    out.push(text.slice(last, at), h("a", { href: "#/agents?agent=" + encodeURIComponent(id), onClick: (e) => { e.preventDefault(); onPane(id); } }, id));
    last = at + m.length;
    return m;
  });
  out.push(String(text).slice(last));
  return out;
}

// ChannelMessage({ ts, from, to, body, kind: note|irc|exit|system, status, onPane, self, plain, delivery_text })
// plain: body is plain mono text (only pane ids stay links); the delivery glyph shows only for refused/undeliverable.
export function ChannelMessage({ ts, from, to, body, kind, status, onPane, root, plain, delivery_text } = {}) {
  const k = kind || "note";
  if (k === "exit") {
    const m = /^exit (-?\d+)(?: \[failed: (.*)\])?/.exec(String(body || ""));
    const code = m ? Number(m[1]) : null;
    const fail = code !== null && code !== 0;
    return h("div", { class: "chmsg chmsg-exit", "data-kind": "exit" }, h("time", { class: "ts num" }, ts ? fmtTime(ts) : ""), HexGlyph(fail ? "fail" : "done", { size: "mini" }), h("span", { class: "who" }, from || "agent"), h("span", { class: "body" }, code === null ? String(body || "exited") : fail ? "exited " + code + ", failed" + (m[2] ? ": " + m[2] : "") : "exited 0"));
  }
  const who = from || "system";
  const tone = who === "human" ? "human" : k === "system" || who === "system" ? "system" : "agent";
  const d = status && DELIVERY[status] && (!plain || status === "refused" || status === "undeliverable") ? DELIVERY[status] : null;
  return h(
    "div",
    { class: ["chmsg", plain ? "chmsg-plain" : ""], "data-kind": k, "data-tone": tone },
    h("time", { class: "ts num", datetime: ts ? String(ts) : null }, ts ? fmtTime(ts) : ""),
    h("span", { class: "who", title: who }, who),
    h("span", { class: "to dim" }, to && to !== "all" ? "@" + to : "all"),
    h("span", { class: "body mono" }, plain ? paneLinks(body === undefined || body === null ? "" : body, onPane) : linkify(body === undefined || body === null ? "" : body, onPane, root)),
    d ? h("span", { class: "delivery", "data-status": status, title: d[1], role: "img", "aria-label": d[1] }, icon(d[0])) : plain ? null : h("span", { class: "delivery" }),
    delivery_text ? h("span", { class: "delivery-text dim", "data-status": status }, delivery_text) : null
  );
}

// ChannelList({ messages, onPane, empty, plain }) -> scroll container that pins to the bottom unless the user scrolled up;
// a "N new" button appears otherwise. .update(messages) re-renders.
export function ChannelList({ messages, onPane, empty, root, plain } = {}) {
  const box = h("div", { class: "channel-list", role: "log", "aria-live": "off", tabindex: "0", "aria-label": "Channel messages" });
  const more = h("button", { class: "btn btn-sm new-msgs", type: "button", hidden: true, onClick: () => stick() }, "");
  const wrap = h("div", { class: "channel-wrap" }, box, more);
  let pinned = true;
  let shown = 0;
  const stick = () => {
    box.scrollTop = box.scrollHeight;
    pinned = true;
    more.hidden = true;
  };
  box.addEventListener("scroll", () => {
    pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    if (pinned) more.hidden = true;
  });
  const draw = (list) => {
    clear(box);
    if (!list.length) box.appendChild(h("p", { class: "dim", style: { padding: "var(--s-3)" } }, empty || "No messages."));
    let day = "";
    for (const m of list) {
      const dkey = m.ts ? new Date(m.ts).toDateString() : "";
      if (dkey && dkey !== day) {
        day = dkey;
        box.appendChild(DayHeader(new Date(m.ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })));
      }
      box.appendChild(ChannelMessage({ ...m, onPane, root, plain }));
    }
    const fresh = list.length - shown;
    if (pinned) stick();
    else if (fresh > 0 && shown > 0) {
      more.textContent = fresh + " new";
      more.hidden = false;
    }
    shown = list.length;
  };
  wrap.update = draw;
  draw(messages || []);
  return wrap;
}

// ---- 9.12 composer -----------------------------------------------------------------------------------------

export const PROMPT_MAX = 8000;
const COUNTER_AT = 6000;

// Composer({ agent ({state,name} or null), onSend(mode, text) -> Promise (reject with {error,why,do} to show inline), onOpenTerminal, mode, simple, lead, placeholder })
// Modes: "prompt" (only when the agent is Ready) | "post" (channel). Enter sends, Shift+Enter newline, Mod+Enter always sends, IME-safe.
// States: idle, sending (readonly, "Sending"), error (inline error + why + do, text retained).
// simple: no mode switch or note, always mode "post" (the caller routes by its own recipient); lead = node shown before the textarea.
export function Composer({ agent, onSend, onOpenTerminal, mode, simple, lead, placeholder } = {}) {
  const state = agent ? agent.state : null;
  const canPrompt = Boolean(agent) && state === "idle";
  let current = mode || (canPrompt ? "prompt" : "post");
  if (current === "prompt" && !canPrompt) current = "post";
  const ta = h("textarea", { class: "textarea composer-text", rows: "1", maxlength: String(PROMPT_MAX), "aria-label": "Message", placeholder: placeholder || (current === "prompt" ? "Prompt " + (agent ? agent.name : "agent") : "Post to channel") });
  const counter = h("span", { class: "composer-count num", hidden: true });
  const err = h("div", { class: "field-msg", role: "alert", hidden: true });
  const send = Button({ label: "Send", variant: "primary", onClick: () => submit() });
  const note = h("p", { class: "composer-note", hidden: true });
  const seg = h("div", { class: "seg", role: "radiogroup", "aria-label": "Send as" });
  let busy = false;
  const grow = () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(180, Math.max(56, ta.scrollHeight)) + "px";
  };
  const paint = () => {
    if (simple) return;
    clear(seg);
    for (const [id, label, ok] of [["prompt", "Prompt agent", canPrompt], ["post", "Post to channel", true]]) {
      seg.appendChild(h("button", { class: "seg-btn", type: "button", role: "radio", "aria-checked": current === id ? "true" : "false", disabled: !ok, "aria-disabled": ok ? null : "true", onClick: () => { current = id; paint(); ta.focus(); } }, label));
    }
    ta.placeholder = current === "prompt" ? "Prompt " + (agent ? agent.name : "agent") : "Post to channel";
    note.hidden = true;
    if (agent && !canPrompt) {
      note.hidden = false;
      clear(note);
      if (state === "working") note.append("Working. Post to channel to leave a note it will read.");
      else if (state === "input") note.append("Waiting on you in the terminal. ", Button({ label: "Open terminal", variant: "primary", size: "sm", onClick: () => onOpenTerminal && onOpenTerminal() }));
      else note.append("Prompting needs a Ready agent. Post to the channel instead.");
    }
  };
  const submit = async () => {
    const text = ta.value.trim();
    if (!text || busy) return;
    busy = true;
    ta.readOnly = true;
    send.textContent = "Sending";
    send.setAttribute("aria-busy", "true");
    err.hidden = true;
    try {
      await onSend(current, text);
      ta.value = "";
      grow();
      counter.hidden = true;
    } catch (e) {
      clear(err);
      append(err, h("div", null, (e && (e.error || e.message)) || "Could not send"), e && e.why ? h("div", { class: "dim" }, e.why) : null, e && e.do ? h("div", { class: "dim" }, e.do) : null);
      err.hidden = false;
    } finally {
      busy = false;
      ta.readOnly = false;
      send.textContent = "Send";
      send.removeAttribute("aria-busy");
    }
  };
  let composing = false;
  ta.addEventListener("compositionstart", () => { composing = true; });
  ta.addEventListener("compositionend", () => { composing = false; });
  ta.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || composing || e.isComposing) return;
    if (e.metaKey || e.ctrlKey || !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  ta.addEventListener("input", () => {
    grow();
    counter.hidden = ta.value.length < COUNTER_AT;
    counter.textContent = ta.value.length.toLocaleString() + " of " + PROMPT_MAX.toLocaleString();
  });
  paint();
  const root = h("div", { class: ["cc-composer", simple ? "cc-composer-simple" : ""], "data-mode": current }, simple ? null : seg, simple ? null : note, h("div", { class: "composer-row" }, lead || null, ta, send), h("div", { class: "row composer-foot" }, counter, err));
  root.focusPost = () => { current = "post"; paint(); ta.focus(); };
  root.focus = () => ta.focus();
  return root;
}

// ---- 9.4 pane tile --------------------------------------------------------------------------------------------

// PaneTile({ agent, preview (string[] or string, only if the peek endpoint exists), onOpen, onTerminal, onPrompt })
// Static 280x168 summary. Never a live xterm; the real terminal lives in the inspector's Terminal tab.
export function PaneTile({ agent, preview, onOpen, onTerminal, onPrompt } = {}) {
  const lines = Array.isArray(preview) ? preview : preview ? String(preview).split("\n") : null;
  return h(
    "article",
    { class: "pane-tile", "data-state": agent.state },
    h("header", null, HexGlyph(agent.state, { size: "mini" }), h("button", { class: "pane-title truncate", type: "button", onClick: onOpen }, agent.title || agent.name)),
    lines && lines.length ? h("pre", { class: "pane-out mono" }, lines.slice(-8).join("\n")) : h("div", { class: "pane-out pane-meta" }, h("div", { class: "truncate" }, agent.workspace || ""), h("div", { class: "truncate mono dim" }, agent.cwd || agent.pane_id)),
    h("footer", { class: "row" }, Button({ label: "Open terminal", size: "sm", onClick: onTerminal }), Button({ label: "Prompt", size: "sm", variant: "ghost", onClick: onPrompt }))
  );
}

// ---- legacy terminal / log helpers ------------------------------------------------------------------------------

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]|\u001b[=>NOMP78]|[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f]/g;

export function stripAnsi(text) {
  return String(text === undefined || text === null ? "" : text).replace(ANSI, "");
}

function pinToBottom(el) {
  let pinned = true;
  el.addEventListener("scroll", () => {
    pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  });
  return { isPinned: () => pinned, stick: () => { el.scrollTop = el.scrollHeight; pinned = true; } };
}

export function Terminal({ text, follow, label } = {}) {
  const pre = h("pre", { class: "terminal", tabindex: "0", role: "log", "aria-label": label || "Terminal output", "aria-live": "off" });
  let following = follow !== false;
  const pin = pinToBottom(pre);
  pre.update = (next) => {
    const was = pin.isPinned();
    pre.textContent = stripAnsi(next).replace(/\s+$/, "");
    if (following && was) pin.stick();
  };
  pre.setFollow = (v) => {
    following = Boolean(v);
    if (following) pin.stick();
  };
  pre.update(text || "");
  if (following) pin.stick();
  return pre;
}

export function LogView({ lines, follow, label } = {}) {
  const box = h("div", { class: "logview", tabindex: "0", role: "log", "aria-label": label || "Log", "aria-live": "off" });
  let following = follow !== false;
  const pin = pinToBottom(box);
  const draw = (items) => {
    const was = pin.isPinned();
    clear(box);
    for (const it of items || []) {
      const line = typeof it === "string" ? { text: it } : it;
      box.appendChild(h("div", { class: "log-line" }, h("span", { class: "ts mono" }, line.ts ? String(line.ts) : ""), h("span", { class: "mono" }, stripAnsi(line.text))));
    }
    if (following && was) pin.stick();
  };
  box.update = draw;
  box.setFollow = (v) => {
    following = Boolean(v);
    if (following) pin.stick();
  };
  box.isPinned = pin.isPinned;
  box.stick = pin.stick;
  draw(lines || []);
  if (following) pin.stick();
  return box;
}

// FilterBar({ search, facets, onChange, actions })
export function FilterBar({ search, facets, onChange, actions } = {}) {
  const bar = h("div", { class: "filterbar", role: "search" });
  if (search) bar.appendChild(h("input", { class: "input search", type: "search", value: search.value || "", placeholder: search.placeholder || "Search", "aria-label": search.label || search.placeholder || "Search", onInput: (e) => search.onInput && search.onInput(e.target.value) }));
  for (const facet of facets || []) {
    bar.appendChild(
      h("label", { class: "row" }, h("span", { class: "dim" }, facet.label), h("select", { class: "select", "aria-label": facet.label, onChange: (e) => onChange && onChange(facet.key, e.target.value) }, (facet.options || []).map((o) => {
        const opt = h("option", { value: o.value }, o.label + (o.count !== undefined ? " (" + o.count + ")" : ""));
        if (String(o.value) === String(facet.value)) opt.selected = true;
        return opt;
      })))
    );
  }
  if (actions && actions.length) bar.appendChild(h("span", { class: "row", style: { marginLeft: "auto" } }, actions));
  return bar;
}
