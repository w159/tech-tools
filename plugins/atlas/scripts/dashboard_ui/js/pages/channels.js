// Channels (#/channels): the channel lens as a top-level full page (messages, per-member board, composer).

import { h } from "../dom.js";
import { agentsStore } from "../agents-store.js";
import { mountChannelLens } from "./channel-lens.js";

const S = { lens: null, unsub: null };

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
    return mount;
  },
  destroy() {
    if (S.lens) S.lens.destroy();
    if (S.unsub) S.unsub();
    S.lens = null;
    S.unsub = null;
  },
};
