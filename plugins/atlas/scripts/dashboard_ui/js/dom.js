// DOM helpers and format helpers. The fmt functions are pure so node:test can cover them.

/** h(tag, attrs, ...children): attrs may hold class, on* handlers, dataset, and plain attributes. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (
      k === "value" ||
      k === "checked" ||
      k === "disabled" ||
      k === "hidden"
    )
      el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Swap the children of `el` for `next` (a node, string or array). */
export function replace(el, ...next) {
  el.replaceChildren();
  append(el, next);
  return el;
}

/** Add a listener and return its remover. */
export function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

/** "4m", "2h", "3d", "just now". `now` is injectable for tests. Accepts ISO strings, epoch ms or Date. */
export function relTime(ts, now = Date.now()) {
  if (ts == null || ts === "") return "";
  const t =
    ts instanceof Date
      ? ts.getTime()
      : typeof ts === "number"
        ? ts
        : Date.parse(ts);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return "just now";
  if (s < MIN) return `${s}s`;
  if (s < HOUR) return `${Math.floor(s / MIN)}m`;
  if (s < DAY) return `${Math.floor(s / HOUR)}h`;
  return `${Math.floor(s / DAY)}d`;
}

/** Compact duration from seconds: "12s", "4m 05s", "2h 10m". */
export function duration(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return "";
  const s = Math.max(0, Math.round(Number(sec)));
  if (s < MIN) return `${s}s`;
  if (s < HOUR)
    return `${Math.floor(s / MIN)}m ${String(s % MIN).padStart(2, "0")}s`;
  return `${Math.floor(s / HOUR)}h ${String(Math.floor((s % HOUR) / MIN)).padStart(2, "0")}m`;
}

/** Tabular number: thousands separators, "-" for null. */
export function num(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("en-US");
}

/** Signed delta: "+12", "-3", "0"; "" for null. */
export function delta(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  const v = Number(n);
  const s = Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(1);
  return v > 0 ? `+${s}` : v < 0 ? `-${s}` : "0";
}

/** Truncate to max characters with a plain "..." tail. */
export function truncate(str, max = 80) {
  const s = String(str ?? "");
  return s.length <= max
    ? s
    : s.slice(0, Math.max(0, max - 3)).trimEnd() + "...";
}

/** Last path segment of a project root. */
export function baseName(p) {
  const s = String(p ?? "").replace(/[\\/]+$/, "");
  return s.slice(s.lastIndexOf("/") + 1) || s;
}
