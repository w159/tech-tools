// Atlas Workboard component library. Plain DOM; every string reaches the page via
// textContent, so API data can never inject markup. Status is always glyph + word.

import { h, s, icon, clear, copyText, normStatus, statusLabel } from "./dom.js";

const GLYPHS = {
  ok: ["M20 6L9 17l-5-5"],
  done: ["M20 6L9 17l-5-5"],
  running: ["M20 6L9 17l-5-5"],
  fail: ["M18 6L6 18", "M6 6l12 12"],
  failed: ["M18 6L6 18", "M6 6l12 12"],
  warn: ["M12 4l9 16H3z", "M12 10v4"],
  blocked: ["M12 4l9 16H3z", "M12 10v4"],
  partial: ["M12 4l9 16H3z", "M12 10v4"],
  needs_input: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 8v5", "M12 16h.01"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 11v5", "M12 8h.01"],
  working: ["M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"],
  in_progress: ["M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"],
  idle: ["M5 12h14"],
  open: ["M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"],
  exited: ["M6 6h12v12H6z"],
  stopped: ["M6 6h12v12H6z"],
  unknown: ["M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
};

function glyph(status) {
  const paths = GLYPHS[status] || GLYPHS.unknown;
  return s(
    "svg",
    { viewBox: "0 0 24 24", fill: status === "working" || status === "in_progress" ? "currentColor" : "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" },
    paths.map((d) => s("path", { d }))
  );
}

export function StatusDot({ status } = {}) {
  const st = normStatus(status);
  return h("span", { class: "dot", "data-status": st, title: statusLabel(st) }, glyph(st));
}

export function Badge({ status, text } = {}) {
  const st = normStatus(status);
  return h("span", { class: "badge", "data-status": st }, StatusDot({ status: st }), text === undefined || text === null ? statusLabel(st) : String(text));
}

export function Card({ title, actions, children, flush, id, class: cls } = {}) {
  const head =
    title || (actions && actions.length)
      ? h("div", { class: "card-head" }, title ? h("h2", null, title) : h("span"), h("div", { class: "card-actions" }, actions || []))
      : null;
  return h("section", { class: ["card", cls], id }, head, h("div", { class: ["card-body", flush ? "flush" : ""] }, children || []));
}

// API deltas are percent change vs the previous window. Show direction as a glyph plus a sign.
function deltaText(delta) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return String(delta);
  if (delta === 0) return "0% vs prior";
  return (delta > 0 ? "\u25B2 +" : "\u25BC ") + Math.abs(Math.round(delta * 10) / 10) + "% vs prior";
}

export function Kpi({ label, value, delta, status, hint, onClick } = {}) {
  const st = status ? normStatus(status) : null;
  const body = [
    h("span", { class: "kpi-label" }, st ? StatusDot({ status: st }) : null, label),
    h("span", { class: "kpi-value" }, value === undefined || value === null ? "n/a" : String(value)),
    h(
      "span",
      { class: "kpi-foot" },
      delta !== undefined && delta !== null && delta !== "" ? h("span", { class: "kpi-delta" }, deltaText(delta)) : null,
      hint ? h("span", null, String(hint)) : null,
      st ? h("span", { class: "sr-only" }, "status " + statusLabel(st)) : null
    ),
  ];
  return onClick ? h("button", { class: "kpi", type: "button", onClick }, body) : h("div", { class: "kpi" }, body);
}

export function Table({ columns, rows, onRow, empty, dense, caption } = {}) {
  const cols = columns || [];
  let data = (rows || []).slice();
  let sortKey = null;
  let sortDir = 1;
  const wrap = h("div", { class: "table-wrap" });

  const cell = (col, row) => {
    const v = col.render ? col.render(row) : row[col.key];
    return v === null || v === undefined ? "" : v;
  };

  const draw = () => {
    clear(wrap);
    if (!data.length) {
      wrap.appendChild(empty instanceof Node ? empty : h("p", { class: "dim", style: { padding: "var(--s-4)" } }, empty || "Nothing here yet."));
      return;
    }
    const head = h(
      "tr",
      null,
      cols.map((col) => {
        const th = h("th", { scope: "col", style: col.width ? { width: col.width } : null });
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
        } else {
          th.appendChild(document.createTextNode(col.label));
        }
        return th;
      })
    );
    const body = data.map((row) => {
      const tr = h("tr", { "data-clickable": onRow ? "true" : null }, cols.map((col) => h("td", null, cell(col, row))));
      if (onRow) {
        tr.tabIndex = 0;
        tr.addEventListener("click", () => onRow(row));
        tr.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onRow(row);
          }
        });
      }
      return tr;
    });
    wrap.appendChild(
      h("table", { class: ["table", dense ? "dense" : ""] }, caption ? h("caption", { class: "sr-only" }, caption) : null, h("thead", null, head), h("tbody", null, body))
    );
  };
  draw();
  return wrap;
}

