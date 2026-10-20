// Terminal (#/terminal[?space=<colony>&seat=<name>]): terminal workspace over the colony's real tmux panes.
// Spaces: "Atlas Command Center" (live atlas_tui.py over ws kind=tui) and one per colony (grid of live pane captures;
// enlarge = interactive ws kind=pane). Data: GET term/snapshot, GET term/capture, ws /api/v2/term/ws (see colony contract §3).

import { h, replace } from "../dom.js";
import { reportFetchFail, clearFetchFail } from "../fetch-fail.js";

export const CC = "command-center";
const SNAP_MS = 3000;
const CAPTURE_MS = 1500;
const RUNTIMES = { claude: "Claude Code", omp: "omp", codex: "Codex CLI" };
const START_HINT = "atlas_team (omp) or  python3 scripts/atlas_mux.py spawn-team";
const XTERM_OPTS = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, scrollback: 2000, theme: { background: "#0a0f12", foreground: "#e6edf0", cursor: "#2fbd9f" } };

// Latest snapshot the rail already fetched, keyed by its query: the page seeds SPACES from it instead of showing only the Command Center while its own (slow) fetch is in flight.
export const lastSnap = { key: "", snap: null };

const S = { timers: [], disposers: [], ccDisposers: [], keyHandler: null };

const base = () => (typeof window !== "undefined" && window.__ATLAS_BASE__) || "";
const tokenOf = () => {
  const m = document.querySelector('meta[name="atlas-token"]');
  const v = m ? m.getAttribute("content") || "" : "";
  return v === "__ATLAS_TOKEN__" ? "" : v;
};

function addAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    n.onload = resolve;
    n.onerror = () => reject(new Error("could not load " + (attrs.src || attrs.href)));
    document.head.appendChild(n);
  });
}

// xterm is vendored and loaded on first visit only (UMD: sets window.Terminal / window.FitAddon).
let xtermReady = null;
export function loadXterm() {
  if (window.Terminal && window.FitAddon) return Promise.resolve();
  xtermReady ??= (async () => {
    const v = base() + "/ui/vendor/xterm/";
    await Promise.all([
      addAsset("link", { rel: "stylesheet", href: v + "xterm.css" }),
      addAsset("script", { src: v + "xterm.js" }),
      addAsset("script", { src: v + "addon-fit.js" }),
    ]);
  })().catch((e) => { xtermReady = null; throw e; });
  return xtermReady;
}

// Largest font in [min,max] whose fitted grid reaches 152x30 (the TUI's full OpenRig header threshold); the floor when none does.
// measure(size) -> {cols, rows} for that font size.
export function stepFont(measure, max = 13, min = 10, cols = 152, rows = 30) {
  let size = max;
  while (size > min) { const m = measure(size); if (m.cols >= cols && m.rows >= rows) break; size--; }
  return size;
}

function makeTerm(el, extra) {
  const term = new window.Terminal({ ...XTERM_OPTS, ...extra });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  const doFit = () => {
    if (el.hidden) return; // a hidden surface measures 0 cols and would shrink the pty
    try {
      if (extra && extra.stepFont) term.options.fontSize = stepFont((n) => { term.options.fontSize = n; fit.fit(); return term; });
      fit.fit();
    } catch (_e) { /* not laid out yet */ }
  };
  doFit();
  // Refit whenever the surface itself resizes (the window listener alone misses sidebar and flex changes).
  let ro = null;
  if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(doFit); ro.observe(el); }
  return { term, fit: doFit, stop: () => ro && ro.disconnect() };
}

