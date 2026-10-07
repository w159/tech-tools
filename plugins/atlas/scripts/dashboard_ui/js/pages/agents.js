// Agents canvas: one entity, four lenses (fleet, board, channel, supervision). Fleet, Channel and Supervision are native here;
// Board mounts the work page. Colony (the full herdr UI) is its own route (#/colony, pages/herdr.js).

import { h, replace } from "../dom.js";
import { agentsStore, STATES, STATE_WORD } from "../agents-store.js";
import { AgentCard, AgentTable, nowLine } from "../fleet.js";
import { Chip, Button, State, DegradedState, toast, toastError } from "../components.js";
import { channelOf, projectLabel } from "../chan-names.js";
import { mountChannelLens } from "./channel-lens.js";
import { mountSupervisionLens } from "./supervision-lens.js";
import { newWorkspace, focusPane } from "../herdr-actions.js";
import { warmHp } from "../integrations.js";
const LENS = [["fleet", "Fleet"], ["board", "Board"], ["channel", "Channel"], ["supervision", "Supervision"]];

const S = { ctx: null, lens: "fleet", view: "cards", filter: new Set(), q: "", unsub: null, body: null, legacy: null, chan: null, mount: null, tick: null, sort: { key: "state", dir: 1 }, chans: [], chansAt: 0 };

// Channels give each agent's project branch (`folder@branch`) and channel chip; refreshed at most every 20s.
async function loadChans(force) {
  if (!S.ctx || (!force && Date.now() - S.chansAt < 20000)) return;
  S.chansAt = Date.now();
  try {
    const d = await S.ctx.api.get("channels", { project: S.ctx.project });
    const next = (d && d.channels) || [];
    const key = JSON.stringify(next.map((c) => [c.name, (c.members || []).map((m) => m.name + (m.pane_id || ""))]));
    S.chans = next;
    if (key !== S.chansKey) { S.chansKey = key; if (S.lens === "fleet" && !S.destroyed) drawFleet(); }
  } catch (_e) {
    S.chans = []; // fleet still renders: groups fall back to the folder name
  }
}

// Project root an agent belongs to: a registered project, else the root of a channel its cwd sits in, else its cwd.
function rootOf(a) {
  if (a.project) return a.project;
  const c = S.chans.find((x) => x.project && (a.cwd === x.project || a.cwd.startsWith(x.project.replace(/\/+$/, "") + "/")));
  return c ? c.project : a.cwd || "";
}
const SORT = {
  state: (a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state),
  title: (a, b) => a.title.localeCompare(b.title),
  project: (a, b) => projectLabel(rootOf(a), S.chans).localeCompare(projectLabel(rootOf(b), S.chans)),
  now: (a, b) => nowLine(a).text.localeCompare(nowLine(b).text),
  age: (a, b) => b.since - a.since,
  subs: (a, b) => (a.children || []).length - (b.children || []).length,
  channel: (a, b) => ((channelOf(a, S.chans) || {}).full || "~").localeCompare((channelOf(b, S.chans) || {}).full || "~"),
};

function lensBar(ctx) {
  return h("div", { class: "seg", role: "radiogroup", "aria-label": "Agents lens" }, LENS.map(([id, label]) => h("button", { class: "seg-btn", type: "button", role: "radio", "aria-checked": id === S.lens ? "true" : "false", onClick: () => ctx.navigate("agents", { lens: id }) }, label)));
}

function header(ctx, extra) {
  const st = agentsStore.getState();
  const c = st.counts;
  const bits = STATES.filter((k) => c[k]).map((k) => c[k] + " " + STATE_WORD[k].toLowerCase()).join(", ");
  const create = S.lens === "fleet" ? Button({ label: "New workspace", icon: "plus", size: "sm", onClick: () => newWorkspace(ctx.project !== "all" ? ctx.project : "") }) : null;
  return h("div", { class: "page-head" }, h("div", null, h("h1", null, "Agents"), h("p", { class: "sub" }, st.loaded ? (c.total ? bits : "No agents running") : "Loading agents")), h("div", { class: "page-actions" }, lensBar(ctx), create, extra || null));
}

