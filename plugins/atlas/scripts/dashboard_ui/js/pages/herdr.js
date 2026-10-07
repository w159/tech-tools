// Colony (#/colony[?pane=<id>]): the full herdr web UI (?chrome=full) filling the canvas edge to edge, nothing around it.
// The host is a separate origin: states here come from the agents store layers, never from reading the frame.

import { h, replace } from "../dom.js";
import { agentsStore } from "../agents-store.js";
import { consoleUrl } from "../fleet.js";
import { State, DegradedState, toast, toastError } from "../components.js";

const SLOW_MS = 12000;
const S = { unsub: null, timer: null };

// The pane the frame itself last reported (herdr:selected-pane). The frame already shows it, so it never rebuilds the frame;
// only a pane arriving from outside (deep link, "Open in Colony", route change) navigates it.
let reported = "";
export const noteFramePane = (pane) => { reported = pane; };

// The dashboard itself framed (by the herdr app or anything else) must never frame herdr again.
export const isFramed = () => window.self !== window.top;

// Fills `body` with the console iframe, or the layer-appropriate recovery card. draw() is idempotent: the iframe is only
// created when the target URL changes, so store ticks and SSE events never reload it.
export function mountConsoleFrame(ctx, body) {
  let url = "";
  let frame = null;
  let built = ""; // the pane the current frame was built with
  const recover = (node) => { url = ""; frame = null; built = ""; return replace(body, node); };

  function draw() {
    const st = agentsStore.getState();
    if (!st.loaded) return replace(body, State({ variant: "loading", label: "colony", shape: "rows" }));
    if (isFramed()) return recover(State({ variant: "empty", title: "Colony cannot open inside itself", body: "This dashboard is already shown inside the herdr app. Use the herdr app's own panes.", inline: true }));
    if (st.down === "herdr") return recover(DegradedState({ layer: "herdr", reason: st.layers.herdr.reason, onRecheck: () => agentsStore.recheck() }));
    if (st.layers.webui.state === "down" || !st.layers.webui.url) {
      return recover(DegradedState({
        layer: "webui",
        onRecheck: () => agentsStore.recheck(),
        onStart: async () => {
          try {
            await ctx.api.post("herd/ensure", {});
            toast("Terminal service started", { kind: "ok" });
          } catch (e) {
            toastError(e, "Could not start the terminal service");
          }
          await agentsStore.recheck();
        },
      }));
    }
    const pane = ctx.params.pane || "";
    const alive = frame && frame.isConnected;
    // The pane the frame was built with, or the one it reported itself, is already on screen: keep the node.
    const shown = pane === built || pane === reported ? built : pane;
    const next = consoleUrl(st.layers.webui.url, shown);
    if (next === url && alive) return;
    url = next;
    built = shown;
    reported = "";
    clearTimeout(S.timer);
    const veil = h("div", { class: "console-veil" }, State({ variant: "loading", label: "colony", shape: "rows" }));
    frame = h("iframe", { class: "console-frame", src: next, title: "Colony", sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads", allow: "clipboard-read; clipboard-write; microphone; fullscreen", referrerpolicy: "no-referrer" });
    frame.addEventListener("load", () => { clearTimeout(S.timer); veil.remove(); });
    S.timer = setTimeout(() => {
      if (!veil.isConnected) return;
      replace(veil, State({ variant: "error", title: "Colony is slow to load", error: { why: "The terminal service answered the health check but the page has not finished loading.", do: "Wait a moment, then recheck." }, onRetry: () => { url = ""; draw(); } }));
    }, SLOW_MS);
    replace(body, frame, veil);
  }
  return draw;
}

export default {
  id: "colony",
  title: "Colony",
  icon: "herd",
  group: "Operate",
  async load() {
    this.destroy();
    return null;
  },
  render(ctx) {
    const mount = h("div", { class: "page colony-page" });
    const draw = mountConsoleFrame(ctx, mount);
    let last = -1;
    S.unsub = agentsStore.subscribe((st) => {
      if (st.generation === last) return;
      last = st.generation;
      draw();
    });
    draw();
    return mount;
  },
  destroy() {
    clearTimeout(S.timer);
    if (S.unsub) S.unsub();
    S.unsub = null;
  },
};
