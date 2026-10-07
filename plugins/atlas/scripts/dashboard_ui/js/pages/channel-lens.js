// Channel lens: one column. Header (channel name, a select only when there is more than one channel, one dim info line,
// one row of member chips), the message log (last 100, the only scroller) and a composer (To, one textarea, Send).
// To = Everyone posts to the channel; To = a member prompts that agent when its pane is idle, else posts addressed to it.
// Data: GET /api/v2/channels, GET /api/v2/channels/<name>?limit=, POST /api/v2/channels. Mounted by agents.js.

import { h, replace, icon } from "../dom.js";
import { agentsStore } from "../agents-store.js";
import { chanInfo, presenceWord } from "../chan-names.js";
import { Button, State, ChannelList, Composer, HexGlyph, toast } from "../components.js";

const LIMIT = 100;

function memberState(m, rec) {
  return rec ? rec.state : m.state === "blocked" ? "input" : ["working", "idle", "done"].includes(m.state) ? m.state : "unknown";
}

export function mountChannelLens(ctx, body) {
  const S = { data: null, error: null, active: ctx.params.channel || null, detail: null, to: "all", dead: false, busy: false };
  const head = h("header", { class: "chan-head" });
  const log = h("div", { class: "chan-log" });
  const composerHost = h("div", { class: "chan-composer" });
  const layout = h("section", { class: "chan-page" }, head, log, composerHost);
  let list = null;
  let composerKey = "";
  let comp = null;
  const chans = () => (S.data && S.data.channels) || [];
  const metaNow = () => chans().find((c) => c.name === S.active);
  const recOf = (m) => agentsStore.getState().agents.find((a) => a.name === m.name || (m.pane_id && a.key === m.pane_id));

  async function loadChannels() {
    try {
      S.data = await ctx.api.get("channels", { project: ctx.project });
      S.error = null;
    } catch (e) {
      S.error = e;
    }
  }
  async function loadDetail() {
    if (!S.active) return;
    const name = S.active;
    try {
      const d = await ctx.api.get("channels/" + encodeURIComponent(name), { limit: LIMIT, project: ctx.project === "all" ? undefined : ctx.project });
      if (name === S.active) S.detail = d;
    } catch (e) {
      if (name === S.active) S.detail = { channel: { name }, messages: [], error: e };
    }
  }

  function pickProject() {
    const projects = ctx.store.get("projects") || [];
    return State({
      variant: "empty",
      title: "No channels in these projects yet",
      body: "Every project has one main channel named folder@branch. Choose a project to open it; lead agents add their subchannels when they dispatch subagents.",
      action: projects.length ? h("div", { class: "row", style: { flexWrap: "wrap" } }, projects.slice(0, 8).map((p) => Button({ label: p.name || p.root, onClick: () => ctx.setProject(p.root, true) }))) : null,
    });
  }

  function select(name) {
    S.active = name;
    S.detail = null;
    S.to = "all";
    list = null;
    composerKey = "";
    paint();
    refresh();
  }

  function pickTo(name) {
    S.to = S.to === name ? "all" : name;
    paintHead();
    paintComposer();
  }

  function chips(meta) {
    const mem = meta.members || [];
    if (!mem.length) return h("p", { class: "dim chan-empty" }, "No members yet. Subagents join when a lead dispatches them.");
    return h("ul", { class: "chan-chips", "aria-label": "Members" }, mem.map((m) => {
      const rec = recOf(m);
      const state = memberState(m, rec);
      const on = S.to === m.name;
      return h("li", { class: "chan-chip", "data-state": state, "data-on": on ? "true" : null },
        h("button", { class: "chan-chip-main", type: "button", "aria-pressed": on ? "true" : "false", title: m.name + ", " + presenceWord(state) + (on ? ". Click to message everyone instead." : ". Click to message it."), onClick: () => pickTo(m.name) },
          HexGlyph(state, { size: "mini" }), h("span", { class: "truncate" }, m.name)),
        rec ? h("button", { class: "chan-chip-open", type: "button", "aria-label": "Open " + m.name, title: "Open " + m.name, onClick: () => ctx.openAgent(rec) }, icon("external-link")) : null);
    }));
  }

  function paintHead() {
    const all = chans();
    const meta = metaNow();
    if (!meta) return;
    const info = chanInfo(meta);
    const line = [info.sub ? "subchannel" : "main", meta.lead ? "lead " + meta.lead : "", info.branch].filter(Boolean).join(" \u00B7 ");
    const picker = all.length > 1
      ? h("select", { class: "select chan-pick", "aria-label": "Channel", onChange: (e) => select(e.target.value) }, all.map((c) => h("option", { value: c.name, selected: c.name === S.active }, (c.parent ? "\u00A0\u00A0" : "") + c.name)))
      : null;
    replace(head, h("div", { class: "chan-title" }, h("h2", { class: ["truncate", picker ? "sr-only" : ""], title: meta.name }, meta.name), picker, h("span", { class: "dim chan-line truncate", title: line }, line)), chips(meta));
  }

  function paintComposer() {
    const meta = metaNow();
    if (!meta) return;
    const names = (meta.members || []).map((m) => m.name);
    if (S.to !== "all" && !names.includes(S.to)) S.to = "all";
    const key = meta.name + "|" + names.join(",");
    if (key !== composerKey) {
      composerKey = key;
      const sel = h("select", { class: "select chan-to", "aria-label": "To", onChange: (e) => { S.to = e.target.value; paintHead(); paintComposer(); } }, h("option", { value: "all" }, "Everyone"), names.map((n) => h("option", { value: n }, n)));
      comp = Composer({
        simple: true,
        lead: sel,
        onSend: async (_mode, text) => {
          const m = (meta.members || []).find((x) => x.name === S.to);
          const rec = m && recOf(m);
          if (rec && rec.state === "idle" && rec.pane_id) {
            await ctx.api.post("herd/agents/" + encodeURIComponent(rec.pane_id) + "/prompt", { text });
            toast("Prompt sent to " + rec.name, { kind: "ok" });
          } else {
            await ctx.api.post("channels", { channel: meta.name, to: S.to, body: text, from: "human" });
            toast("Posted to " + (S.to === "all" ? meta.name : S.to), { kind: "ok" });
          }
          await loadDetail();
          paintLog();
        },
      });
      replace(composerHost, comp);
    }
    // To changes (chip click or select) only retarget the existing composer, so a typed draft survives.
    comp.querySelector(".chan-to").value = S.to;
    comp.querySelector("textarea").placeholder = S.to === "all" ? "Message everyone" : "Prompt " + S.to;
  }

  function paintLog() {
    const d = S.detail;
    if (d && d.error) return replace(log, State({ variant: "error", error: d.error, inline: true, onRetry: refresh }));
    const msgs = ((d && d.messages) || []).slice(-LIMIT);
    if (!list) list = ChannelList({ messages: msgs, empty: "No messages in this channel yet.", onPane: (id) => ctx.openAgent(id), plain: true });
    else list.update(msgs);
    if (list.parentNode !== log) replace(log, list);
  }

  function paint() {
    if (S.dead) return;
    if (S.error) return replace(body, State({ variant: "error", error: S.error, onRetry: refresh }));
    if (!S.data) return replace(body, State({ variant: "loading", label: "channels", shape: "rows" }));
    const all = chans();
    if (!all.length) return replace(body, pickProject());
    if (!S.active || !all.some((c) => c.name === S.active)) {
      S.active = (all.find((c) => !c.parent) || all[0]).name;
      S.detail = null;
    }
    if (layout.parentNode !== body) replace(body, layout);
    paintHead();
    paintComposer();
    paintLog();
  }

  async function refresh() {
    if (S.dead || S.busy) return;
    S.busy = true;
    try {
      await loadChannels();
      const all = chans();
      if (!S.error && all.length) {
        if (!S.active || !all.some((c) => c.name === S.active)) S.active = (all.find((c) => !c.parent) || all[0]).name;
        await loadDetail();
      }
    } finally {
      S.busy = false;
    }
    paint();
  }

  paint();
  refresh();
  return {
    refresh,
    repaint: () => { if (S.data) paint(); },
    destroy: () => { S.dead = true; },
  };
}
