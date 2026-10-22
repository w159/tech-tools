// Terminal (#/terminal[?space=<id>&seat=<address>]): an openrig-style grid of REAL terminals.
// One card per seat (colony panes, a shell per space, the Atlas TUI on the host); each card is an xterm bound to a PTY over
// ws /api/v2/term/ws, opened with a single-use ticket (POST term/ticket). Data: GET term/seats, GET term/capture.

import { h, replace, fmtRelative } from "../dom.js";
import { reportFetchFail, clearFetchFail } from "../fetch-fail.js";

export const CC = "command-center";
const SEATS_MS = 3000;
const RUNTIMES = { claude: "Claude Code", omp: "omp", codex: "Codex CLI", shell: "Shell", tui: "TUI" };
const START_HINT = "atlas_team (omp) or  python3 scripts/atlas_mux.py spawn-team";
const KEYS_HELP = "Arrows move between cards. Enter or click enlarges one. Esc outside a terminal (or Shift+Esc inside) goes back to all agents. Shift+Tab leaves the terminal. Plain Esc and Tab belong to the program running in the terminal.";
// Mutable so tests can shrink the timers; production values come from the plan (60 s offscreen, 6 sockets, 5 s to first frame).
export const TUNE = { offscreenMs: 60000, maxLive: 6, noFrameMs: 5000 };
// Theme = the openrig tokens in css/terminal.css.
const XTERM_OPTS = {
  fontFamily: '"JetBrains Mono Web", "JetBrains Mono", Menlo, monospace', fontSize: 14, scrollback: 2000, cursorBlink: true,
  theme: { background: "#161616", foreground: "#dedede", cursor: "#d79878", selectionBackground: "#3c4249", brightBlack: "#8b8b8b", yellow: "#d9bd7e", green: "#a4d397" },
};

// Latest snapshot the rail fetched (machine-colonies.js writes it); kept for that caller.
export const lastSnap = { key: "", snap: null };

const S = { timers: [], disposers: [], keyHandler: null };

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

// PTY over WebSocket with reconnect: binary frames in, {t:"in"|"resize"} JSON out. onStatus("live"|"connecting"|"closed"|"error", text).
// fetchTicket(body) -> Promise<ticket> opens every (re)connect with a fresh single-use ticket; without it the legacy token= URL is used.
// noFrameMs/onNoFrame: no byte within that long after the socket opens -> onNoFrame (the card shows Retry); onFrame fires on the first byte.
export function connectPty({ term, kind, target, project, cwd, onStatus, probe, placeholder, fetchTicket, noFrameMs, onNoFrame, onFrame }) {
  let ws = null;
  let closed = false;
  let attempt = 0;
  let retry = null;
  let frameTimer = null;
  let waiting = !!placeholder;
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const size = () => ({ cols: term.cols || 80, rows: term.rows || 24 });
  const ticketBody = () => {
    const b = { kind, ...size() };
    if (target) b.target = target;
    if (project && project !== "all") b.project = project;
    if (cwd) b.cwd = cwd;
    return b;
  };
  const url = (ticket) => {
    const { cols, rows } = size();
    const q = new URLSearchParams({ kind, cols: String(cols), rows: String(rows) });
    if (ticket) q.set("ticket", ticket); else q.set("token", tokenOf());
    if (target) q.set("target", target);
    if (project && project !== "all") q.set("project", project);
    if (cwd) q.set("cwd", cwd);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + base() + "/api/v2/term/ws?" + q;
  };
  const refused = (e) => {
    clearTimeout(retry);
    onStatus("error", "refused by server: " + (e.error || e.message) + (e.why ? " (" + e.why + ")" : ""));
  };
  const scheduleRetry = () => {
    const wait = Math.min(1000 * 2 ** attempt++, 10000);
    onStatus("closed", "disconnected, retrying in " + Math.round(wait / 1000) + "s");
    retry = setTimeout(open, wait);
  };
  const dial = (ticket) => {
    ws = new WebSocket(url(ticket));
    ws.binaryType = "arraybuffer";
    if (noFrameMs) frameTimer = setTimeout(() => { if (!closed && onNoFrame) onNoFrame(); }, noFrameMs);
    ws.onopen = () => { attempt = 0; onStatus("live", "live"); send({ t: "resize", ...size() }); };
    ws.onmessage = (ev) => {
      if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; if (onFrame) onFrame(); }
      if (waiting) { waiting = false; term.write("\x1b[2J\x1b[H"); }
      term.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      if (closed) return;
      clearTimeout(frameTimer);
      scheduleRetry();
      // Browsers hide the ws handshake status: replay the request as a plain GET to learn why the server refused.
      if (probe) Promise.resolve().then(probe).catch((e) => { if (!closed && e && e.status >= 400 && e.status < 500) refused(e); });
    };
    ws.onerror = () => {};
  };
  function open() {
    onStatus("connecting", attempt ? "reconnecting…" : "connecting…");
    if (!fetchTicket) return dial(null);
    Promise.resolve().then(() => fetchTicket(ticketBody())).then((t) => { if (!closed) dial(t); }, (e) => {
      if (closed) return;
      if (e && e.status >= 400 && e.status < 500) return refused(e);
      scheduleRetry();
    });
  }
  if (waiting) term.write(placeholder);
  // xterm reports default-encoding mouse clicks through onBinary (bytes 0-255), not onData.
  const subs = [term.onData((d) => send({ t: "in", d })), term.onBinary((d) => send({ t: "bin", d })), term.onResize(({ cols, rows }) => send({ t: "resize", cols, rows }))];
  open();
  const shut = () => { clearTimeout(retry); clearTimeout(frameTimer); frameTimer = null; if (ws) { ws.onclose = null; try { ws.close(); } catch (_e) { /* already closed */ } ws = null; } };
  return {
    reconnect() { shut(); attempt = 0; waiting = !!placeholder; if (waiting) term.write(placeholder); open(); },
    dispose() { closed = true; shut(); subs.forEach((s) => s && s.dispose && s.dispose()); },
  };
}

