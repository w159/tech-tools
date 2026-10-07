// Command Center components, part 1: controls, status, KPI, table, tabs, states (MASTER 9.1, 9.7-9.9, 9.13, 9.14, 9.16).
// Import from components.js, not from here.

import { h, s, icon, clear, append, copyText, normStatus } from "./dom.js";
import { HexGlyph, describeStatus } from "./glyphs.js";

// ---- 9.16 buttons, inputs, chips, keycaps ---------------------------------------------

// Button({ label, icon, variant: primary|secondary|ghost|danger, onClick, disabled, busy, busyLabel, title, type, size })
// States: idle, hover/pressed (CSS), disabled (aria-disabled, 45%), busy (aria-busy, label swaps to busyLabel).
export function Button({ label, icon: iconName, variant, onClick, disabled, busy, busyLabel, title, type, size, ariaLabel, id, keys } = {}) {
  const v = variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : variant === "danger" ? "btn-danger" : "";
  const off = Boolean(disabled || busy);
  const btn = h(
    "button",
    {
      class: ["btn", v, size === "sm" ? "btn-sm" : ""],
      type: type || "button",
      id,
      title,
      "aria-label": ariaLabel,
      "aria-busy": busy ? "true" : null,
      "aria-disabled": off ? "true" : null,
      disabled: off,
      onClick: (e) => {
        if (!off && onClick) onClick(e);
      },
    },
    iconName ? icon(iconName) : null,
    busy && busyLabel ? busyLabel : label,
    keys ? Keycap(keys) : null
  );
  return btn;
}

// IconButton({ icon, label, onClick, pressed, variant, badge }): 32x32 (44 on touch), always aria-labelled.
export function IconButton({ icon: iconName, label, onClick, pressed, variant, id, badge, disabled } = {}) {
  return h(
    "button",
    { class: ["btn", "btn-icon", variant === "ghost" || variant === undefined ? "btn-ghost" : "", variant === "secondary" ? "" : ""], type: "button", id, "aria-label": label, title: label, "aria-pressed": pressed === undefined ? null : pressed ? "true" : "false", disabled: Boolean(disabled), onClick },
    icon(iconName),
    badge ? h("span", { class: "btn-badge" }, String(badge)) : null
  );
}

// Chip({ label, selected, onClick, count }): filter chip; selected = accent edge + accent text.
export function Chip({ label, selected, onClick, count, title } = {}) {
  return h("button", { class: "chip", type: "button", "aria-pressed": selected ? "true" : "false", title, onClick }, label, count !== undefined && count !== null ? h("span", { class: "chip-count" }, String(count)) : null);
}

export function Keycap(text) {
  return h("kbd", { class: "keycap" }, String(text));
}

let fieldSeq = 0;
// Input({ label, value, type, placeholder, error, hint, onInput, onChange, id, required }) -> .field (control at .querySelector("input")).
// Error state: --st-fail border + message under, aria-invalid + aria-describedby.
export function Input({ label, value, type, placeholder, error, hint, onInput, onChange, id, required, multiline } = {}) {
  const uid = id || "fld-" + ++fieldSeq;
  const msg = error ? h("div", { class: "field-msg", id: uid + "-msg", role: "alert" }, error) : hint ? h("div", { class: "field-hint", id: uid + "-msg" }, hint) : null;
  const props = { class: [multiline ? "textarea" : "input", error ? "is-error" : ""], id: uid, type: multiline ? null : type || "text", placeholder, required: required ? true : null, "aria-invalid": error ? "true" : null, "aria-describedby": msg ? uid + "-msg" : null, onInput: onInput ? (e) => onInput(e.target.value, e) : null, onChange: onChange ? (e) => onChange(e.target.value, e) : null };
  const control = h(multiline ? "textarea" : "input", props);
  if (value !== undefined && value !== null) control.value = value;
  return h("div", { class: "field" }, label ? h("label", { for: uid }, label) : null, control, msg);
}

