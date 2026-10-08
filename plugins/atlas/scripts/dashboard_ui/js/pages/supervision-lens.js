// Supervision lens: what a lead needs to monitor its subagents. One tree per lead subchannel (parent link = the project's
// main channel): the lead row, then its subagents nested beneath, each with presence (live pane state from agents-store),
// todo counts, the in-progress item, every todo item and the last note with its age.
// Data: GET /api/v2/channels (lead subchannels), GET /api/v2/channels/<lead>?limit=1 (board.owners per lead). Mounted by agents.js.

import { h, replace } from "../dom.js";
import { chanInfo, leadChannels, memberBoard, todoSummary } from "../chan-names.js";
import { Button, State } from "../components.js";
import { MemberBoard } from "./channel-lens.js";

export function mountSupervisionLens(ctx, body) {
  const S = { chans: null, boards: new Map(), error: null, dead: false, busy: false };
  const proj = () => (ctx.project === "all" ? undefined : ctx.project);

  function section(c) {
    const info = chanInfo(c);
    const rows = memberBoard(c, (S.boards.get(c.name) || {}).board);
    const total = rows.reduce((n, r) => n + r.items.length, 0);
    const subs = rows.filter((r) => r.role !== "lead").length;
    const sum = todoSummary(rows.reduce((t, r) => ({ active: t.active + r.counts.active, open: t.open + r.counts.open, blocked: t.blocked + r.counts.blocked, done: t.done + r.counts.done }), { active: 0, open: 0, blocked: 0, done: 0 }));
    return h("section", { class: "sup-lead", "aria-label": "Lead " + info.alias, "data-on": ctx.params.channel === c.name ? "true" : null },
      h("div", { class: "sup-head" },
        h("h2", { class: "truncate", title: c.name }, "Lead " + info.alias),
        h("span", { class: "dim" }, info.parent + " \u00B7 " + subs + (subs === 1 ? " subagent" : " subagents") + " \u00B7 " + (total ? sum : "no todos")),
        h("span", { class: "grow" }),
        Button({ label: "Channel", size: "sm", onClick: () => ctx.navigate("channels", { channel: c.name, tab: "board" }) })),
      rows.length ? MemberBoard({ rows, nested: true, onOpen: (rec) => ctx.openAgent(rec), onTo: () => ctx.navigate("channels", { channel: c.name }) }) : h("p", { class: "dim chan-empty" }, "This lead has not dispatched any subagents yet."));
  }

  function paint() {
    if (S.dead) return;
    if (S.error) return replace(body, State({ variant: "error", error: S.error, onRetry: refresh }));
    if (!S.chans) return replace(body, State({ variant: "loading", label: "supervision", shape: "rows" }));
    const leads = leadChannels(S.chans);
    if (!leads.length) return replace(body, State({ variant: "empty", title: "No lead is supervising subagents", body: "When an orchestrating agent runs atlas_todo.py channel-open it gets a subchannel named <folder>@<branch>/<lead>. Its subagents and their todo boards show up here.", action: Button({ label: "Open Channel", onClick: () => ctx.navigate("channels") }) }));
    const sel = ctx.params.channel;
    const ordered = leads.slice().sort((a, b) => (b.name === sel) - (a.name === sel));
    replace(body, h("div", { class: "sup-page" }, ordered.map(section)));
  }

  async function refresh() {
    if (S.dead || S.busy) return;
    S.busy = true;
    try {
      const d = await ctx.api.get("channels", { project: ctx.project });
      S.chans = (d && d.channels) || [];
      S.error = null;
      await Promise.all(leadChannels(S.chans).map(async (c) => {
        try { S.boards.set(c.name, await ctx.api.get("channels/" + encodeURIComponent(c.name), { limit: 1, project: proj() })); } catch (_e) { S.boards.delete(c.name); } // board missing: the lead renders with zero todos
      }));
    } catch (e) {
      S.error = e;
    } finally {
      S.busy = false;
    }
    paint();
  }

  paint();
  refresh();
  return { refresh, repaint: () => { if (S.chans) paint(); }, destroy: () => { S.dead = true; } };
}
