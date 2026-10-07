// DOM helpers. Data only ever reaches the page through textContent / setAttribute,
// never innerHTML, so API payloads cannot inject markup.

const SVG_NS = "http://www.w3.org/2000/svg";

function appendChild(parent, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const c of child) appendChild(parent, c);
    return;
  }
  parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

function applyProps(node, props, isSvg) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "html" || key === "innerHTML" || key === "outerHTML") {
      throw new Error("dom.h: '" + key + "' is forbidden; pass children instead");
    }
    if (key === "class" || key === "className") {
      node.setAttribute("class", Array.isArray(value) ? value.filter(Boolean).join(" ") : String(value));
    } else if (key === "style" && typeof value === "object") {
      for (const [prop, val] of Object.entries(value)) {
        if (prop.startsWith("--")) node.style.setProperty(prop, String(val));
        else node.style[prop] = val;
      }
    } else if (key === "dataset" && typeof value === "object") {
      for (const [prop, val] of Object.entries(value)) {
        if (val !== null && val !== undefined) node.dataset[prop] = String(val);
      }
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "value" && !isSvg) {
      node.value = value;
    } else if ((key === "checked" || key === "disabled" || key === "selected" || key === "hidden" || key === "open") && !isSvg) {
      node[key] = Boolean(value);
      if (value) node.setAttribute(key, "");
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props, false);
  for (const c of children) appendChild(node, c);
  return node;
}

export function s(tag, props, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props, true);
  for (const c of children) appendChild(node, c);
  return node;
}

const ICONS = {
  overview: ["M3 3h7v7H3z", "M14 3h7v4h-7z", "M14 11h7v10h-7z", "M3 14h7v7H3z"],
  activity: ["M22 12h-4l-3 9L9 3l-3 9H2"],
  health: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"],
  work: ["M9 11l3 3 8-8", "M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"],
  irc: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  herd: ["M3 11l3-6h12l3 6", "M3 11v7a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-7", "M3 11h18", "M9 15h.01", "M15 15h.01"],
  improve: ["M23 6l-9.5 9.5-5-5L1 18", "M17 6h6v6"],
  projects: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  settings: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  sun: ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 1v2", "M12 21v2", "M4.2 4.2l1.4 1.4", "M18.4 18.4l1.4 1.4", "M1 12h2", "M21 12h2", "M4.2 19.8l1.4-1.4", "M18.4 5.6l1.4-1.4"],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  density: ["M3 6h18", "M3 12h18", "M3 18h18"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"],
  copy: ["M9 9h11v11H9z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
  close: ["M18 6L6 18", "M6 6l12 12"],
  terminal: ["M4 17l6-6-6-6", "M12 19h8"],
  send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"],
  plus: ["M12 5v14", "M5 12h14"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6"],
  edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"],
  up: ["M18 15l-6-6-6 6"],
  down: ["M6 9l6 6 6-6"],
  grip: ["M9 6h.01", "M9 12h.01", "M9 18h.01", "M15 6h.01", "M15 12h.01", "M15 18h.01"],
  inbox: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"],
  check: ["M20 6L9 17l-5-5"],
  alert: ["M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01"],
  help: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  // Command Center set (Lucide, ISC). Names follow MASTER section 11.
  agents: ["M12 2l9 5v10l-9 5-9-5V7z", "M12 12l9-5M12 12v10M12 12L3 7"],
  message: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  "heart-pulse": ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z", "M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"],
  sparkles: ["M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z", "M20 3v4", "M22 5h-4", "M4 17v2", "M5 18H3"],
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M8 13h8"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  "chevron-right": ["M9 18l6-6-6-6"],
  "chevron-down": ["M6 9l6 6 6-6"],
  "external-link": ["M15 3h6v6", "M10 14L21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  play: ["M6 3l14 9-14 9z"],
  stop: ["M5 5h14v14H5z"],
  filter: ["M22 3H2l8 9.46V19l4 2v-8.54z"],
  refresh: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M3 21v-5h5"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  more: ["M12 12h.01", "M19 12h.01", "M5 12h.01"],
  "panel-left": ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M9 3v18"],
  rows: ["M5 3h14a2 2 0 0 1 2 2v4H3V5a2 2 0 0 1 2-2z", "M3 15h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  // kind monograms (not brand logos)
  "kind-omp": ["M5 7h14", "M9 7v11", "M15 7v8a2 2 0 0 0 2 2"],
  "kind-claude": ["M12 3v18", "M3 12h18", "M5.6 5.6l12.8 12.8", "M18.4 5.6L5.6 18.4"],
  "kind-codex": ["M8 7l-5 5 5 5", "M16 7l5 5-5 5"],
  "kind-shell": ["M4 17l6-6-6-6", "M12 19h8"],
  "kind-unknown": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 12h.01"],
};

export function icon(name, attrs) {
  const paths = ICONS[name] || ICONS.help;
  return s(
    "svg",
    Object.assign(
      { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "icon", focusable: "false" },
      attrs || {}
    ),
    paths.map((d) => s("path", { d }))
  );
}

export function iconNames() {
  return Object.keys(ICONS);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// Nullish and boolean children are dropped and strings become text nodes. Native
// Element.replaceChildren(null) renders the literal text "null"; never call it directly.
export function append(parent, ...children) {
  for (const c of children) appendChild(parent, c);
  return parent;
}

// Swap a region's content. The only way pages should do what replaceChildren does.
export function replace(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true));
  return node;
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    clearTimeout(t);
    t = null;
  };
  return wrapped;
}

export async function copyText(text) {
  const value = String(text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_err) {
    // fall through to the legacy path
  }
  const ta = h("textarea", { "aria-hidden": "true", tabindex: "-1", style: { position: "fixed", opacity: "0", pointerEvents: "none" } });
  ta.value = value;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (_err) {
    ok = false;
  }
  ta.remove();
  return ok;
}

const UNITS = [
  ["d", 86400],
  ["h", 3600],
  ["m", 60],
  ["s", 1],
];

export function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "n/a";
  let n = Math.max(0, Math.floor(Number(seconds)));
  if (n < 1) return "0s";
  const out = [];
  for (const [label, size] of UNITS) {
    if (n >= size) {
      out.push(Math.floor(n / size) + label);
      n %= size;
    }
    if (out.length === 2) break;
  }
  // Past ten minutes, trailing seconds are noise ("15m 1s" reads as "15m").
  if (out.length === 2 && out[1].endsWith("s") && seconds >= 600) out.pop();
  return out.join(" ");
}

export function fmtRelative(iso) {
  if (!iso) return "never";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  const diff = Math.round((Date.now() - t) / 1000);
  if (diff < 0) return "in " + fmtDuration(-diff);
  if (diff < 5) return "just now";
  return fmtDuration(diff) + " ago";
}

export function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function fmtNumber(n) {
  if (n === null || n === undefined || n === "") return "n/a";
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return v.toLocaleString();
}

const STATUS_ALIASES = {
  success: "ok", passed: "ok", healthy: "ok", active: "running", completed: "done", complete: "done",
  error: "fail", failure: "fail", critical: "fail", denied: "fail",
  warning: "warn", degraded: "warn", partial: "warn",
  pending: "open", todo: "open", queued: "open", inprogress: "in_progress", "in-progress": "in_progress",
};

export function normStatus(status) {
  const key = String(status === null || status === undefined ? "unknown" : status).toLowerCase().replace(/\s+/g, "_");
  return STATUS_ALIASES[key] || key;
}

export function statusLabel(status) {
  return normStatus(status).replace(/_/g, " ");
}