// ---- lens: fleet -----------------------------------------------------------------------------------------

function visible(st) {
  const q = S.q.trim().toLowerCase();
  return st.agents.filter((a) => (!S.filter.size || S.filter.has(a.state)) && (!q || (a.title + " " + a.workspace + " " + a.task + " " + a.pane_id).toLowerCase().includes(q)));
}

function actions(ctx) {
  return {
    onTerminal: (a) => ctx.openAgent(a, { tab: "terminal" }),
    onMessage: (a) => ctx.openAgent(a, { tab: "channel" }),
    onPrompt: (a) => ctx.openAgent(a, { tab: "channel" }),
    onAssign: () => ctx.navigate("agents", { lens: "board" }),
    onStop: async (a) => {
      try {
        await ctx.api.post("herd/panes/" + encodeURIComponent(a.pane_id) + "/kill", {});
        toast("Stopped " + a.title, { kind: "ok" });
        agentsStore.refresh(["herd"]);
      } catch (e) {
        toastError(e, "Could not stop " + a.title);
      }
    },
  };
}

function drawFleet() {
  const ctx = S.ctx;
  const st = agentsStore.getState();
  const body = S.body;
  const down = st.down;
  if (!st.loaded) return replace(body, State({ variant: "loading", label: "agents", shape: "cards" }));
  if (down === "herdr") return replace(body, DegradedState({ layer: "herdr", reason: st.layers.herdr.reason, onRecheck: () => agentsStore.recheck() }));
  loadChans();
  warmHp().then((changed) => { if (changed && !S.destroyed && S.lens === "fleet") drawFleet(); });
  const sel = ctx.params.agent;
  const chips = h("div", { class: "row filter-chips", role: "group", "aria-label": "Filter by state" }, STATES.filter((k) => st.counts[k] || S.filter.has(k)).map((k) => Chip({ label: STATE_WORD[k], count: st.counts[k], selected: S.filter.has(k), onClick: () => { if (S.filter.has(k)) S.filter.delete(k); else S.filter.add(k); drawFleet(); } })));
  const tools = h("div", { class: "filterbar" }, h("input", { class: "input search", type: "search", value: S.q, placeholder: "Filter agents", "aria-label": "Filter agents", onInput: (e) => { S.q = e.target.value; drawList(); } }), chips, h("span", { class: "row", style: { marginLeft: "auto" } }, h("div", { class: "seg", role: "radiogroup", "aria-label": "View" }, [["cards", "Cards"], ["list", "List"]].map(([id, label]) => h("button", { class: "seg-btn", type: "button", role: "radio", "aria-checked": S.view === id ? "true" : "false", onClick: () => { S.view = id; drawFleet(); } }, label)))));
  const listHost = h("div", { class: "fleet-list-host" });
  const open = (rec, o) => ctx.openAgent(rec, { tab: o && o.terminal ? "terminal" : undefined });
  const drawList = () => {
    const cur = agentsStore.getState();
    const vis = visible(cur);
    const a = actions(ctx);
    if (!vis.length) return replace(listHost, st.counts.total ? State({ variant: "empty", title: "No agents match", body: "Clear the filter to see all " + st.counts.total + ".", action: Button({ label: "Clear filter", onClick: () => { S.filter.clear(); S.q = ""; drawFleet(); } }) }) : State({ variant: "empty", title: "No agents running", body: "Agents appear here when you start one in herdr or launch one from Atlas.", action: Button({ label: "Launch agent", variant: "primary", onClick: () => document.dispatchEvent(new CustomEvent("atlas:launch")) }) }));
    if (S.view === "list") {
      const rows = vis.slice().sort((x, y) => S.sort.dir * SORT[S.sort.key](x, y) || STATES.indexOf(x.state) - STATES.indexOf(y.state));
      return replace(listHost, AgentTable({ agents: rows, sort: S.sort, selectedKey: sel, onOpen: open, actions: a, projectOf: (r) => projectLabel(rootOf(r), S.chans), channelOf: (r) => channelOf(r, S.chans), onSort: (k) => { S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; drawList(); } }));
    }
    const groups = new Map();
    for (const r of vis) {
      const root = rootOf(r);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(r);
    }
    replace(listHost, [...groups].map(([root, rs]) => h("section", { class: "fleet-group", "aria-label": projectLabel(root, S.chans) },
      h("h2", { class: "fleet-group-head", title: root }, h("span", { class: "truncate" }, projectLabel(root, S.chans) || "No project"), h("span", { class: "num dim" }, String(rs.length))),
      h("div", { class: "fleet-grid" }, rs.map((r) => AgentCard({ agent: r, selected: r.key === sel, channel: channelOf(r, S.chans), parent: r.parent ? cur.byKey.get(r.parent) : null, onParent: (p) => ctx.openAgent(p), onOpen: open, onTerminal: (rec) => focusPane(rec.pane_id || rec.key), onSupervise: (_rec, ch) => ctx.navigate("agents", { lens: "supervision", channel: ch && ch.sub ? ch.full : undefined }), actions: a }))))));
  };
  const web = st.layers.webui.state === "down" ? h("p", { class: "dim" }, "The terminal service isn't running. The agent list is live; terminals need it.") : null;
  replace(body, tools, web, listHost);
  drawList();
}