// Human labels from colony data (kept for the Colony page and the rail); ids are the fallback.
export const spaceName = (c) => c.name || c.id;
export const seatAddress = (s) => s.address || s.name;
export const sourceLine = (c) => {
  const o = c.source || {};
  if (o.label) return o.label;
  const from = o.harness ? "from " + RUNTIMES[o.harness] + (o.session ? " session " + o.session : "") : o.session ? "from session " + o.session : "";
  return [from, o.lead ? "lead " + o.lead : "", o.project].filter(Boolean).join(" · ");
};
// TUI bridge payload "open;<space>[;<seat>]" -> {space, seat}, or null when it is not an open request.
export function parseOpen(data) {
  const [verb, space, seat] = String(data).split(";");
  return verb === "open" && space ? { space, seat: seat || "" } : null;
}

const runtimeLabel = (s) => RUNTIMES[s.kind === "shell" ? "shell" : s.kind === "tui" ? "tui" : s.runtime] || "agent";
const isRunning = (s) => s.state === "running" || s.state === "working";
const hasTerminal = (s) => s.kind !== "pane" || Boolean(s.target);
// last_activity arrives as epoch seconds, epoch ms or ISO text.
const ageOf = (v) => (v == null || v === "" ? "" : fmtRelative(typeof v === "number" && v < 1e12 ? v * 1000 : v));
const seatsKey = (data) => JSON.stringify(((data && data.spaces) || []).map((sp) => [sp.id, sp.name, (sp.seats || []).map((s) => [s.address, s.state, s.target, s.kind])]));
const setCls = (el, name, on) => {
  const set = new Set((el.getAttribute("class") || "").split(" ").filter(Boolean));
  if (on) set.add(name); else set.delete(name);
  el.setAttribute("class", [...set].join(" "));
};

