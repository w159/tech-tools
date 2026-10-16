// Atlas Colony (#/terminal[?space=<colony>&seat=<name>]): terminal workspace over the colony's real tmux panes.
// Spaces: "Atlas Command Center" (live atlas_tui.py over ws kind=tui) and one per colony (grid of live pane captures;
// enlarge = interactive ws kind=pane). Data: GET term/snapshot, GET term/capture, ws /api/v2/term/ws (see colony contract §3).

import { h, replace } from "../dom.js";

export const CC = "command-center";
const SNAP_MS = 3000;
const CAPTURE_MS = 1500;
const RUNTIMES = { claude: "Claude Code", omp: "omp", codex: "Codex CLI" };
const START_HINT = "atlas_team (omp) or  python3 scripts/atlas_mux.py spawn-team";
const XTERM_OPTS = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, scrollback: 2000, theme: { background: "#0a0f12", foreground: "#e6edf0", cursor: "#2fbd9f" } };

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
    await addAsset("link", { rel: "stylesheet", href: v + "xterm.css" });
    await addAsset("script", { src: v + "xterm.js" });
    await addAsset("script", { src: v + "addon-fit.js" });
  })().catch((e) => { xtermReady = null; throw e; });
  return xtermReady;
}

function makeTerm(el, extra) {
  const term = new window.Terminal({ ...XTERM_OPTS, ...extra });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  const doFit = () => { try { fit.fit(); } catch (_e) { /* not laid out yet */ } };
  doFit();
  return { term, fit: doFit };
}