// Select({ label, options: [{value,label}], value, onChange }) -> .field
export function Select({ label, options, value, onChange, id, error } = {}) {
  const uid = id || "fld-" + ++fieldSeq;
  const sel = h(
    "select",
    { class: ["select", error ? "is-error" : ""], id: uid, "aria-invalid": error ? "true" : null, onChange: onChange ? (e) => onChange(e.target.value, e) : null },
    (options || []).map((o) => h("option", { value: o.value }, o.label))
  );
  if (value !== undefined && value !== null) sel.value = value;
  return h("div", { class: "field" }, label ? h("label", { for: uid }, label) : null, sel, error ? h("div", { class: "field-msg", role: "alert" }, error) : null);
}

// ---- 9.1 status dot / badge --------------------------------------------------------------

// StatusDot({ status, label }) -> mini hex with an accessible name. Bare glyph: only in rail/strip/narrow table columns.
export function StatusDot({ status, label } = {}) {
  const d = describeStatus(status);
  const word = label || d.word;
  return h("span", { class: "dot", "data-status": d.raw, "data-state": d.state, "data-tone": d.tone, role: "img", "aria-label": word, title: word }, HexGlyph(d.state, { size: "mini" }));
}

// Badge({ status, text }): tint background + state color text + glyph + the word, always.
export function Badge({ status, text } = {}) {
  const d = describeStatus(status);
  return h("span", { class: "badge", "data-status": d.raw, "data-state": d.state, "data-tone": d.tone }, HexGlyph(d.state, { size: [10, 12] }), text === undefined || text === null ? d.word : String(text));
}

export { describeStatus, HexGlyph };

// ---- card -------------------------------------------------------------------------------

export function Card({ title, actions, children, flush, id, class: cls } = {}) {
  const head =
    title || (actions && actions.length)
      ? h("div", { class: "card-head" }, title ? h("h2", null, title) : h("span"), h("div", { class: "card-actions" }, actions || []))
      : null;
  return h("section", { class: ["card", cls], id }, head, h("div", { class: ["card-body", flush ? "flush" : ""] }, children || []));
}

// ---- 9.7 KPI tile -------------------------------------------------------------------------

