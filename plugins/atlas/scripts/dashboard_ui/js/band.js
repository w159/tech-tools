// Terminal band: a pure function of its model (no fetch, no DOM). HTML string out.

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
  connecting: ["connecting", "Connecting"],
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
  `<span class="pill now"><span class="g">\u25C6</span> ${esc(name.toUpperCase())}${fraction(n, m)}</span>`;
const fraction = (n, m) => (n != null && m != null ? ` ${esc(n)}/${esc(m)}` : "");

function pill(name, i, cur, n, m) {
  if (i < cur) return pillPast(name);
  return i > cur ? pillFuture(name) : pillNow(name, n, m);
}

// CSS-drawn dot: colour comes from the tone class (shell.css), never from a glyph character.
const dot = (tone) => `<i class="dot ${tone}" aria-hidden="true"></i>`;

function count(n, tone, label, pulse) {
  const cls = pulse && n > 0 ? `${tone} pulse` : tone;
  return `<span class="cnt">${dot(cls)}${esc(n)} ${label}</span>`;
}

// Hex-cube mark (same path as the v14 brandMark), inline so the band needs no icon import.
const MARK =
  '<svg class="mark-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12v10M12 12L3 7"/></svg>';

export function renderBand(model) {
  const { project, branch, lead, phase, n, m, counts, live, clock, narrow, route } = model;
  const title = [project, branch, lead].filter(Boolean).map(esc).join(" \u00B7 ")  // middle dot, same separator as terminal band.tsx:72-76;
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
    `<a class="mark" href="#/run" aria-label="Atlas, run">${MARK}ATLAS</a><span class="sep">|</span>` +
    `<span class="title">mission control${title ? ` \u00B7 ${title}` : ""}</span>` +
    `<nav class="tabs" aria-label="Primary">${tabs}<kbd class="hint" title="Search">/</kbd></nav></div>` +
    `<div class="band-row band-rail"><div class="rail" role="list">${pills.join("")}</div>` +
    `<div class="counts">` +
    count(counts.working, "working", "working", true) +
    count(counts.needs, "needs", "needs you") +
    count(counts.failed, "fail", "failed") +
    count(counts.parked, "parked", "parked") +
    `<span class="live">${dot(tone)}${word}</span>` +
    `<time class="clock">${esc(clock || "")}</time></div></div>`
  );
}