// PTY over WebSocket with reconnect: binary frames in, {t:"in"|"resize"} JSON out. onStatus("live"|"connecting"|"closed", text).
export function connectPty({ term, kind, target, project, onStatus, probe, placeholder }) {
  let ws = null;
  let closed = false;
  let attempt = 0;
  let retry = null;
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const url = () => {
    const q = new URLSearchParams({ kind, token: tokenOf(), cols: String(term.cols || 80), rows: String(term.rows || 24) });
    if (target) q.set("target", target);
    if (project && project !== "all") q.set("project", project);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + base() + "/api/v2/term/ws?" + q;
  };
  const open = () => {
    onStatus("connecting", attempt ? "reconnecting…" : "connecting…");
    ws = new WebSocket(url());
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { attempt = 0; onStatus("live", "live"); send({ t: "resize", cols: term.cols, rows: term.rows }); };
    ws.onmessage = (ev) => {
      if (waiting) { waiting = false; term.write("\x1b[2J\x1b[H"); }
      term.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      if (closed) return;
      const wait = Math.min(1000 * 2 ** attempt++, 10000);
      onStatus("closed", "disconnected, retrying in " + Math.round(wait / 1000) + "s");
      retry = setTimeout(open, wait);
      // Browsers hide the ws handshake status: replay the request as a plain GET to learn why the server refused.
      if (probe) Promise.resolve().then(probe).catch((e) => {
        if (closed || !e || !(e.status >= 400 && e.status < 500)) return;
        clearTimeout(retry);
        onStatus("error", "refused by server: " + (e.error || e.message) + (e.why ? " (" + e.why + ")" : ""));
      });
    };
    ws.onerror = () => {};
  };
  let waiting = !!placeholder;
  if (waiting) term.write(placeholder);
  // xterm reports default-encoding mouse clicks through onBinary (bytes 0-255), not onData.
  const subs = [term.onData((d) => send({ t: "in", d })), term.onBinary((d) => send({ t: "bin", d })), term.onResize(({ cols, rows }) => send({ t: "resize", cols, rows }))];
  open();
  return {
    dispose() {
      closed = true;
      clearTimeout(retry);
      subs.forEach((s) => s && s.dispose && s.dispose());
      if (ws) { ws.onclose = null; try { ws.close(); } catch (_e) { /* already closed */ } }
    },
  };
}

// Human labels from the snapshot (colony name/title/source, seat address/role_title); ids are the fallback.
export const spaceName = (c) => c.name || c.id;
export const seatAddress = (s) => s.address || s.name;
export const sourceLine = (c) => {
  const o = c.source || {};
  if (o.label) return o.label;
  const from = o.harness ? "from " + RUNTIMES[o.harness] + (o.session ? " session " + o.session : "") : o.session ? "from session " + o.session : "";
  return [from, o.lead ? "lead " + o.lead : "", o.project].filter(Boolean).join(" · ");
};
// TUI bridge payload "open;<colony>[;<seat>]" -> {space, seat}, or null when it is not an open request.
export function parseOpen(data) {
  const [verb, space, seat] = String(data).split(";");
  return verb === "open" && space ? { space, seat: seat || "" } : null;
}

const runtimeLabel = (r) => RUNTIMES[r] || "agent";
const ended = (s) => s.state === "finished" || s.state === "dead";
const endedLabel = (s) => (ended(s) ? "finished" + (s.exit_code != null ? ", exit " + s.exit_code : "") : "");
const stateChip = (s) => h("span", { class: "tw-chip", "data-state": s.state || "unknown" }, ended(s) ? s.state + (s.exit_code != null ? ", exit " + s.exit_code : "") : s.state || "unknown");
const snapKey = (snap) => JSON.stringify([((snap && snap.colonies) || []).map((c) => c.id + (c.name || "") + (c.title || "") + (c.finished ? "!" : "") + sourceLine(c)), ((snap && snap.seats) || []).map((s) => s.name + (s.address || "") + s.target + s.state)]);

function emptyColonies() {
  return h("div", { class: "tw-empty" },
    h("strong", {}, "No colonies yet"),
    h("p", {}, "Start one from your agent, then it appears here with its live panes:"),
    h("code", {}, START_HINT));
}