// PTY over WebSocket with reconnect: binary frames in, {t:"in"|"resize"} JSON out. onStatus("live"|"connecting"|"closed", text).
export function connectPty({ term, kind, target, project, onStatus }) {
  let ws = null;
  let closed = false;
  let attempt = 0;
  let retry = null;
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const url = () => {
    const q = new URLSearchParams({ kind, token: tokenOf(), cols: String(term.cols || 80), rows: String(term.rows || 24) });
    if (target) q.set("target", target);
    if (project) q.set("project", project);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + base() + "/api/v2/term/ws?" + q;
  };
  const open = () => {
    onStatus("connecting", attempt ? "reconnecting…" : "connecting…");
    ws = new WebSocket(url());
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { attempt = 0; onStatus("live", "live"); send({ t: "resize", cols: term.cols, rows: term.rows }); };
    ws.onmessage = (ev) => term.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
    ws.onclose = () => {
      if (closed) return;
      const wait = Math.min(1000 * 2 ** attempt++, 10000);
      onStatus("closed", "disconnected, retrying in " + Math.round(wait / 1000) + "s");
      retry = setTimeout(open, wait);
    };
    ws.onerror = () => {};
  };
  const subs = [term.onData((d) => send({ t: "in", d })), term.onResize(({ cols, rows }) => send({ t: "resize", cols, rows }))];
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

const runtimeLabel = (r) => RUNTIMES[r] || "agent";
const ended = (s) => s.state === "finished" || s.state === "dead";
const endedLabel = (s) => (ended(s) ? "finished" + (s.exit_code != null ? ", exit " + s.exit_code : "") : "");
const stateChip = (s) => h("span", { class: "tw-chip", "data-state": s.state || "unknown" }, ended(s) ? s.state + (s.exit_code != null ? ", exit " + s.exit_code : "") : s.state || "unknown");
const snapKey = (snap) => JSON.stringify([((snap && snap.colonies) || []).map((c) => c.id), ((snap && snap.seats) || []).map((s) => s.name + s.target + s.state)]);

function emptyColonies() {
  return h("div", { class: "tw-empty" },
    h("strong", {}, "No colonies yet"),
    h("p", {}, "Start one from your agent, then it appears here with its live panes:"),
    h("code", {}, START_HINT));
}

export default {
  id: "terminal",
  title: "Atlas Colony",
  icon: "herd",
  group: "Operate",
  async load() {
    this.destroy();
    return null;
  },
  render(ctx) {
    const st = { snap: null, space: ctx.params.space || (ctx.params.seat ? "" : CC), seat: ctx.params.seat || "", err: "", cards: new Map(), big: null, cc: null, ptyStatus: "" };
    const header = h("div", { class: "tw-head" });
    const side = h("nav", { class: "tw-side", "aria-label": "Atlas Colony spaces" });
    const main = h("div", { class: "tw-main" });
    const foot = h("div", { class: "tw-foot" });
    const root = h("div", { class: "page terminal-page tw" }, header, h("div", { class: "tw-body" }, side, main), foot);

    const project = () => ctx.params.project || ctx.project;
    const colonies = () => (st.snap && st.snap.colonies) || [];
    const colony = () => colonies().find((c) => c.id === st.space) || null;
    const seatsOf = (c) => ((st.snap && st.snap.seats) || []).filter((s) => s.colony === c.id);
    const clearTimers = () => { S.timers.forEach(clearInterval); S.timers = []; };
    const disposeSurface = () => {
      clearTimers();
      S.disposers.forEach((d) => { try { d(); } catch (_e) { /* best effort */ } });
      S.disposers = [];
      st.cards = new Map(); st.big = null; st.cc = null;
    };
    const setStatus = (_k, text) => { st.ptyStatus = text; drawFoot(); };
    const attachPty = (el, kind, extra) => {
      const { term, fit } = makeTerm(el, { cursorBlink: true });
      const pty = connectPty({ term, kind, project: project(), onStatus: setStatus, ...extra });
      window.addEventListener("resize", fit);
      S.disposers.push(() => { pty.dispose(); term.dispose(); window.removeEventListener("resize", fit); });
      term.focus();
      return term;
    };
    const sync = () => { if (ctx.setParams) ctx.setParams({ space: st.space === CC ? "" : st.space, seat: st.seat }); };

    function go(space, seat = "") {
      if (space === st.space && seat === st.seat && main.children.length) return;
      st.space = space; st.seat = seat;
      sync();
      drawAll();
    }

    function drawHead() {
      replace(header, h("h1", {}, (st.snap && st.snap.host ? st.snap.host + " · " : "") + "Atlas Colony"), h("span", { class: "tw-sub" }, "terminal workspace"));
    }

    function drawSide() {
      const spaces = [{ id: CC, label: "Atlas Command Center" }, ...colonies().map((c) => ({ id: c.id, label: c.id, title: c.label }))];
      const items = spaces.map((s) => h("button", { class: "tw-space", type: "button", "aria-current": s.id === st.space ? "page" : null, title: s.title || s.label, onClick: () => go(s.id) }, s.label));
      const parts = [h("div", { class: "tw-side-label" }, "Atlas Colony"), ...items];
      const c = colony();
      if (c) {
        const seats = seatsOf(c);
        parts.push(h("div", { class: "tw-side-label" }, "Agents · " + seats.length));
        for (const s of seats) {
          parts.push(h("button", { class: "tw-agent", type: "button", "aria-current": s.name === st.seat ? "true" : null, onClick: () => go(c.id, s.name) },
            h("span", { class: "tw-dot", "data-state": s.state || "unknown" }), h("span", { class: "tw-agent-name" }, s.name), h("span", { class: "tw-agent-role" }, s.role || "")));
        }
      }
      if (st.snap && !colonies().length) parts.push(emptyColonies());
      replace(side, ...parts);
    }

    function drawFoot() {
      const c = colony();
      const left = st.space === CC ? "Atlas Command Center · live" : c ? seatsOf(c).length + " agents in " + c.id + " · live tmux panes" : "";
      replace(foot, h("span", {}, left), st.ptyStatus ? h("span", { class: "tw-status", role: "status" }, st.ptyStatus) : null, st.err ? h("span", { class: "tw-status tw-err", role: "status" }, st.err) : null, h("span", { class: "tw-clock" }, (st.snap && st.snap.clock) || ""));
    }

    async function drawCommandCenter() {
      const el = h("div", { class: "tw-term tw-term-cc" });
      replace(main, el);
      try { await loadXterm(); } catch (e) { st.err = String(e.message || e); return drawFoot(); }
      if (!el.isConnected || st.space !== CC) return;
      st.cc = attachPty(el, "tui");
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
      } catch (_e) { /* the next tick retries; the snapshot poll reports server loss */ }
    }
    const pollCaptures = (c) => Promise.all(seatsOf(c).map((s) => pollOne(s)));

    function addCard(c, s, grid) {
      const body = h("div", { class: "tw-card-body" });
      const live = Boolean(s.target);
      const card = h("article", { class: "tw-card", "data-state": s.state || "unknown" },
        h("header", { class: "tw-card-head" }, h("span", { class: "tw-badge", "data-rt": s.runtime || "unknown" }, runtimeLabel(s.runtime)), h("span", { class: "tw-card-name" }, s.name), stateChip(s),
          h("button", { class: "tw-open", type: "button", title: live ? "Enlarge" : "No terminal pane", "aria-label": "Enlarge " + s.name, disabled: !live, onClick: () => go(c.id, s.name) }, "↗")),
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
      const crumbs = h("div", { class: "tw-crumbs" }, h("strong", {}, c.id + " / All agents"), h("span", { class: "tw-task" }, c.task || ""));
      replace(main, crumbs, seats.length ? grid : h("div", { class: "tw-empty" }, h("strong", {}, "No agents in this colony yet")));
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
      replace(main, h("div", { class: "tw-crumbs" }, back, h("strong", {}, s.name), h("span", { class: "tw-badge", "data-rt": s.runtime || "unknown" }, runtimeLabel(s.runtime)), stateChip(s), h("span", { class: "tw-task" }, "Esc outside the terminal or Shift+Esc to go back")), el);
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
        if (!st.snap) return replace(main, h("div", { class: "tw-empty" }, "Loading colonies…"));
        st.space = CC; st.seat = ""; // unknown colony: fall back to the default space
      }
      if (st.space === CC) return drawCommandCenter();
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
        applySnap(await ctx.api.get("term/snapshot", { project: project(), all: ctx.params.all ? "1" : "" }));
      } catch (e) {
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
    if (S.keyHandler) document.removeEventListener("keydown", S.keyHandler);
    S.keyHandler = null;
  },
};