export function Tabs({ tabs, active, onChange } = {}) {
  const list = h("div", { class: "tabs", role: "tablist" });
  const items = tabs || [];
  const draw = (current) => {
    clear(list);
    items.forEach((t, i) => {
      const selected = t.id === current;
      const btn = h(
        "button",
        {
          class: "tab",
          type: "button",
          role: "tab",
          id: "tab-" + t.id,
          "aria-selected": selected ? "true" : "false",
          tabindex: selected ? "0" : "-1",
          onClick: () => {
            draw(t.id);
            if (onChange) onChange(t.id);
          },
          onKeydown: (e) => {
            const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            const next = items[(i + dir + items.length) % items.length];
            draw(next.id);
            if (onChange) onChange(next.id);
            const focus = list.querySelector('[aria-selected="true"]');
            if (focus) focus.focus();
          },
        },
        t.label,
        t.count !== undefined && t.count !== null ? h("span", { class: "count" }, String(t.count)) : null
      );
      list.appendChild(btn);
    });
  };
  draw(active === undefined ? (items[0] && items[0].id) : active);
  return list;
}

// ---- overlays -------------------------------------------------------------

const overlays = { drawer: null, modal: null };

function root(id) {
  return document.getElementById(id) || document.body;
}

function focusables(node) {
  return Array.from(node.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function trapFocus(container) {
  container.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = focusables(container);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

export function Drawer({ title, onClose, children, width } = {}) {
  const closeBtn = h("button", { class: "btn btn-ghost btn-icon", type: "button", "aria-label": "Close panel", onClick: () => closeDrawer() }, icon("close"));
  const node = h(
    "aside",
    { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": title || "Details", style: width ? { "--drawer-w": typeof width === "number" ? width + "px" : width } : null },
    h("div", { class: "drawer-head" }, h("h2", null, title || ""), closeBtn),
    h("div", { class: "drawer-body" }, children || [])
  );
  node._onClose = onClose || null;
  trapFocus(node);
  return node;
}

export function openDrawer(node) {
  closeDrawer();
  const host = root("drawer-root");
  const scrim = h("div", { class: "scrim", onClick: () => closeDrawer() });
  overlays.drawer = { node, scrim, returnTo: document.activeElement };
  host.appendChild(scrim);
  host.appendChild(node);
  const target = node.querySelector(".drawer-head button");
  if (target) target.focus();
  return node;
}

export function closeDrawer() {
  const cur = overlays.drawer;
  if (!cur) return false;
  overlays.drawer = null;
  cur.scrim.remove();
  cur.node.remove();
  if (cur.node._onClose) cur.node._onClose();
  if (cur.returnTo && cur.returnTo.isConnected && typeof cur.returnTo.focus === "function") cur.returnTo.focus();
  return true;
}

export function hasOpenDrawer() {
  return Boolean(overlays.drawer);
}

// Modal({ title, children, actions: Node[] , onClose }) -> Node. Show with openModal(node); close with closeModal().
export function Modal({ title, children, actions, onClose } = {}) {
  const node = h(
    "div",
    { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title || "Dialog" },
    title ? h("div", { class: "modal-head" }, h("h2", null, title)) : null,
    h("div", { class: "modal-body" }, children || []),
    actions && actions.length ? h("div", { class: "modal-actions" }, actions) : null
  );
  node._onClose = onClose || null;
  trapFocus(node);
  return node;
}

export function openModal(node) {
  closeModal();
  const host = root("modal-root");
  const scrim = h("div", { class: "scrim", style: { zIndex: 50 }, onClick: () => closeModal() });
  overlays.modal = { node, scrim, returnTo: document.activeElement };
  host.appendChild(scrim);
  host.appendChild(node);
  const target = node.querySelector("[autofocus], .modal-actions .btn-primary, .modal-actions .btn-danger, .modal-actions button, input, textarea, select, button");
  if (target) target.focus();
  return node;
}

export function closeModal() {
  const cur = overlays.modal;
  if (!cur) return false;
  overlays.modal = null;
  cur.scrim.remove();
  cur.node.remove();
  if (cur.node._onClose) cur.node._onClose();
  if (cur.returnTo && cur.returnTo.isConnected && typeof cur.returnTo.focus === "function") cur.returnTo.focus();
  return true;
}

export function hasOpenModal() {
  return Boolean(overlays.modal);
}

export function confirm({ title, body, danger, confirmLabel, cancelLabel } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };
    const cancel = h("button", { class: "btn", type: "button", onClick: () => done(false) }, cancelLabel || "Cancel");
    const ok = h("button", { class: ["btn", danger ? "btn-danger" : "btn-primary"], type: "button", onClick: () => done(true) }, confirmLabel || (danger ? "Confirm" : "OK"));
    const content = body instanceof Node ? body : h("p", null, body === undefined || body === null ? "" : String(body));
    openModal(Modal({ title, children: [content], actions: [cancel, ok], onClose: () => done(false) }));
    cancel.focus();
  });
}

export function toast(msg, opts) {
  const options = opts || {};
  const kind = normStatus(options.kind || "info");
  const host = root("toast-root");
  const node = h(
    "div",
    { class: "toast", role: kind === "fail" ? "alert" : "status" },
    StatusDot({ status: kind }),
    h("div", { class: "grow" }, h("div", null, String(msg)), options.why ? h("div", { class: "why" }, String(options.why)) : null, options.do ? h("div", { class: "why" }, String(options.do)) : null),
    h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": "Dismiss", onClick: () => node.remove() }, icon("close"))
  );
  host.appendChild(node);
  const ttl = options.ttl === undefined ? (kind === "fail" ? 9000 : 4200) : options.ttl;
  if (ttl > 0) setTimeout(() => node.remove(), ttl);
  return node;
}

// Show an ApiError (or any error) as a toast with what / why / do.
export function toastError(err, fallback) {
  const e = err || {};
  return toast(e.error || e.message || fallback || "Something went wrong", { kind: "fail", why: e.why, do: e.do });
}

export function EmptyState({ icon: iconName, title, body, command, actions } = {}) {
  const cmds = Array.isArray(command) ? command : command ? [command] : [];
  return h(
    "div",
    { class: "empty" },
    icon(iconName || "inbox", { class: "empty-icon" }),
    h("h2", null, title || "Nothing here yet"),
    body ? h("p", null, body) : null,
    cmds.map((c) => CommandBlock(c)),
    actions && actions.length ? h("div", { class: "row" }, actions) : null
  );
}

export function CommandBlock(command) {
  const text = String(command);
  const btn = h(
    "button",
    {
      class: "btn",
      type: "button",
      "aria-label": "Copy command",
      onClick: async () => {
        const ok = await copyText(text);
        toast(ok ? "Copied to clipboard" : "Copy failed; select the command and copy it manually", { kind: ok ? "ok" : "warn", ttl: 2200 });
      },
    },
    icon("copy"),
    "Copy"
  );
  return h("div", { class: "cmd" }, h("pre", { tabindex: "0" }, h("code", null, text)), btn);
}

// ---- charts ---------------------------------------------------------------

const SERIES_COLORS = ["var(--accent)", "var(--info)", "var(--working)", "var(--warn)", "var(--ok)", "var(--fail)"];

function extent(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return [0, 1];
  const lo = Math.min(0, ...nums);
  const hi = Math.max(...nums);
  return [lo, hi === lo ? lo + 1 : hi];
}

export function Sparkline({ values, status } = {}) {
  const vals = (values || []).map(Number).filter((v) => Number.isFinite(v));
  const svg = s("svg", { class: "spark", viewBox: "0 0 96 24", preserveAspectRatio: "none", role: "img", "aria-label": vals.length ? "Trend: " + vals.join(", ") : "No trend data" });
  if (vals.length < 2) return svg;
  const [lo, hi] = extent(vals);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 96, 22 - ((v - lo) / (hi - lo)) * 20]);
  const color = status ? "var(--" + (normStatus(status) === "done" ? "ok" : normStatus(status)) + ", var(--accent))" : "var(--accent)";
  svg.appendChild(s("polyline", { points: pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "), fill: "none", stroke: color, "stroke-width": "1.6", "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
  return svg;
}

function legend(series) {
  return h(
    "div",
    { class: "chart-legend" },
    series.map((ser, i) => h("span", { style: { color: SERIES_COLORS[i % SERIES_COLORS.length] } }, h("i"), h("span", { style: { color: "var(--text-dim)" } }, ser.name || "series " + (i + 1))))
  );
}

// ISO timestamps from the API become compact axis ticks: MM-DD for daily series, HH:MM when
// every point falls on one day. Non-date labels pass through unchanged.
function tickLabel(l, allSameDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(l));
  if (!m) return String(l);
  return allSameDay && m[4] ? m[4] + ":" + m[5] : m[2] + "-" + m[3];
}

function axes(svg, w, h2, pad, lo, hi, labels) {
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.t + ((h2 - pad.t - pad.b) * i) / 3;
    const v = hi - ((hi - lo) * i) / 3;
    svg.appendChild(s("line", { class: "grid", x1: pad.l, x2: w - pad.r, y1: y, y2: y }));
    svg.appendChild(s("text", { x: pad.l - 6, y: y + 3, "text-anchor": "end" }, Number.isInteger(v) ? String(v) : v.toFixed(1)));
  }
  const n = labels.length;
  const days = new Set(labels.map((l) => String(l).slice(0, 10)));
  const sameDay = days.size === 1;
  const step = Math.max(1, Math.ceil(n / 6));
  labels.forEach((l, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    if (i !== n - 1 && n - 1 - i < step / 2) return;
    const x = n === 1 ? pad.l : pad.l + ((w - pad.l - pad.r) * i) / (n - 1);
    svg.appendChild(s("text", { x, y: h2 - 6, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" }, tickLabel(l, sameDay)));
  });
}

export function LineChart({ labels, series, height } = {}) {
  const ser = (series || []).filter((x) => x && Array.isArray(x.values));
  const lab = labels || [];
  const n = Math.max(lab.length, ...ser.map((x) => x.values.length), 0);
  const H = height || 180;
  const W = 640;
  const pad = { l: 34, r: 10, t: 8, b: 22 };
  const wrap = h("figure", { class: "stack" });
  if (!n || !ser.length) {
    wrap.appendChild(h("p", { class: "dim" }, "No data in this window."));
    return wrap;
  }
  const [lo, hi] = extent(ser.flatMap((x) => x.values));
  const svg = s("svg", { class: "chart", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Line chart: " + ser.map((x) => x.name).join(", "), preserveAspectRatio: "xMidYMid meet" });
  axes(svg, W, H, pad, lo, hi, lab.length ? lab : ser[0].values.map((_v, i) => i + 1));
  ser.forEach((x, idx) => {
    const color = SERIES_COLORS[idx % SERIES_COLORS.length];
    const pts = x.values.map((v, i) => [n === 1 ? pad.l : pad.l + ((W - pad.l - pad.r) * i) / (n - 1), pad.t + (H - pad.t - pad.b) * (1 - (Number(v) - lo) / (hi - lo))]);
    svg.appendChild(s("polyline", { points: pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "), fill: "none", stroke: color, "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
    pts.forEach((p, i) => svg.appendChild(s("circle", { cx: p[0], cy: p[1], r: "2.4", fill: color }, s("title", null, (lab[i] || i + 1) + " " + (x.name || "") + ": " + x.values[i]))));
  });
  wrap.appendChild(svg);
  wrap.appendChild(legend(ser));
  return wrap;
}

export function BarChart({ labels, series, height } = {}) {
  const ser = (series || []).filter((x) => x && Array.isArray(x.values));
  const lab = labels || [];
  const n = Math.max(lab.length, ...ser.map((x) => x.values.length), 0);
  const H = height || 180;
  const W = 640;
  const pad = { l: 34, r: 10, t: 8, b: 22 };
  const wrap = h("figure", { class: "stack" });
  if (!n || !ser.length) {
    wrap.appendChild(h("p", { class: "dim" }, "No data in this window."));
    return wrap;
  }
  const [lo, hi] = extent(ser.flatMap((x) => x.values));
  const svg = s("svg", { class: "chart", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Bar chart: " + ser.map((x) => x.name).join(", "), preserveAspectRatio: "xMidYMid meet" });
  axes(svg, W, H, pad, lo, hi, lab.length ? lab : ser[0].values.map((_v, i) => i + 1));
  const slot = (W - pad.l - pad.r) / n;
  const bw = Math.max(2, (slot * 0.72) / ser.length);
  ser.forEach((x, idx) => {
    const color = SERIES_COLORS[idx % SERIES_COLORS.length];
    x.values.forEach((v, i) => {
      const hgt = (H - pad.t - pad.b) * ((Number(v) - lo) / (hi - lo));
      const bx = pad.l + slot * i + slot * 0.14 + bw * idx;
      svg.appendChild(s("rect", { x: bx, y: H - pad.b - hgt, width: bw, height: Math.max(0, hgt), rx: 2, fill: color }, s("title", null, (lab[i] || i + 1) + " " + (x.name || "") + ": " + v)));
    });
  });
  wrap.appendChild(svg);
  if (ser.length > 1) wrap.appendChild(legend(ser));
  return wrap;
}

// ---- timeline / logs ------------------------------------------------------

// Timeline({ items: [{ ts, title, detail?, status?, meta? }] })
export function Timeline({ items, empty } = {}) {
  const list = items || [];
  if (!list.length) return h("p", { class: "dim" }, empty || "No events yet.");
  return h(
    "ol",
    { class: "timeline" },
    list.map((it) =>
      h(
        "li",
        { class: "tl-item" },
        StatusDot({ status: it.status || "info" }),
        h(
          "div",
          null,
          h("div", { class: "tl-head" }, h("span", { class: "tl-title" }, it.title === undefined || it.title === null ? "" : String(it.title)), it.ts ? h("time", { class: "tl-time", datetime: String(it.ts) }, String(it.ts)) : null, it.meta ? h("span", { class: "tag" }, String(it.meta)) : null),
          it.detail ? h("div", { class: "tl-detail" }, String(it.detail)) : null
        )
      )
    )
  );
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]|\u001b[=>NOMP78]|[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f]/g;

export function stripAnsi(text) {
  return String(text === undefined || text === null ? "" : text).replace(ANSI, "");
}

function pinToBottom(el) {
  let pinned = true;
  el.addEventListener("scroll", () => {
    pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  });
  return {
    isPinned: () => pinned,
    stick: () => {
      el.scrollTop = el.scrollHeight;
      pinned = true;
    },
  };
}

// Terminal({ text, follow }) -> node with .update(text) / .setFollow(bool)
export function Terminal({ text, follow, label } = {}) {
  const pre = h("pre", { class: "terminal", tabindex: "0", role: "log", "aria-label": label || "Terminal output", "aria-live": "off" });
  let following = follow !== false;
  const pin = pinToBottom(pre);
  pre.update = (next) => {
    const wasPinned = pin.isPinned();
    // tmux pads the capture with empty screen rows; following the tail would show only those.
    pre.textContent = stripAnsi(next).replace(/\s+$/, "");
    if (following && wasPinned) pin.stick();
  };
  pre.setFollow = (value) => {
    following = Boolean(value);
    if (following) pin.stick();
  };
  pre.update(text || "");
  if (following) pin.stick();
  return pre;
}

// LogView({ lines: [{ ts?, text, status? } | string], follow }) -> node with .update(lines)
export function LogView({ lines, follow, label } = {}) {
  const box = h("div", { class: "logview", tabindex: "0", role: "log", "aria-label": label || "Log", "aria-live": "off" });
  let following = follow !== false;
  const pin = pinToBottom(box);
  const draw = (items) => {
    const wasPinned = pin.isPinned();
    clear(box);
    for (const it of items || []) {
      const line = typeof it === "string" ? { text: it } : it;
      box.appendChild(h("div", { class: "log-line" }, h("span", { class: "ts mono" }, line.ts ? String(line.ts) : ""), h("span", { class: "mono" }, stripAnsi(line.text))));
    }
    if (following && wasPinned) pin.stick();
  };
  box.update = draw;
  box.setFollow = (value) => {
    following = Boolean(value);
    if (following) pin.stick();
  };
  box.isPinned = pin.isPinned;
  box.stick = pin.stick;
  draw(lines || []);
  if (following) pin.stick();
  return box;
}

// FilterBar({ search?: {value, placeholder, onInput}, facets?: [{ key, label, options: [{value,label,count?}] , value }], onChange(key, value), actions? })
export function FilterBar({ search, facets, onChange, actions } = {}) {
  const bar = h("div", { class: "filterbar", role: "search" });
  if (search) {
    bar.appendChild(
      h("input", {
        class: "input search",
        type: "search",
        value: search.value || "",
        placeholder: search.placeholder || "Search",
        "aria-label": search.label || search.placeholder || "Search",
        onInput: (e) => search.onInput && search.onInput(e.target.value),
      })
    );
  }
  for (const facet of facets || []) {
    bar.appendChild(
      h(
        "label",
        { class: "row" },
        h("span", { class: "dim" }, facet.label),
        h(
          "select",
          { class: "select", "aria-label": facet.label, onChange: (e) => onChange && onChange(facet.key, e.target.value) },
          (facet.options || []).map((o) => {
            const opt = h("option", { value: o.value }, o.label + (o.count !== undefined ? " (" + o.count + ")" : ""));
            if (String(o.value) === String(facet.value)) opt.selected = true;
            return opt;
          })
        )
      )
    );
  }
  if (actions && actions.length) bar.appendChild(h("span", { class: "row", style: { marginLeft: "auto" } }, actions));
  return bar;
}
