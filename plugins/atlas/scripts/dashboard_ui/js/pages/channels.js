// Channels (#/channels): the channel lens as a top-level full page (messages, per-member board, composer).

import { h } from "../dom.js";
import { agentsStore } from "../agents-store.js";
import { mountChannelLens } from "./channel-lens.js";

const S = { lens: null, unsub: null, timer: null };

export default {
  id: "channels",
  title: "Channels",
  icon: "irc",
  group: "Operate",
  async load() {
    this.destroy();
    return null;
  },
  render(ctx) {
    const mount = h("div", { class: "page agents-page is-chan" });
    const body = h("div", { class: "agents-body" });
    mount.appendChild(body);
    S.lens = mountChannelLens(ctx, body);
    let last = -1;
    S.unsub = agentsStore.subscribe((st) => {
      if (st.generation === last) return;
      last = st.generation;
      if (S.lens) S.lens.repaint();
    });
    // Delivery receipts and member state change on the server: re-fetch while the page is visible (not while a dropdown is open; the composer keeps its draft).
    clearInterval(S.timer);
    S.timer = setInterval(() => {
      const a = document.activeElement;
      if (S.lens && !document.hidden && !(a && a.tagName === "SELECT")) S.lens.refresh();
    }, 5000);
    return mount;
  },
  destroy() {
    if (S.lens) S.lens.destroy();
    if (S.unsub) S.unsub();
    clearInterval(S.timer);
    S.lens = null;
    S.unsub = null;
    S.timer = null;
  },
};
