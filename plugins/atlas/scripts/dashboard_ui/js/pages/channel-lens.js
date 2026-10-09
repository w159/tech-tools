// Channel lens: one column. Header (channel name, a select only when there is more than one channel, one dim info line,
// one row of member chips, Messages/Board tabs), the message log or the per-member board (the only scroller) and a composer
// (To, one textarea, Send). To = Everyone posts to the channel; To = a member prompts that agent when its pane is idle,
// else posts addressed to it. Board = GET /api/v2/channels/<name> board.owners joined to members (chan-names memberBoard).
// Data: GET /api/v2/channels, GET /api/v2/channels/<name>?limit=, POST /api/v2/channels. Mounted by pages/channels.js (#/channels).

import { h, replace, icon, fmtRelative } from "../dom.js";
import { agentsStore } from "../agents-store.js";
import { chanInfo, presenceWord, memberState, memberBoard, todoSummary } from "../chan-names.js";
import { Button, State, ChannelList, Composer, HexGlyph, toast } from "../components.js";

const LIMIT = 100;
const ITEM_MAX = 8;
const ITEM_WORD = { open: "open", in_progress: "active", blocked: "blocked", done: "done" };

// The live agent record for a channel member (by name, else pane id).
export const recOfMember = (m) => agentsStore.getState().agents.find((a) => a.name === m.name || (m.pane_id && a.key === m.pane_id));

// MemberBoard({ rows, to, onTo(name), onOpen(rec), nested }) -> ul of one row per member: role, presence, todo counts, the
// in-progress item, every item, the last note with its age. nested indents non-lead rows under the lead (supervision tree).
export function MemberBoard({ rows, to, onTo, onOpen, nested } = {}) {
  if (!rows.length) return h("p", { class: "dim chan-empty" }, "No members yet. Subagents join when a lead dispatches them.");
  return h("ul", { class: "mb-list", "aria-label": "Member boards" }, rows.map((r) => {
    const rec = recOfMember(r);
    const state = memberState(r, rec);
    const on = to === r.name;
    const shown = r.items.slice(0, ITEM_MAX);
    return h("li", { class: "mb-row", "data-role": r.role, "data-state": state, "data-nested": nested && r.role !== "lead" ? "true" : null, "data-on": on ? "true" : null },
      h("div", { class: "mb-top" },
        HexGlyph(state === "parked" ? "idle" : state, { size: "mini" }),
        h("strong", { class: "mb-name truncate", title: r.name }, r.name),
        h("span", { class: "chip-lite" }, r.role),
        h("span", { class: "dim mb-presence" }, presenceWord(state)),
        h("span", { class: "dim mb-counts", title: "Todos" }, todoSummary(r.counts)),
        h("span", { class: "grow" }),
        onTo ? Button({ label: on ? "Clear" : "Message", size: "sm", ariaLabel: (on ? "Stop messaging " : "Message ") + r.name, onClick: () => onTo(r.name) }) : null,
        rec && onOpen ? Button({ label: "Open", size: "sm", ariaLabel: "Open " + r.name, onClick: () => onOpen(rec) }) : null),
      h("div", { class: "mb-now" }, h("span", { class: "agent-now-label" }, "Now"), h("span", { class: r.current ? "" : "dim" }, r.current || "No item in progress")),
      shown.length ? h("ul", { class: "mb-items", "aria-label": r.name + " todos" }, shown.map((i) => h("li", { "data-status": i.status }, h("span", { class: "mb-item-st" }, ITEM_WORD[i.status] || i.status), h("span", { class: "truncate", title: i.content }, i.content))), r.items.length > shown.length ? h("li", { class: "dim" }, "+" + (r.items.length - shown.length) + " more") : null) : null,
      r.note ? h("div", { class: "mb-note", title: r.note.text }, h("span", { class: "agent-now-label" }, "Note"), h("span", { class: "truncate" }, r.note.text), r.note.ts ? h("span", { class: "dim num" }, fmtRelative(r.note.ts * 1000)) : null) : h("div", { class: "mb-note dim" }, "No notes yet"));
  }));
}