// Sparkline({ values, status }): SVG polyline 1.5px, last point dot. Text alternative in aria-label.
export function Sparkline({ values, status } = {}) {
  const vals = (values || []).map(Number).filter((v) => Number.isFinite(v));
  const svg = s("svg", { class: "spark", viewBox: "0 0 96 24", preserveAspectRatio: "none", role: "img", "aria-label": vals.length ? "Trend: " + vals.join(", ") : "No trend data" });
  if (vals.length < 2) return svg;
  const lo = Math.min(0, ...vals);
  const hi = Math.max(...vals);
  const span = hi === lo ? 1 : hi - lo;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 94 + 1, 22 - ((v - lo) / span) * 20]);
  const tone = status ? describeStatus(status).tone : "";
  const color = tone ? "var(--st-" + tone + ")" : "var(--accent)";
  svg.appendChild(s("polyline", { points: pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "), fill: "none", stroke: color, "stroke-width": "1.5", "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
  const last = pts[pts.length - 1];
  svg.appendChild(s("circle", { cx: last[0].toFixed(1), cy: last[1].toFixed(1), r: "2", fill: color }));
  return svg;
}

// API deltas are percent change vs the previous window. Direction is a glyph + sign; color follows good/bad, not sign.
function deltaChip(delta, good) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return h("span", { class: "kpi-delta" }, String(delta));
  const flat = delta === 0;
  const up = delta > 0;
  const tone = flat ? "" : (good === "down" ? !up : up) ? "ok" : "fail";
  const mag = Math.abs(Math.round(delta * 10) / 10);
  return h("span", { class: "kpi-delta", "data-tone": tone || null }, flat ? "0% vs prior" : (up ? "\u25B2 +" : "\u25BC ") + mag + "% vs prior");
}

// Kpi({ label, value, delta, goodDirection: up|down, status, hint, series, onClick|href, state: loading|stale|error, asOf, reason })
export function Kpi({ label, value, delta, goodDirection, status, hint, series, onClick, href, state, asOf, reason } = {}) {
  const st = status ? describeStatus(status) : null;
  const err = state === "error";
  const valueText = err ? "Not measured" : value === undefined || value === null ? "Not measured" : String(value);
  const body = [
    h("span", { class: "kpi-label" }, st ? StatusDot({ status: st.raw }) : null, label),
    state === "loading" ? h("span", { class: "skel", style: { height: "32px", width: "60%" }, "aria-hidden": "true" }) : h("span", { class: ["kpi-value", "num", err || value === undefined || value === null ? "is-missing" : ""] }, valueText),
    h(
      "span",
      { class: "kpi-foot" },
      !err && delta !== undefined && delta !== null && delta !== "" ? deltaChip(delta, goodDirection) : null,
      series && series.length > 1 && !err ? Sparkline({ values: series, status: st ? st.raw : null }) : null
    ),
    state === "stale" && asOf ? h("span", { class: "kpi-hint" }, "As of " + asOf) : err && reason ? h("span", { class: "kpi-hint", title: reason }, reason) : hint ? h("span", { class: "kpi-hint", title: String(hint) }, String(hint)) : null,
    st ? h("span", { class: "sr-only" }, "status " + st.word) : null,
  ];
  const attrs = { class: ["kpi", state ? "is-" + state : ""], "aria-busy": state === "loading" ? "true" : null };
  if (href) return h("a", { ...attrs, href }, body);
  return onClick ? h("button", { ...attrs, type: "button", onClick }, body) : h("div", attrs, body);
}

// ---- 9.8 table ----------------------------------------------------------------------------

// Table({ columns: [{key,label,render,sortable,align,width,primary}], rows, onRow, empty, dense, caption, rowKey, selectedKey,
//         selectable, bulkActions(rows) -> Node[], filter })
// Keyboard: Up/Down move row focus, Enter opens (onRow), Space toggles selection. Below 768px rows stack (CSS, data-label).
export function Table({ columns, rows, onRow, empty, dense, caption, rowKey, selectedKey, selectable, bulkActions } = {}) {
  const cols = columns || [];
  let data = (rows || []).slice();
  let sortKey = null;
  let sortDir = 1;
  const chosen = new Set();
  const wrap = h("div", { class: "table-wrap" });
  const keyOf = (row, i) => (rowKey ? row[rowKey] : i);

  const cell = (col, row) => {
    const v = col.render ? col.render(row) : row[col.key];
    return v === null || v === undefined ? "" : v;
  };

  const focusRow = (tr, dir) => {
    const list = Array.from(wrap.querySelectorAll("tbody tr"));
    const next = list[list.indexOf(tr) + dir];
    if (next) next.focus();
  };

  const draw = () => {
    clear(wrap);
    if (!data.length) {
      wrap.appendChild(empty instanceof Node ? empty : h("p", { class: "dim", style: { padding: "var(--s-4)" } }, empty || "Nothing here yet."));
      return;
    }
    const heads = cols.map((col) => {
      const th = h("th", { scope: "col", style: col.width ? { width: col.width } : null, "data-align": col.align || null });
      if (col.sortable) {
        const active = sortKey === col.key;
        th.setAttribute("aria-sort", active ? (sortDir === 1 ? "ascending" : "descending") : "none");
        th.appendChild(
          h(
            "button",
            {
              type: "button",
              onClick: () => {
                sortDir = sortKey === col.key ? -sortDir : 1;
                sortKey = col.key;
                data.sort((a, b) => {
                  const x = a[col.key];
                  const y = b[col.key];
                  if (x === y) return 0;
                  if (x === null || x === undefined) return 1;
                  if (y === null || y === undefined) return -1;
                  return (x > y ? 1 : -1) * sortDir;
                });
                draw();
              },
            },
            col.label,
            active ? icon(sortDir === 1 ? "up" : "down") : null
          )
        );
      } else th.appendChild(document.createTextNode(col.label));
      return th;
    });
    if (selectable) heads.unshift(h("th", { scope: "col", class: "col-check" }, h("span", { class: "sr-only" }, "Select")));
    const bulk = selectable && chosen.size && bulkActions ? h("div", { class: "bulk-bar", role: "toolbar", "aria-label": "Bulk actions" }, h("span", null, chosen.size + " selected"), bulkActions(data.filter((r, i) => chosen.has(keyOf(r, i))))) : null;
    const body = data.map((row, i) => {
      const k = keyOf(row, i);
      const tds = cols.map((col) => h("td", { "data-label": col.label, "data-align": col.align || null, "data-primary": col.primary ? "true" : null }, cell(col, row)));
      if (selectable) tds.unshift(h("td", { class: "col-check" }, h("input", { type: "checkbox", checked: chosen.has(k), "aria-label": "Select row", onClick: (e) => e.stopPropagation(), onChange: (e) => { if (e.target.checked) chosen.add(k); else chosen.delete(k); draw(); } })));
      const tr = h("tr", { "data-clickable": onRow ? "true" : null, "data-selected": selectedKey !== undefined && selectedKey !== null && k === selectedKey ? "true" : null, tabindex: onRow || selectable ? "0" : null }, tds);
      tr.addEventListener("keydown", (e) => {
        if (e.target !== tr) return;
        if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); focusRow(tr, 1); }
        else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); focusRow(tr, -1); }
        else if (e.key === "Enter" && onRow) { e.preventDefault(); onRow(row, { terminal: e.shiftKey }); }
        else if (e.key === " " && selectable) { e.preventDefault(); if (chosen.has(k)) chosen.delete(k); else chosen.add(k); draw(); }
      });
      if (onRow) tr.addEventListener("click", () => onRow(row, {}));
      return tr;
    });
    wrap.appendChild(
      h("div", { class: "table-scroll" }, bulk, h("table", { class: ["table", dense ? "dense" : ""] }, h("caption", { class: "sr-only" }, caption || "Table"), h("thead", null, h("tr", null, heads)), h("tbody", null, body)))
    );
  };
  draw();
  wrap.selected = () => data.filter((r, i) => chosen.has(keyOf(r, i)));
  return wrap;
}

