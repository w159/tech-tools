// Terminal band: a pure function of its model (no fetch, no DOM). HTML string out.
import { PHASE_GLYPH, STATE_GLYPH } from "./glyph-table.js";

const NAV = [
  ["run", "Run"],
  ["agents", "Agents"],
  ["board", "Board"],
  ["channels", "Channels"],
  ["health", "Health"],
  ["settings", "Settings"],
];

const LIVE_WORD = {
  live: ["ok", "Live"],
  connecting: ["idle", "Connecting"],
  reconnecting: ["needs", "Reconnecting"],
  offline: ["fail", "Offline"],
};

const PHASES = ["research", "theory", "test", "validate", "implement", "verify", "done"];

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const pillPast = (name) =>
  `<span class="pill past"><span class="g">\u2713</span> ${esc(name)}</span>`;
const pillFuture = (name) => `<span class="pill future">${esc(name)}</span>`;
const pillNow = (name, n, m) =>
  `<span class="pill now"><span class="g">${PHASE_GLYPH[name]}</span> ${esc(name.toUpperCase())}${fraction(n, m)}</span>`;
const fraction = (n, m) => (n != null && m != null ? ` ${esc(n)}/${esc(m)}` : "");

function pill(name, i, cur, n, m) {
  if (i < cur) return pillPast(name);
  return i > cur ? pillFuture(name) : pillNow(name, n, m);
}

function count(n, tone, glyph, label, pulse) {
  return `<span class="cnt ${tone}${pulse && n > 0 ? " pulse" : ""}"><span class="dot" aria-hidden="true">${glyph}</span>${esc(n)} ${label}</span>`;
}

export function renderBand(model) {
  const { project, branch, lead, phase, n, m, counts, live, clock, narrow, route } = model;
  const title = [project, branch, lead].filter(Boolean).map(esc).join(" · ");
  const cur = Math.max(0, PHASES.indexOf(phase));
  const pills = PHASES.map((p, i) => pill(p, i, cur, n, m)).filter(
    (_, i) => !narrow || i === cur,
  );
  const tabs = NAV.map(
    ([r, label]) =>
      `<a href="#/${r}" data-route="${r}"${r === route ? ' aria-current="page"' : ""}>${label}</a>`,
  ).join("");
  const [tone, word] = LIVE_WORD[live] || LIVE_WORD.offline;
  return (
    `<div class="band-row band-top">` +
    `<a class="mark" href="#/run" aria-label="Atlas, run">⬢ ATLAS</a><span class="sep">|</span>` +
    `<span class="title">mission control${title ? ` · ${title}` : ""}</span>` +
    `<nav class="tabs" aria-label="Primary">${tabs}<kbd class="hint" title="Search">/</kbd></nav></div>` +
    `<div class="band-row band-rail"><div class="rail" role="list">${pills.join("")}</div>` +
    `<div class="counts">` +
    count(counts.working, "working", STATE_GLYPH.running, "working", true) +
    count(counts.needs, "needs", STATE_GLYPH.input, "needs you") +
    count(counts.failed, "fail", STATE_GLYPH.failed, "failed") +
    count(counts.parked, "idle", STATE_GLYPH.parked, "parked") +
    `<span class="live ${tone}"><span class="dot" aria-hidden="true">●</span>${word}</span>` +
    `<time class="clock">${esc(clock || "")}</time></div></div>`
  );
}
