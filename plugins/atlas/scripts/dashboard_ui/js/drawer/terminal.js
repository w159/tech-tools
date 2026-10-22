// Drawer Terminal tab: a live terminal over the websocket bridge, or a read-only peek.
// render(ctx, row) draws into ctx.root and returns a cleanup function.
// ctx: {root, onExpand?, full?}. xterm is vendored and loaded on first use.
import { h, replace } from "../dom.js";
import { Button, StateDot } from "../ui.js";
import { BASE, get, post, describeError } from "../api.js";
import { terminalPlan } from "../pages/agents-model.js";

const VENDOR = `${BASE}/ui/vendor/xterm/`;
const TERM_FONT_PX = 12;
const RECONNECT_DELAY_MS = 1000;

function addAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.onload = resolve;
    el.onerror = () =>
      reject(new Error(`could not load ${attrs.src || attrs.href}`));
    document.head.append(el);
  });
}

// UMD bundles set window.Terminal and window.FitAddon.
let xtermReady = null;
function loadXterm() {
  if (window.Terminal && window.FitAddon) return Promise.resolve();
  xtermReady ??= Promise.all([
    addAsset("script", { src: `${VENDOR}xterm.js` }),
    addAsset("script", { src: `${VENDOR}addon-fit.js` }),
  ]).catch((e) => {
    xtermReady = null;
    throw e;
  });
  return xtermReady;
}

/** xterm wants concrete colours; read them from the design tokens so both themes work. */
function termTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    background: v("--canvas"),
    foreground: v("--text"),
    cursor: v("--brand"),
    selectionBackground: `color-mix(in srgb, ${v("--brand")} 18%, transparent)`,
  };
}

function wsUrl(ticket) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${BASE}/api/v2/term/ws?ticket=${encodeURIComponent(ticket)}`;
}

function peekView(ctx, plan) {
  const out = h("pre", { class: "peek mono" }, "Loading...");
  const note = h("p", { class: "meta" });
  let disposed = false;
  const load = async () => {
    if (!plan.id) {
      out.hidden = true;
      note.textContent =
        plan.hint || "This agent has no live terminal to show.";
      return;
    }
    try {
      const res = await get(
        `/api/v2/agents/${encodeURIComponent(plan.id)}/peek`,
        { lines: 40 },
      );
      if (disposed) return;
      out.textContent = (res.lines || []).join("\n") || "(no output yet)";
      note.textContent =
        plan.hint || "Read-only view of the last lines. Secrets are masked.";
    } catch (e) {
      if (disposed) return;
      out.textContent = "";
      note.textContent = [describeError(e).message, plan.hint]
        .filter(Boolean)
        .join(". ");
    }
  };
  replace(
    ctx.root,
    h(
      "div",
      { class: "term-wrap" },
      h(
        "div",
        { class: "term-bar" },
        note,
        Button({ size: "sm", onClick: load }, "Refresh"),
      ),
      out,
    ),
  );
  load();
  return () => {
    disposed = true;
  };
}

function streamView(ctx, plan) {
  const status = h("span", { class: "term-status" });
  const setStatus = (raw, word) => replace(status, StateDot(raw, { word }));
  const pane = h("div", { class: "term-pane" });
  const reconnectBtn = Button({ size: "sm", hidden: true }, "Reconnect");
  const bar = h("div", { class: "term-bar" }, status, reconnectBtn);
  if (ctx.onExpand)
    bar.append(
      Button({ size: "sm", icon: "external", onClick: ctx.onExpand }, "Expand"),
    );
  replace(ctx.root, h("div", { class: "term-wrap" }, bar, pane));

  let disposed = false;
  let retried = false;
  let ws = null;
  let term = null;
  let fit = null;
  let observer = null;
  let timer = null;
  const send = (obj) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  async function connect() {
    reconnectBtn.hidden = true;
    setStatus("working", retried ? "Reconnecting" : "Connecting");
    let ticket;
    try {
      const res = await post("/api/v2/term/ticket", {
        ...plan.ticket,
        cols: term.cols,
        rows: term.rows,
      });
      ticket = res.ticket;
    } catch (e) {
      if (disposed) return;
      const d = describeError(e);
      setStatus("fail", `Closed: ${d.message}`);
      reconnectBtn.hidden = false;
      return;
    }
    if (disposed) return;
    ws = new WebSocket(wsUrl(ticket));
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      setStatus("done", "Connected");
      send({ t: "resize", cols: term.cols, rows: term.rows });
    };
    ws.onmessage = (ev) =>
      term.write(
        typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data),
      );
    ws.onclose = (ev) => {
      if (disposed) return;
      if (!retried) {
        retried = true;
        setStatus("working", "Reconnecting");
        timer = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      setStatus("fail", `Closed: ${ev.reason || `code ${ev.code}`}`);
      reconnectBtn.hidden = false;
    };
    ws.onerror = () => {}; // onclose follows and carries the outcome
  }

  reconnectBtn.addEventListener("click", () => {
    retried = false;
    connect();
  });

  loadXterm().then(
    () => {
      if (disposed) return;
      term = new window.Terminal({
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue(
          "--mono",
        ),
        fontSize: TERM_FONT_PX,
        theme: termTheme(),
        cursorBlink: true,
        convertEol: false,
      });
      fit = new window.FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open(pane);
      const refit = () => {
        try {
          fit.fit();
        } catch (e) {
          // Not laid out yet (hidden or zero size); the observer fires again once it has size.
          console.debug("terminal fit skipped", e);
        }
      };
      refit();
      observer = new ResizeObserver(refit);
      observer.observe(pane);
      term.onData((d) => send({ t: "in", d }));
      term.onBinary((d) => send({ t: "bin", d }));
      term.onResize(({ cols, rows }) => send({ t: "resize", cols, rows }));
      connect();
    },
    (e) => setStatus("fail", `Closed: ${e.message}`),
  );

  return () => {
    disposed = true;
    clearTimeout(timer);
    if (observer) observer.disconnect();
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    if (term) term.dispose();
  };
}

export function render(ctx, row) {
  const plan = terminalPlan(row);
  return plan.mode === "stream" ? streamView(ctx, plan) : peekView(ctx, plan);
}