export function mountChannelLens(ctx, body) {
  const S = { data: null, error: null, active: ctx.params.channel || null, detail: null, to: "all", dead: false, busy: false, tab: ctx.params.tab === "board" ? "board" : "messages" };
  const tabs = h("div", { class: "seg chan-tabs", role: "radiogroup", "aria-label": "Channel view" });
  const head = h("header", { class: "chan-head" });
  const log = h("div", { class: "chan-log" });
  const composerHost = h("div", { class: "chan-composer" });
  const layout = h("section", { class: "chan-page" }, head, tabs, log, composerHost);
  let list = null;
  let composerKey = "";
  let comp = null;
  const chans = () => (S.data && S.data.channels) || [];
  const metaNow = () => chans().find((c) => c.name === S.active);
  const defaultChan = () => { const all = chans(); return all.find((c) => c.name === S.data.current) || all.find((c) => !c.parent) || all[0]; };
  const recOf = recOfMember;

  async function loadChannels() {
    try {
      S.data = await ctx.api.get("channels", { project: ctx.params.project || ctx.project });
      S.error = null;
    } catch (e) {
      S.error = e;
    }
  }
  async function loadDetail() {
    if (!S.active) return;
    const name = S.active;
    try {
      const proj = ctx.params.project || ctx.project;
      const d = await ctx.api.get("channels/" + encodeURIComponent(name), { limit: LIMIT, project: proj === "all" ? undefined : proj });
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
    paintLog();
    paintComposer();
  }

  function chips(meta) {
    const mem = meta.members || [];
    if (!mem.length) return h("p", { class: "dim chan-empty" }, "No members yet. Subagents join when a lead dispatches them.");
    return h("ul", { class: "chan-chips", "aria-label": "Members" }, mem.map((m) => {
      const rec = recOf(m);
      const state = m.parked ? "parked" : m.live_state ? m.state : memberState(m, rec);
      const on = S.to === m.name;
      const ok = reachable(m);
      const seen = m.last_seen ? ", last seen " + fmtRelative(Date.parse(m.last_seen)) : "";
      const why = ok ? (on ? ". Click to message everyone instead." : ". Click to message it.") : ". " + ((m.deliver && m.deliver.reason) || "Cannot receive messages.");
      return h("li", { class: "chan-chip", "data-state": state, "data-on": on ? "true" : null },
        h("button", { class: "chan-chip-main", type: "button", disabled: !ok, "aria-pressed": on ? "true" : "false", title: m.name + ", " + presenceWord(state) + seen + why, onClick: () => pickTo(m.name) },
          HexGlyph(state === "parked" ? "idle" : state, { size: "mini" }), h("span", { class: "truncate" }, m.name), h("span", { class: "dim" }, presenceWord(state) + (m.last_seen ? " \u00B7 " + (state === "parked" ? "last seen " : "") + fmtRelative(Date.parse(m.last_seen)) : ""))),
        rec ? h("button", { class: "chan-chip-open", type: "button", "aria-label": "Open " + m.name, title: "Open " + m.name, onClick: () => ctx.openAgent(rec) }, icon("external-link")) : null);
    }));
  }

  function paintTabs() {
    replace(tabs, [["messages", "Messages"], ["board", "Board"]].map(([id, label]) => h("button", { class: "seg-btn", type: "button", role: "radio", "aria-checked": id === S.tab ? "true" : "false", onClick: () => { S.tab = id; paintTabs(); paintLog(); } }, label)));
  }

  const leadText = (meta) => (!meta.lead ? "" : "lead " + meta.lead + (meta.lead_liveness ? " (" + meta.lead_liveness.text + ")" : meta.lead_state ? " (" + meta.lead_state + ")" : ""));

  function headLine(meta, info) {
    const n = (meta.members || []).length;
    const live = (meta.members || []).filter(reachable).length;
    return [info.sub ? "subchannel" : "main channel", leadText(meta), info.branch, "project " + (info.folder || info.project), live + " of " + n + " members can receive"].filter(Boolean).join(" \u00B7 ");
  }

  function headPicker(all, cur) {
    return h("select", { class: "select chan-pick", "aria-label": "Switch channel", onChange: (e) => select(e.target.value) }, all.map((c) => h("option", { value: c.name, selected: c.name === S.active }, (c.parent ? "\u00A0\u00A0" : "") + c.name + (c.name === cur ? "  (current)" : ""))));
  }

  function paintHead() {
    const meta = metaNow();
    if (!meta) return;
    const info = chanInfo(meta);
    const cur = S.data && S.data.current;
    const line = headLine(meta, info);
    const isCur = meta.name === cur;
    replace(head,
      h("p", { class: "dim chan-explain" }, "A channel is the shared message board of one lead and the agents it dispatched. Choose a recipient below and Send: the message is written to this board and the recipient reads it on its next tool call (or it is typed into its terminal if it is an idle claude/omp session). Each message shows whether it was delivered."),
      h("div", { class: "chan-title" },
        h("span", { class: "chip-lite chan-cur", "data-current": isCur ? "true" : "false" }, isCur ? "Current channel" : "Not the current channel"),
        h("h2", { class: "sr-only", title: meta.name }, meta.name),
        headPicker(chans(), cur),
        !isCur && cur ? Button({ label: "Go to current", size: "sm", onClick: () => select(cur) }) : null,
        info.sub ? h("span", { class: "grow" }) : null,
        info.sub ? Button({ label: "Supervise", size: "sm", icon: "agents", title: "Lead to subagents tree with every member's todo board", onClick: () => ctx.navigate("agents", { lens: "supervision", channel: meta.name }) }) : null),
      h("span", { class: "dim chan-line", title: line }, line),
      chips(meta));
    paintTabs();
  }

  const reachable = (m) => !m.deliver || m.deliver.ok !== false;

  function paintComposer() {
    const meta = metaNow();
    if (!meta) return;
    const mem = meta.members || [];
    const anyone = mem.some(reachable);
    if (S.to !== "all" && !(mem.find((m) => m.name === S.to) && reachable(mem.find((m) => m.name === S.to)))) S.to = "all";
    const key = meta.name + "|" + mem.map((m) => m.name + (reachable(m) ? "+" : "-")).join(",");
    if (key !== composerKey) {
      composerKey = key;
      const sel = h("select", { class: "select chan-to", "aria-label": "To", onChange: (e) => { S.to = e.target.value; paintHead(); paintComposer(); } },
        h("option", { value: "all", disabled: !anyone }, anyone ? "Everyone in channel" : "Everyone (nobody can receive)"),
        mem.map((m) => h("option", { value: m.name, disabled: !reachable(m), title: m.deliver && m.deliver.reason }, m.name + (reachable(m) ? "" : " (" + (m.live_state || "unreachable") + ", cannot receive)"))));
      comp = Composer({
        simple: true,
        lead: sel,
        // Always the board: the server types it into an idle claude/omp pane, else queues it for the member's next tool call, and records it here with its delivery status.
        onSend: async (_mode, text) => {
          const r = await ctx.api.post("channels", { channel: meta.name, to: S.to, body: text, from: "human", project: meta.project });
          const t = r && r.message && r.message.delivery_text;
          toast(t || "Posted to " + (S.to === "all" ? meta.name : S.to), { kind: "ok" });
          await loadDetail();
          paintLog();
        },
      });
      replace(composerHost, comp);
    }
    // To changes (chip click or select) only retarget the existing composer, so a typed draft survives.
    comp.querySelector(".chan-to").value = S.to;
    const ta = comp.querySelector("textarea");
    const off = S.to === "all" && !anyone;
    ta.disabled = off;
    for (const b of comp.querySelectorAll("button")) b.disabled = off;
    ta.placeholder = off ? "Nobody in this channel can receive a message (members finished, dead or none)" : S.to === "all" ? "Message everyone in " + meta.name : "Message " + S.to + ": it reads this on its next tool call";
  }

  function paintLog() {
    const d = S.detail;
    if (S.tab === "board" && !(d && d.error)) {
      if (!d) return replace(log, State({ variant: "loading", label: "board", shape: "rows" }));
      const rows = memberBoard(metaNow(), d.board);
      const empty = rows.length && rows.every((r) => !r.items.length);
      return replace(log, h("div", { class: "chan-board" }, empty ? h("p", { class: "dim chan-empty" }, "No todos on this channel's board yet. Members claim items with atlas_todo.py claim.") : null, MemberBoard({ rows, to: S.to, onTo: pickTo, onOpen: (rec) => ctx.openAgent(rec) })));
    }
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
      S.active = defaultChan().name;
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
        if (!S.active || !all.some((c) => c.name === S.active)) S.active = defaultChan().name;
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