// ---- legacy lens host (Board still mounts the work page) -------------------------------------------------------------------

async function mountLegacy(id) {
  const mod = await import("../app.js").then((m) => m.legacyPages).catch(() => ({}));
  const page = mod[id];
  if (!page) return replace(S.body, State({ variant: "error", title: "This lens didn't load", error: { error: id + "_module_missing" }, onRetry: () => draw() }));
  S.legacy = page;
  try {
    const data = await page.load(S.ctx);
    const node = page.render(S.ctx, data);
    // one h1 per page: the legacy page's own title becomes a section heading
    const t = node.querySelector("h1");
    if (t) { const h2 = h("h2", { class: t.className }, ...t.childNodes); t.replaceWith(h2); }
    replace(S.body, node);
  } catch (e) {
    replace(S.body, State({ variant: "error", error: e, onRetry: () => draw() }));
  }
}

// ---- page ---------------------------------------------------------------------------------------------------------------

function draw() {
  const lens = S.lens;
  if (lens === "fleet") drawFleet();
  else if (lens === "board") mountLegacy("work");
  else if (lens === "supervision") S.chan = mountSupervisionLens(S.ctx, S.body);
  else S.chan = mountChannelLens(S.ctx, S.body);
}

export default {
  id: "agents",
  title: "Agents",
  icon: "agents",
  group: "Operate",
  async load(ctx) {
    this.destroy();
    S.destroyed = false;
    S.ctx = ctx;
    S.lens = LENS.some(([id]) => id === ctx.params.lens) ? ctx.params.lens : "fleet";
    return null;
  },
  render(ctx) {
    const mount = h("div", { class: ["page", "agents-page", S.lens === "fleet" ? "is-wide" : "", S.lens === "channel" ? "is-chan" : ""] });
    S.mount = mount;
    S.body = h("div", { class: "agents-body" });
    const head = h("div", { class: "agents-head" });
    replace(mount, head, S.body);
    const paintHead = () => replace(head, header(ctx));
    paintHead();
    let last = -1;
    S.unsub = agentsStore.subscribe((st) => {
      if (st.generation === last) return;
      last = st.generation;
      paintHead();
      if (S.lens === "fleet") drawFleet();
      else if (S.chan) S.chan.repaint();
    });
    draw();
    return mount;
  },
  onEvent(name, ctx, data) {
    if (S.legacy && S.legacy.onEvent) return S.legacy.onEvent(name, ctx, data);
    if (S.chan && ["irc", "todos", "tick"].includes(name)) S.chan.refresh();
  },
  destroy() {
    S.destroyed = true;
    if (S.unsub) S.unsub();
    S.unsub = null;
    if (S.chan) S.chan.destroy();
    S.chan = null;
    if (S.legacy && S.legacy.destroy) {
      try { S.legacy.destroy(); } catch (_e) { /* cleanup must not block navigation */ }
    }
    S.legacy = null;
  },
};