// ---- 9.9 tabs ------------------------------------------------------------------------------

export function tabPanelProps(id) {
  return { role: "tabpanel", id: "panel-" + id, "aria-labelledby": "tab-" + id, tabindex: "0" };
}

// Tabs({ tabs: [{id,label,count}], active, onChange, label }) -> tablist. Arrows/Home/End; underline slides over --dur.
// Instance methods: .select(id) updates selection without firing onChange.
export function Tabs({ tabs, active, onChange, label } = {}) {
  const items = tabs || [];
  const list = h("div", { class: "tabs", role: "tablist", "aria-label": label || null });
  let current = active === undefined ? items[0] && items[0].id : active;
  const buttons = new Map();
  const place = () => {
    const sel = buttons.get(current);
    if (!sel || !sel.offsetWidth) return;
    list.style.setProperty("--tab-x", sel.offsetLeft + "px");
    list.style.setProperty("--tab-w", sel.offsetWidth + "px");
  };
  const mark = () => {
    for (const [id, btn] of buttons) {
      const on = id === current;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    }
    place();
  };
  const choose = (id, focus) => {
    current = id;
    mark();
    if (focus) buttons.get(id).focus();
    if (onChange) onChange(id);
  };
  items.forEach((t, i) => {
    const btn = h(
      "button",
      {
        class: "tab",
        type: "button",
        role: "tab",
        id: "tab-" + t.id,
        "aria-controls": "panel-" + t.id,
        onClick: () => choose(t.id, false),
        onKeydown: (e) => {
          const last = items.length - 1;
          const to = e.key === "ArrowRight" ? (i + 1) % items.length : e.key === "ArrowLeft" ? (i + last) % items.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
          if (to < 0) return;
          e.preventDefault();
          choose(items[to].id, true);
        },
      },
      t.label,
      t.count !== undefined && t.count !== null ? h("span", { class: "count" }, String(t.count)) : null
    );
    buttons.set(t.id, btn);
    list.appendChild(btn);
  });
  mark();
  requestAnimationFrame(place);
  list.select = (id) => {
    current = id;
    mark();
  };
  return list;
}