export default {
  id: "terminal",
  title: "Terminal",
  icon: "herd",
  group: "Operate",
  async load() {
    this.destroy();
    return null;
  },
  render(ctx) {
    const st = { snap: null, space: ctx.params.space || (ctx.params.seat ? "" : CC), seat: ctx.params.seat || "", err: "", cards: new Map(), big: null, cc: null, ccLoading: false, ptyStatus: "" };
    const header = h("div", { class: "tw-head" });
    const side = h("nav", { class: "tw-side", "aria-label": "Terminal spaces" });
    // The Command Center terminal lives in ccHost for the life of the page; other spaces draw into `other`. Switching spaces only toggles hidden.
    const ccHost = h("div", { class: "tw-term tw-term-cc" });
    const other = h("div", { class: "tw-pane" });
    const main = h("div", { class: "tw-main" }, ccHost, other);
    const foot = h("div", { class: "tw-foot" });
    const root = h("div", { class: "page terminal-page tw" }, header, h("div", { class: "tw-body" }, side, main), foot);

    const isAll = () => { const p = ctx.params.project || ctx.project; return !p || p === "all"; };
    const project = () => (isAll() ? "" : ctx.params.project || ctx.project);
    const snapParams = () => (isAll() ? { all: "1" } : { project: project() });
    const seed = lastSnap.key === JSON.stringify(snapParams()) && (ctx.params.space || !ctx.params.seat) ? lastSnap.snap : null;
    if (seed) st.snap = seed;
    const colonies = () => (st.snap && st.snap.colonies) || [];
    const colony = () => colonies().find((c) => c.id === st.space) || null;
    const seatsOf = (c) => ((st.snap && st.snap.seats) || []).filter((s) => s.colony === c.id);
    const clearTimers = () => { S.timers.forEach(clearInterval); S.timers = []; };
    const disposeSurface = () => {
      clearTimers();
      S.disposers.forEach((d) => { try { d(); } catch (_e) { /* best effort */ } });
      S.disposers = [];
      st.cards = new Map(); st.big = null;
    };
    const show = (cc) => { ccHost.hidden = !cc; other.hidden = cc; };
    const setStatus = (kind, text) => { st.ptyStatus = text; st.ptyErr = kind === "error"; drawFoot(); };
    const attachPty = (el, kind, extra) => {
      const { term, fit, stop } = makeTerm(el, { cursorBlink: true, stepFont: kind === "tui" });
      const pty = connectPty({ term, kind, project: project(), probe: () => ctx.api.get("term/snapshot", snapParams()), onStatus: setStatus, ...extra });
      window.addEventListener("resize", fit);
      (kind === "tui" ? S.ccDisposers : S.disposers).push(() => { pty.dispose(); stop(); term.dispose(); window.removeEventListener("resize", fit); });
      term.focus();
      if (kind === "tui") { // the Command Center is clickable, and its TUI can open a space here (private OSC 7717)
        el.addEventListener("mousedown", () => term.focus());
        if (term.parser) term.parser.registerOscHandler(7717, (data) => { const o = parseOpen(data); if (o) go(o.space, o.seat); return true; });
      }
      return { term, fit };
    };
    const sync = () => { if (ctx.setParams) ctx.setParams({ space: st.space === CC ? "" : st.space, seat: st.seat }); };

    function go(space, seat = "") {
      if (space === st.space && seat === st.seat && main.children.length) return;
      st.space = space; st.seat = seat;
      sync();
      drawAll();
    }

    function drawHead() {
      replace(header, h("h1", {}, (st.snap && st.snap.host ? st.snap.host + " · " : "") + "Terminal"), h("span", { class: "tw-sub" }, "terminal workspace"));
    }

    function drawSide() {
      const spaces = [{ id: CC, label: "Atlas Command Center" }, ...colonies().map((c) => ({ id: c.id, label: spaceName(c), title: c.title || c.label, sub: c.title, finished: c.finished }))];
      const items = spaces.map((s) => h("button", { class: "tw-space" + (s.finished ? " is-finished" : ""), type: "button", "aria-current": s.id === st.space ? "page" : null, title: s.title || s.label, onClick: () => go(s.id) }, h("span", { class: "tw-agent-name" }, s.label, s.finished ? h("span", { class: "tw-fin" }, "finished") : null), s.sub ? h("span", { class: "tw-agent-role tw-sub2" }, s.sub) : null));
      const parts = [h("div", { class: "tw-side-label" }, "SPACES"), ...items];
      const c = colony();
      if (c) {
        const seats = seatsOf(c);
        parts.push(h("div", { class: "tw-side-label" }, "Agents · " + seats.length));
        for (const s of seats) {
          parts.push(h("button", { class: "tw-agent", type: "button", "aria-current": s.name === st.seat ? "true" : null, onClick: () => go(c.id, s.name) },
            h("span", { class: "tw-dot", "data-state": s.state || "unknown" }), h("span", { class: "tw-agent-name" }, seatAddress(s), s.role_title ? h("span", { class: "tw-agent-role tw-sub2" }, s.role_title) : null)));
        }
      }
      if (!st.snap) parts.push(h("p", { class: "tw-sub2 tw-loading" }, "Loading colonies…"));
      if (st.snap && !colonies().length) parts.push(emptyColonies());
      replace(side, ...parts);
    }

    function drawFoot() {
      const c = colony();
      const left = st.space === CC ? "Atlas Command Center · live" : c ? seatsOf(c).length + " agents in " + spaceName(c) + " · live tmux panes" : "";
      replace(foot, h("span", {}, left), st.ptyStatus ? h("span", { class: "tw-status" + (st.ptyErr ? " tw-err" : ""), role: "status" }, st.ptyStatus) : null, st.err ? h("span", { class: "tw-status tw-err", role: "status" }, st.err) : null, h("span", { class: "tw-clock" }, (st.snap && st.snap.clock) || ""));
    }

    async function drawCommandCenter() {
      show(true);
      if (st.cc) { st.cc.fit(); st.cc.term.focus(); return; }
      if (st.ccLoading) return;
      st.ccLoading = true;
      try { await loadXterm(); } catch (e) { st.ccLoading = false; st.err = String(e.message || e); return drawFoot(); }
      st.ccLoading = false;
      if (!ccHost.isConnected) return;
      st.cc = attachPty(ccHost, "tui", { placeholder: "starting Atlas Command Center…" });
      if (st.space !== CC) show(false); // the user moved on while xterm was loading
    }

    async function pollOne(s) {
      const card = st.cards.get(s.name);
      if (!card || !s.target) return;
      try {
        const r = await ctx.api.get("term/capture", { target: s.target, lines: 60, ansi: 1 });
        if (r && r.ok !== false && typeof r.text === "string" && r.text !== card.last) {
          card.last = r.text;
          card.term.reset();
          card.fit();
          card.term.write("\x1b[?7l" + r.text.replace(/\r?\n/g, "\r\n"));
        }
        clearFetchFail("term/capture");
      } catch (_e) { reportFetchFail("terminal", "term/capture", _e); } // the next tick retries
    }
    const pollCaptures = (c) => Promise.all(seatsOf(c).map((s) => pollOne(s)));

    function addCard(c, s, grid) {
      const body = h("div", { class: "tw-card-body" });
      const live = Boolean(s.target);
      const card = h("article", { class: "tw-card", "data-state": s.state || "unknown" },
        h("header", { class: "tw-card-head" }, h("span", { class: "tw-badge", "data-rt": s.runtime || "unknown" }, runtimeLabel(s.runtime)), h("span", { class: "tw-card-name" }, seatAddress(s)), stateChip(s),
          h("button", { class: "tw-open", type: "button", title: live ? "Enlarge" : "No terminal pane", "aria-label": "Enlarge " + seatAddress(s), disabled: !live, onClick: () => go(c.id, s.name) }, "↗")),
        body);
      grid.appendChild(card);
      if (!live) return body.appendChild(h("p", { class: "tw-card-note" }, endedLabel(s) || "no terminal attached", s.now ? h("span", { class: "tw-now" }, s.now) : null));
      const { term, fit } = makeTerm(body, { disableStdin: true, cursorBlink: false, cursorStyle: "bar", fontSize: 11 });
      st.cards.set(s.name, { term, fit, last: null });
      window.addEventListener("resize", fit);
      S.disposers.push(() => window.removeEventListener("resize", fit), () => term.dispose());
      body.addEventListener("click", () => go(c.id, s.name));
    }

    async function drawGrid(c) {
      const seats = seatsOf(c);
      const grid = h("div", { class: "tw-grid" });
      const crumbs = h("div", { class: "tw-crumbs" }, h("strong", {}, spaceName(c) + " / All agents"), h("span", { class: "tw-task" }, c.title || c.task || ""), sourceLine(c) ? h("span", { class: "tw-source" }, sourceLine(c)) : null);
      replace(other, crumbs, seats.length ? grid : h("div", { class: "tw-empty" }, h("strong", {}, "No agents in this colony yet")));
      if (!seats.length) return;
      try { await loadXterm(); } catch (e) { st.err = String(e.message || e); return drawFoot(); }
      if (st.space !== c.id || st.seat) return;
      for (const s of seats) addCard(c, s, grid);
      pollCaptures(c);
      S.timers.push(setInterval(() => pollCaptures(c), CAPTURE_MS));
    }

    async function drawBig(c, s) {
      const el = h("div", { class: "tw-term tw-term-pane" });
      const back = h("button", { class: "tw-back btn", type: "button", onClick: () => go(c.id) }, "← All agents");
      replace(other, h("div", { class: "tw-crumbs" }, back, h("strong", {}, spaceName(c) + " / " + seatAddress(s)), s.role_title ? h("span", { class: "tw-sub" }, s.role_title) : null, h("span", { class: "tw-badge", "data-rt": s.runtime || "unknown" }, runtimeLabel(s.runtime)), stateChip(s), h("span", { class: "tw-task" }, "Esc outside the terminal or Shift+Esc to go back")), el);
      try { await loadXterm(); } catch (e) { st.err = String(e.message || e); return drawFoot(); }
      if (!el.isConnected || st.seat !== s.name) return;
      st.big = attachPty(el, "pane", { target: s.target });
    }

    function drawAll() {
      disposeSurface();
      st.ptyStatus = "";
      drawHead(); drawSide(); drawFoot();
      const c = colony();
      if (st.space !== CC && !c) {
        if (!st.snap) return replace(other, h("div", { class: "tw-empty" }, "Loading colonies…")), show(false);
        st.space = CC; st.seat = ""; // unknown colony: fall back to the default space
      }
      if (st.space === CC) return drawCommandCenter();
      show(false);
      const s = st.seat && seatsOf(c).find((x) => x.name === st.seat && x.target);
      if (st.seat && !s) st.seat = "";
      return s ? drawBig(c, s) : drawGrid(c);
    }

    function applySnap(snap) {
      const first = !st.snap;
      const unresolved = first && !st.space;
      if (unresolved) { // seat deep link without a colony: find it in the snapshot
        const hit = snap.seats.find((x) => x.name === st.seat);
        st.space = hit ? hit.colony : CC;
      }
      const changed = snapKey(st.snap) !== snapKey(snap);
      st.snap = snap;
      st.err = "";
      if (!first && !changed) return drawFoot();
      drawHead(); drawSide(); drawFoot();
      if ((first && (st.space !== CC || unresolved)) || (st.space !== CC && !st.seat)) drawAll();
    }

    async function refresh() {
      try {
        applySnap(await ctx.api.get("term/snapshot", snapParams()));
        clearFetchFail("term/snapshot");
      } catch (e) {
        reportFetchFail("terminal", "term/snapshot", e);
        st.err = "snapshot unavailable: " + String((e && (e.error || e.message)) || e);
        drawFoot();
      }
    }

    S.keyHandler = (ev) => {
      if (ev.key !== "Escape" || st.space === CC || !st.seat) return;
      const inTerm = ev.target && ev.target.closest && ev.target.closest(".xterm");
      if (inTerm && !ev.shiftKey) return; // plain Esc belongs to the worker's own UI while it has focus
      ev.preventDefault && ev.preventDefault();
      go(st.space);
    };
    document.addEventListener("keydown", S.keyHandler);

    drawAll();
    refresh();
    S.snapTimer = setInterval(refresh, SNAP_MS);
    return root;
  },
  destroy() {
    S.timers.forEach(clearInterval);
    S.timers = [];
    clearInterval(S.snapTimer);
    S.disposers.forEach((d) => { try { d(); } catch (_e) { /* best effort */ } });
    S.disposers = [];
    S.ccDisposers.forEach((d) => { try { d(); } catch (_e) { /* best effort */ } });
    S.ccDisposers = [];
    if (S.keyHandler) document.removeEventListener("keydown", S.keyHandler);
    S.keyHandler = null;
  },
};
