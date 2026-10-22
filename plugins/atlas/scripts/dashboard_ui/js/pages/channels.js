// Channels (#/channels): the channel lens as a top-level full page (messages, per-member board, composer).

import { h } from "../dom.js";
import { agentsStore } from "../agents-store.js";
import { mountChannelLens } from "./channel-lens.js";
import { startChannelSync } from "../channel-sync.js";

const S = { lens: null, unsub: null, stopSync: null };

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
    // The SSE `irc` event re-fetches (delivery receipts, member state); a 30 s poll runs only while SSE is down. Skip while a dropdown is open so the composer keeps its draft.
    if (S.stopSync) S.stopSync();
    S.stopSync = startChannelSync({ store: agentsStore, refresh: () => S.lens && S.lens.refresh(), skip: () => { const a = document.activeElement; return Boolean(a && a.tagName === "SELECT"); } });
    return mount;
  },
  destroy() {
    if (S.lens) S.lens.destroy();
    if (S.unsub) S.unsub();
    if (S.stopSync) S.stopSync();
    S.lens = null;
    S.unsub = null;
    S.stopSync = null;
  },
};