// ---- 9.13 empty / loading / error / stale ---------------------------------------------------

function humanise(code) {
  const t = String(code || "").replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Something went wrong";
}

export function CommandBlock(command) {
  const text = String(command);
  const btn = h(
    "button",
    {
      class: "btn",
      type: "button",
      "aria-label": "Copy command",
      onClick: async (e) => {
        const ok = await copyText(text);
        e.currentTarget.lastChild.textContent = ok ? "Copied" : "Copy failed";
      },
    },
    icon("copy"),
    h("span", null, "Copy")
  );
  return h("div", { class: "cmd" }, h("pre", { tabindex: "0" }, h("code", null, text)), btn);
}

function skeleton(shape) {
  const block = (w, hgt) => h("span", { class: "skel", style: { width: w, height: hgt }, "aria-hidden": "true" });
  if (shape === "cards") return h("div", { class: "skel-cards", "aria-hidden": "true" }, [1, 2, 3].map(() => block("100%", "120px")));
  if (shape === "kpi") return h("div", { class: "skel-cards", "aria-hidden": "true" }, [1, 2, 3, 4].map(() => block("100%", "96px")));
  return h("div", { class: "skel-rows", "aria-hidden": "true" }, [1, 2, 3, 4, 5].map(() => block("100%", "28px")));
}

// State({ variant: empty|loading|error|stale, title, body, action: Node, secondary: Node, commands, shape, label,
//         error (ApiError or {error,why,do}), onRetry, onTimeout, asOf, inline })
// empty   : what is absent, why/how it fills, one action.
// loading : structural skeleton, aria-busy; after 600ms "Loading <label>"; after 8s becomes the error variant with Retry.
// error   : title = humanised `error`, `why`, `do`, Retry + Copy details, raw code only inside "Technical details".
// stale   : banner row "Showing data from <asOf>. Reconnecting."
export function State(opts) {
  const o = opts || {};
  const root = h("div", { class: ["state", "state-" + (o.variant || "empty"), o.inline ? "is-inline" : ""] });
  const draw = (variant) => {
    clear(root);
    root.className = "state state-" + variant + (o.inline ? " is-inline" : "");
    root.removeAttribute("aria-busy");
    if (variant === "loading") {
      root.setAttribute("aria-busy", "true");
      const title = h("p", { class: "state-loading-label", role: "status" });
      append(root, title, skeleton(o.shape));
      const t1 = setTimeout(() => {
        if (root.isConnected || true) title.textContent = "Loading " + (o.label || "");
      }, 600);
      const t2 = setTimeout(() => {
        if (!root.isConnected) return;
        if (o.onTimeout) o.onTimeout();
        draw("error");
      }, 8000);
      root._timers = [t1, t2];
      return;
    }
    for (const t of root._timers || []) clearTimeout(t);
    if (variant === "stale") {
      append(root, h("p", { role: "status" }, "Showing data from " + (o.asOf || "earlier") + ". Reconnecting."), o.secondary || null);
      return;
    }
    if (variant === "error") {
      const e = o.error || {};
      const raw = e.error || e.message || "";
      const detail = [raw && "error: " + raw, e.status !== undefined && e.status !== null && "status: " + e.status, e.why && "why: " + e.why, e.do && "do: " + e.do].filter(Boolean).join("\n");
      append(
        root,
        h("h2", { class: "state-title" }, o.title || humanise(raw) || "Something went wrong"),
        e.why ? h("p", { class: "state-body" }, e.why) : o.body ? h("p", { class: "state-body" }, o.body) : null,
        e.do ? h("p", { class: "state-body" }, e.do) : null,
        h(
          "div",
          { class: "row state-actions" },
          o.onRetry ? Button({ label: "Retry", variant: "primary", onClick: o.onRetry }) : null,
          detail ? Button({ label: "Copy details", variant: "ghost", onClick: () => copyText(detail) }) : null,
          o.secondary || null
        ),
        detail ? h("details", { class: "tech" }, h("summary", null, "Technical details"), h("pre", { class: "mono" }, detail)) : null
      );
      root.setAttribute("role", "alert");
      return;
    }
    const cmds = Array.isArray(o.commands) ? o.commands : o.commands ? [o.commands] : [];
    append(
      root,
      h("h2", { class: "state-title" }, o.title || "Nothing here yet"),
      o.body ? h("p", { class: "state-body" }, o.body) : null,
      cmds.map((c) => CommandBlock(c)),
      o.action || o.secondary ? h("div", { class: "row state-actions" }, o.action || null, o.secondary || null) : null
    );
  };
  draw(o.variant || "empty");
  root.redraw = draw;
  return root;
}