function emptyColonies() {
  return h("div", { class: "tw-empty" },
    h("strong", {}, "No colonies yet"),
    h("p", {}, "Start one from your agent, then its live panes appear here:"),
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
    const st = { data: null, key: "", space: ctx.params.space || "", seat: ctx.params.seat || "", err: "", cards: new Map(), io: null, ioMap: new Map(), scroll: 0, grid: null, status: "", statusErr: false, built: "" };
    const header = h("div", { class: "tw-head" });
    const side = h("nav", { class: "tw-side", "aria-label": "Terminal spaces" });
    const main = h("div", { class: "tw-main" });
    const foot = h("div", { class: "tw-foot" });
    const root = h("div", { class: "page terminal-page tw" }, header, h("div", { class: "tw-body" }, side, main), foot);

    const isAll = () => { const p = ctx.params.project || ctx.project; return !p || p === "all"; };
    const project = () => (isAll() ? "" : ctx.params.project || ctx.project);
    const seatParams = () => (isAll() ? { all: "1" } : { project: project() });
    const spaces = () => (st.data && st.data.spaces) || [];
    const space = () => spaces().find((sp) => sp.id === st.space) || null;
    const seatsOf = (sp) => (sp && sp.seats) || [];
    const findSeat = (sp, key) => seatsOf(sp).find((s) => s.address === key || s.name === key) || null;
    const enlargedSeat = () => (st.seat && space() ? findSeat(space(), st.seat) : null);
    const wantLive = (c) => (st.seat ? c.seat.address === (enlargedSeat() || {}).address : c.inView);
    const sync = () => { if (ctx.setParams) ctx.setParams({ space: st.space, seat: st.seat }); };
    const liveCount = () => [...st.cards.values()].filter((c) => c.pty).length;

    // ---- card connection policy -----------------------------------------------------------------------------------
    async function capture(c) {
      if (!c.seat.target) return;
      try {
        const r = await ctx.api.get("term/capture", { target: c.seat.target, lines: 60, ansi: 1 });
        if (r && r.ok !== false && typeof r.text === "string" && r.text !== c.last && !c.pty) {
          c.last = r.text; c.term.reset(); c.fit();
          c.term.write("\x1b[?7l" + r.text.replace(/\r?\n/g, "\r\n"));
        }
        clearFetchFail("term/capture");
      } catch (e) { reportFetchFail("terminal", "term/capture", e); } // the next seats tick retries
    }
    function setPaused(c, on) {
      c.paused = on;
      setCls(c.el, "is-paused", on);
      c.badge.hidden = !on;
      if (on) capture(c);
    }
    function disconnect(c) {
      clearTimeout(c.offTimer); c.offTimer = null;
      if (!c.pty) return;
      c.pty.dispose(); c.pty = null;
      if (c.ph) { c.ph.remove(); c.ph = null; }
    }
    function connect(c) {
      const s = c.seat;
      setPaused(c, false);
      c.term.reset(); c.last = null;
      const retryRow = () => {
        c.ph = h("div", { class: "tw-ph", role: "alert" }, h("span", {}, "no output from " + seatAddress(s) + " after " + Math.round(TUNE.noFrameMs / 1000) + " s"),
          h("button", { class: "btn tw-retry", type: "button", onClick: () => { c.ph.remove(); c.ph = null; c.pty.reconnect(); } }, "Retry"));
        c.body.appendChild(c.ph);
      };
      c.pty = connectPty({
        term: c.term, kind: s.kind, target: s.target || "", project: s.project || project(), cwd: s.kind === "shell" ? s.cwd : "",
        placeholder: "connecting to " + seatAddress(s) + "…", noFrameMs: TUNE.noFrameMs, onNoFrame: retryRow, onFrame: () => { if (c.ph) { c.ph.remove(); c.ph = null; } },
        fetchTicket: async (b) => { const r = await ctx.api.post("term/ticket", b); if (!r || !r.ticket) throw new Error("no ticket"); return r.ticket; },
        probe: () => ctx.api.get("term/seats", seatParams()),
        onStatus: (kind, text) => { c.conn = kind === "live" ? "" : text; drawFooter(c); if (st.seat) { st.status = text; st.statusErr = kind === "error"; drawFoot(); } },
      });
      c.term.focus && st.seat && c.term.focus();
    }
    // Connect every wanted card while sockets remain; the rest show their last capture with a "paused" badge.
    function reconcile() {
      for (const c of st.cards.values()) {
        if (!hasTerminal(c.seat)) continue;
        if (!wantLive(c)) { if (c.pty && st.seat) disconnect(c); continue; }
        if (c.pty) continue;
        if (liveCount() < TUNE.maxLive) connect(c); else if (!c.paused) setPaused(c, true);
      }
    }
    function onView(c, visible) {
      c.inView = visible;
      if (visible) { clearTimeout(c.offTimer); c.offTimer = null; reconcile(); return; }
      if (!c.pty) return;
      clearTimeout(c.offTimer);
      c.offTimer = setTimeout(() => { c.offTimer = null; if (!c.inView) { disconnect(c); reconcile(); } }, TUNE.offscreenMs);
    }

    // ---- cards ----------------------------------------------------------------------------------------------------
    function drawFooter(c) {
      const s = c.seat;
      const age = ageOf(s.last_activity);
      replace(c.foot, isRunning(s) ? h("span", { class: "spinner", "aria-hidden": "true" }, "✻") : null,
        h("span", { class: "activity-text" }, [s.state || "unknown", age ? "· " + age : "", c.conn ? "· " + c.conn : ""].filter(Boolean).join(" ")));
    }
    function makeCard(s) {
      const content = h("div", { class: "terminal-content" });
      const badge = h("span", { class: "paused-badge", hidden: true }, "paused");
      const body = h("div", { class: "terminal-body" }, content, badge);
      const foot = h("footer", { class: "activity" });
      const open = () => goSeat(s.address);
      const el = h("article", { class: "terminal-card", tabindex: "0", "data-address": s.address, "data-runtime": s.kind === "pane" ? s.runtime || "agent" : s.kind, "data-state": s.state || "unknown",
        "aria-label": seatAddress(s) + (s.role ? ", " + s.role : ""),
        onKeydown: (ev) => cardKey(ev, c, open) },
      h("header", { class: "runtime-title" }, h("span", { class: "runtime-name" }, runtimeLabel(s)), h("span", { class: "seat-address" }, seatAddress(s)),
        h("button", { class: "tw-open", type: "button", "aria-label": "Enlarge " + seatAddress(s), title: "Enlarge", onClick: open }, "↗")),
      body, foot);
      const c = { seat: s, el, body, foot, badge, pty: null, ph: null, paused: false, inView: !st.io, offTimer: null, conn: "", last: null };
      if (!hasTerminal(s)) {
        content.appendChild(h("p", { class: "tw-card-note" }, s.state === "ended" || s.state === "finished" || s.state === "dead" ? "ended" : s.attach_hint || "no terminal attached"));
      } else {
        const t = makeTerm(content, s.kind === "tui" ? { stepFont: true } : {});
        Object.assign(c, { term: t.term, fit: t.fit, stop: t.stop });
        if (t.term.attachCustomKeyEventHandler) t.term.attachCustomKeyEventHandler((ev) => !(ev.type === "keydown" && ev.key === "Tab" && ev.shiftKey)); // Shift+Tab leaves the terminal
        window.addEventListener("resize", t.fit);
        if (s.kind === "tui" && t.term.parser) t.term.parser.registerOscHandler(7717, (data) => { const o = parseOpen(data); if (o) go(o.space, o.seat); return true; });
      }
      body.addEventListener("click", () => { if (!st.seat) open(); }); // the whole card body enlarges, terminal or not
      drawFooter(c);
      if (st.io) { st.ioMap.set(el, c); st.io.observe(el); }
      st.cards.set(s.address, c);
      return c;
    }
    function dropCard(c) {
      disconnect(c);
      if (st.io) { st.io.unobserve(c.el); st.ioMap.delete(c.el); }
      if (c.term) { window.removeEventListener("resize", c.fit); c.stop(); c.term.dispose(); }
    }
    function disposeCards() { st.cards.forEach(dropCard); st.cards.clear(); if (st.io) st.io.disconnect(); }

    function cardKey(ev, c, open) {
      if (ev.target !== c.el) return; // keys typed inside the terminal belong to it
      const els = [...st.cards.values()].map((x) => x.el);
      const i = els.indexOf(c.el);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + 2, ArrowUp: i - 2 }[ev.key];
      if (ev.key === "Enter") { ev.preventDefault && ev.preventDefault(); open(); } else if (to !== undefined && els[to]) { ev.preventDefault && ev.preventDefault(); els[to].focus(); }
    }

    // ---- navigation -----------------------------------------------------------------------------------------------
    function go(spaceId, seatKey = "") {
      const sp = spaces().find((x) => x.id === spaceId);
      const seat = sp && seatKey ? findSeat(sp, seatKey) : null;
      if (spaceId === st.space && (seat ? seat.address : "") === st.seat && main.children.length) return;
      if (spaceId === st.space && sp) return enlarge(seat ? seat.address : "");
      st.space = spaceId; st.seat = seat ? seat.address : "";
      sync();
      drawAll();
    }
    function goSeat(address) { enlarge(address); }
    function enlarge(address) {
      if (address && !st.seat) st.scroll = main.scrollTop || 0;
      st.seat = address; st.status = "";
      sync();
      if (st.grid) applyEnlarge(st.grid);
      for (const c of st.cards.values()) if (c.pty && !wantLive(c)) disconnect(c);
      drawSide(); drawFoot(); drawCrumbs();
      reconcile();
      if (!address) { main.scrollTop = st.scroll; const c = [...st.cards.values()][0]; if (c) c.el.focus && c.el.focus(); }
    }
    function applyEnlarge(grid) {
      setCls(grid, "enlarged", Boolean(st.seat));
      for (const c of st.cards.values()) { c.el.hidden = Boolean(st.seat) && c.seat.address !== st.seat; setCls(c.el, "enlarged", c.seat.address === st.seat); if (!c.el.hidden && c.fit) c.fit(); }
    }

    // ---- drawing --------------------------------------------------------------------------------------------------
    function drawHead() {
      replace(header, h("h1", {}, (st.data && st.data.machine ? st.data.machine + " · " : "") + "Terminal"), h("span", { class: "tw-sub" }, "terminal workspace"));
    }
    function drawSide() {
      const sps = spaces();
      const items = sps.map((sp) => h("button", { class: "tw-space", type: "button", "aria-current": sp.id === st.space ? "page" : null, title: sp.name, onClick: () => go(sp.id) },
        h("span", { class: "tw-agent-name" }, sp.name || sp.id), h("span", { class: "tw-agent-role tw-sub2" }, sp.kind === "host" ? "this machine" : seatsOf(sp).length + " seats")));
      const parts = [h("div", { class: "tw-side-label" }, "SPACES"), ...items];
      const sp = space();
      if (sp) {
        parts.push(h("div", { class: "tw-side-label tw-side-label-mixed" }, "Agents · " + seatsOf(sp).length));
        for (const s of seatsOf(sp)) {
          parts.push(h("button", { class: "tw-agent", type: "button", "aria-current": s.address === st.seat ? "true" : null, onClick: () => go(sp.id, s.address) },
            h("span", { class: "tw-dot", "data-state": s.state || "unknown" }), h("span", { class: "tw-agent-name" }, seatAddress(s), s.role ? h("span", { class: "tw-agent-role tw-sub2" }, s.role) : null)));
        }
      }
      if (!st.data) parts.push(h("p", { class: "tw-sub2 tw-loading" }, "Loading seats…"));
      if (st.data && !sps.some((x) => x.kind === "colony")) parts.push(emptyColonies());
      replace(side, ...parts);
    }
    function drawFoot() {
      const sp = space();
      const left = sp ? seatsOf(sp).length + " seats in " + (sp.name || sp.id) + " · live terminals" : "";
      replace(foot, h("span", {}, left), st.status ? h("span", { class: "tw-status" + (st.statusErr ? " tw-err" : ""), role: "status" }, st.status) : null, st.err ? h("span", { class: "tw-status tw-err", role: "status" }, st.err) : null, h("span", { class: "tw-clock" }, (st.data && st.data.clock) || ""));
    }
    const crumbs = h("div", { class: "tw-crumbs" });
    function drawCrumbs() {
      const sp = space();
      if (!sp) return replace(crumbs);
      const s = enlargedSeat();
      replace(crumbs, s ? h("button", { class: "tw-back btn", type: "button", onClick: () => enlarge("") }, "← All agents") : null,
        h("strong", {}, (sp.name || sp.id) + (s ? " / " + seatAddress(s) : " / All agents")), s && s.role ? h("span", { class: "tw-sub" }, s.role) : null,
        h("details", { class: "tw-keys" }, h("summary", {}, "How to navigate"), h("p", {}, KEYS_HELP)));
    }
    async function drawMain() {
      const sp = space();
      disposeCards();
      st.built = sp ? sp.id : "";
      if (!sp) return replace(main, h("div", { class: "tw-empty" }, st.data ? "No such space" : "Loading seats…"));
      const grid = h("div", { class: "tw-grid" });
      st.grid = grid;
      replace(main, crumbs, seatsOf(sp).length ? grid : h("div", { class: "tw-empty" }, h("strong", {}, "No seats in this space yet")));
      drawCrumbs();
      if (!seatsOf(sp).length) return;
      try { await loadXterm(); } catch (e) { st.err = String(e.message || e); return drawFoot(); }
      if (st.space !== sp.id || st.built !== sp.id) return;
      if (typeof IntersectionObserver !== "undefined") st.io = new IntersectionObserver((es) => es.forEach((e) => { const c = st.ioMap.get(e.target); if (c) onView(c, e.isIntersecting); }), { threshold: 0.1 });
      for (const s of seatsOf(sp)) grid.appendChild(makeCard(s).el);
      applyEnlarge(grid);
      reconcile();
    }
    function drawAll() {
      st.status = ""; st.statusErr = false;
      drawHead(); drawSide(); drawFoot();
      return drawMain();
    }

    // Resolve the deep link / default space on the first payload, then redraw only what changed.
    function applySeats(data) {
      const first = !st.data;
      st.data = data; st.err = "";
      const sps = spaces();
      if (first) {
        if (!st.space && st.seat) { const hit = sps.find((sp) => findSeat(sp, st.seat)); st.space = hit ? hit.id : ""; }
        if (!sps.some((sp) => sp.id === st.space)) { st.space = (sps.find((sp) => sp.kind === "colony" && seatsOf(sp).length) || sps[0] || {}).id || ""; st.seat = ""; }
        const hit = enlargedSeat(); st.seat = hit ? hit.address : "";
      }
      const key = seatsKey(data);
      if (!first && key === st.key) {
        for (const sp of sps) if (sp.id === st.space) for (const s of seatsOf(sp)) { const c = st.cards.get(s.address); if (c) { c.seat = s; drawFooter(c); if (c.paused && !c.pty) capture(c); } }
        return drawFoot();
      }
      st.key = key;
      if (!sps.some((sp) => sp.id === st.space)) { st.space = (sps[0] || {}).id || ""; st.seat = ""; }
      drawHead(); drawSide(); drawFoot();
      const sp = space();
      const same = sp && st.built === sp.id && [...st.cards.keys()].join() === seatsOf(sp).map((s) => s.address).join();
      if (same) { for (const s of seatsOf(sp)) { const c = st.cards.get(s.address); c.seat = s; drawFooter(c); } return; }
      return drawMain();
    }
    async function refresh() {
      try {
        applySeats(await ctx.api.get("term/seats", seatParams()));
        clearFetchFail("term/seats");
      } catch (e) {
        reportFetchFail("terminal", "term/seats", e);
        st.err = "seats unavailable: " + String((e && (e.error || e.message)) || e);
        drawFoot();
      }
    }

    S.keyHandler = (ev) => {
      if (ev.key !== "Escape" || !st.seat) return;
      const inTerm = ev.target && ev.target.closest && ev.target.closest(".xterm");
      if (inTerm && !ev.shiftKey) return; // plain Esc belongs to the program while the terminal has focus
      ev.preventDefault && ev.preventDefault();
      enlarge("");
    };
    document.addEventListener("keydown", S.keyHandler);

    drawAll();
    refresh();
    S.snapTimer = setInterval(refresh, SEATS_MS);
    S.disposers.push(disposeCards);
    return root;
  },
  destroy() {
    S.timers.forEach(clearInterval);
    S.timers = [];
    clearInterval(S.snapTimer);
    S.disposers.forEach((d) => { try { d(); } catch (_e) { /* best effort */ } });
    S.disposers = [];
    if (S.keyHandler) document.removeEventListener("keydown", S.keyHandler);
    S.keyHandler = null;
  },
};