// Legacy shape kept for existing pages: { icon, title, body, command, actions }.
export function EmptyState({ title, body, command, actions } = {}) {
  return State({ variant: "empty", title, body, commands: command, action: actions && actions.length ? h("span", { class: "row" }, actions) : null });
}

// ---- 9.14 honest degraded states -----------------------------------------------------------

export const DAEMON_START = 'python3 "$CLAUDE_PLUGIN_ROOT/scripts/atlas_dashboard.py" ensure';

// DegradedState({ layer: "daemon"|"herdr"|"webui", reason, onRecheck, onStart, busy, inline })
//   daemon : full-page replacement, only when requests fail with a network error.
//   herdr  : replaces the agent canvas / rail tree only. Atlas never starts herdr.
//   webui  : inline in the Terminal tab / "Open terminal" only. The agent list is NOT affected.
// Raw reason ids appear only inside "Technical details". Returns null for a null layer.
export function DegradedState({ layer, reason, onRecheck, onStart, busy, inline } = {}) {
  if (!layer) return null;
  const recheck = Button({ label: layer === "daemon" ? "Retry" : "Recheck", variant: layer === "webui" ? "secondary" : "primary", onClick: onRecheck });
  const tech = reason ? h("details", { class: "tech" }, h("summary", null, "Technical details"), h("pre", { class: "mono" }, String(reason))) : null;
  if (layer === "daemon") {
    return h("div", { class: "state state-degraded", "data-layer": "daemon", role: "alert" }, h("h2", { class: "state-title" }, "Atlas isn't responding"), h("p", { class: "state-body" }, "The dashboard process stopped or restarted."), CommandBlock(DAEMON_START), h("div", { class: "row state-actions" }, recheck), tech);
  }
  if (layer === "herdr") {
    return h("div", { class: ["state", "state-degraded", inline ? "is-inline" : ""], "data-layer": "herdr", role: "status" }, h("h2", { class: "state-title" }, "herdr isn't running"), h("p", { class: "state-body" }, "Atlas can't list agents without it. Atlas never starts herdr itself."), CommandBlock("herdr"), h("div", { class: "row state-actions" }, recheck), tech);
  }
  return h(
    "div",
    { class: ["state", "state-degraded", "is-inline"], "data-layer": "webui", role: "status" },
    h("p", { class: "state-body" }, "The terminal service isn't running. The agent list is live; terminals need it."),
    h("div", { class: "row state-actions" }, Button({ label: "Start terminal service", variant: "primary", busy, busyLabel: "Starting", onClick: onStart }), recheck),
    tech
  );
}
