// Fleet components (MASTER 3, 7.1, 9.2, 9.3, 9.6): Fleet Strip, agent row, agent card, rail tree, inspector.
// All take AgentRecords from agents-store.js. No top-level use of components.js (it re-exports this module).

import { h, icon, clear, replace, copyText } from "./dom.js";
import { api } from "./api.js";
import { HexGlyph, describeStatus } from "./glyphs.js";
import { agentsStore, STATE_WORD, ageSeconds, firstDownLayer } from "./agents-store.js";
import { Badge, Button, IconButton, Tabs, tabPanelProps, State, DegradedState } from "./ui-core.js";
import { Drawer, openDrawer, closeDrawer, openMenu, openPopover, closePopover, toast, toastError } from "./ui-overlays.js";
import { ChannelList, Composer, FeedItem } from "./ui-data.js";
import { renamePane, renameTab, closePane, closeTab, hostReachable, QUICK_KEYS, sendKeys } from "./herdr-actions.js";
import { FilesPanel, hpThreadFor, openEditor } from "./integrations.js";
import { sendToSeat } from "./send-path.js";
import { pollCapture, CAPTURE_LINES } from "./capture-view.js";

// <pre> of one seat's text for runtimes with no web UI. Polls herd/capture until it leaves the DOM; skips ticks while hidden.
function captureView(paneId) {
  const pre = h("pre", { class: "pane-capture mono", "data-pane": paneId, tabindex: "0", "aria-label": "Terminal output (read only)", style: "margin:0;overflow:auto;max-height:60vh;white-space:pre-wrap" }, "waiting for output");
  let attached = false;
  pre.stop = pollCapture({
    fetchOnce: () => api.get("herd/capture", { pane: paneId, lines: CAPTURE_LINES }),
    onUpdate: (d) => { pre.textContent = d.text; pre.dataset.error = d.isError ? "true" : "false"; },
    isHidden: () => Boolean(pre.closest("[hidden]")),
    // Gone only counts after it was attached once: the first tick runs before the caller appends it.
    isGone: () => { if (pre.isConnected) attached = true; return attached && !pre.isConnected; },
  });
  return pre;
}

// herdr-projects thread/branch chip when the agent's cwd is a thread's cwd (null otherwise).
export function hpChip(a) {
  const hit = hpThreadFor(a.cwd);
  if (!hit) return null;
  const t = hit.thread;
  return h("span", { class: "chip-lite hp-chip", title: "herdr-projects " + hit.project + " thread " + t.id + (t.branch ? " on " + t.branch : "") + (t.channel ? ", channel " + t.channel : "") }, icon("irc"), h("span", { class: "hp-chip-text" }, hit.project + " #" + t.id + (t.branch ? " " + t.branch : "")));
}

// ---- helpers -----------------------------------------------------------------------------------

export function fmtAge(sec) {
  if (sec === null || sec === undefined) return "";
  if (sec < 5) return "now";
  if (sec < 60) return sec + "s";
  if (sec < 3600) return Math.floor(sec / 60) + "m";
  if (sec < 86400) return Math.floor(sec / 3600) + "h";
  return Math.floor(sec / 86400) + "d";
}

// Age since the last state change as stamped by the daemon (first_seen is a lower bound; shown via title, not a glyph).
export function ageLabel(rec) {
  return fmtAge(ageSeconds(rec));
}

export function ageTitle(rec) {
  return rec.sinceApprox ? "Since Atlas first saw this state" : "Since the last state change";
}

export function kindIcon(kind) {
  return icon("kind-" + kind, { class: "icon kind-icon", "aria-hidden": "true" });
}

const KIND_WORD = { omp: "omp", claude: "Claude Code", codex: "Codex", shell: "Shell", unknown: "Agent" };
export const kindWord = (k) => KIND_WORD[k] || KIND_WORD.unknown;

// Workspace rows can arrive with a null label; fall back to the id basename, then "Unassigned".
export function wsLabel(w) {
  const l = w && w.label;
  if (l != null && String(l).trim()) return String(l);
  const id = w && w.id != null ? String(w.id).split("/").filter(Boolean).pop() : "";
  return id || "Unassigned";
}

export function agentLabel(rec) {
  return rec.title + " in " + (rec.workspace || "workspace") + ", " + STATE_WORD[rec.state].toLowerCase() + (ageLabel(rec) ? ", " + ageLabel(rec) : "");
}

// Hash for the Agents canvas: opens the inspector for an agent (and optionally a tab).
export function agentHref(rec, tab) {
  return "#/agents?agent=" + encodeURIComponent(rec.key) + (tab ? "&tab=" + tab : "");
}

// ---- 3 fleet strip -------------------------------------------------------------------------------

const MAX_CELLS = 24;

// FleetStrip({ agents, onOpen(rec), max }) -> role=toolbar. Roving tabindex, arrows move, Enter opens, 1..9 jumps.
// Hover/focus popover after 300ms. .update(agents) redraws in place. Overflow collapses into a "+N" cell.
export function FleetStrip({ agents, onOpen, max } = {}) {
  const limit = max || MAX_CELLS;
  const root = h("div", { class: "fleet-strip", role: "toolbar", "aria-label": "Agents (one hexagon per agent; click to open)", title: "Agents: one hexagon per agent session, colored by state. Click one to open it." });
  const summary = h("span", { class: "sr-only" });
  let list = [];
  let popTimer = null;
  const cells = () => Array.from(root.querySelectorAll(".fleet-cell"));
  const rove = (to) => {
    const cs = cells();
    cs.forEach((c, i) => (c.tabIndex = i === to ? 0 : -1));
    if (cs[to]) cs[to].focus();
  };
  const showPop = (btn, rec) => {
    clearTimeout(popTimer);
    popTimer = setTimeout(() => {
      openPopover(btn, h("div", { class: "agent-pop" }, h("strong", null, rec.title), h("div", { class: "dim" }, kindWord(rec.kind) + ", " + (rec.workspace || "")), rec.task ? h("div", null, rec.task) : null, h("div", { class: "dim" }, STATE_WORD[rec.state] + (ageLabel(rec) ? ", " + ageLabel(rec) : ""))), { label: rec.title, role: "tooltip", returnFocus: false });
    }, 120);
  };
  const hidePop = () => {
    clearTimeout(popTimer);
    closePopover();
  };
  const draw = () => {
    clear(root);
    const shown = list.slice(0, list.length > limit ? limit - 1 : limit);
    const rest = list.slice(shown.length);
    const counts = {};
    for (const a of list) counts[a.state] = (counts[a.state] || 0) + 1;
    clear(summary);
    summary.textContent = list.length ? ["working", "input", "fail", "idle", "done", "unknown"].filter((k) => counts[k]).map((k) => counts[k] + " " + STATE_WORD[k].toLowerCase()).join(", ") : "No agents";
    root.appendChild(summary);
    if (!list.length) root.appendChild(h("span", { class: "fleet-empty dim" }, "No agents"));
    const push = (rec, i) => {
      const btn = h(
        "button",
      { class: "fleet-cell", type: "button", tabindex: i === 0 ? "0" : "-1", title: rec.title + ", " + STATE_WORD[rec.state], "data-state": rec.state, "data-key": rec.key, "aria-label": agentLabel(rec), onClick: () => onOpen && onOpen(rec), onMouseenter: () => showPop(btn, rec), onMouseleave: hidePop, onFocus: () => showPop(btn, rec), onBlur: hidePop },
        HexGlyph(rec.state, { size: "strip" })
      );
      root.appendChild(btn);
      // subagents (G2, absent until the backend links them) attach after the parent at 14x16
      for (const c of rec.children || []) {
        root.appendChild(h("button", { class: "fleet-cell fleet-sub", type: "button", tabindex: "-1", "data-state": c.state, "aria-label": agentLabel(c), onClick: () => onOpen && onOpen(c) }, HexGlyph(c.state, { size: [14, 16] })));
      }
    };
    shown.forEach(push);
    if (rest.length) {
      const dom = rest.reduce((best, a) => ((counts[a.state] || 0) > (counts[best] || 0) ? a.state : best), rest[0].state);
      root.appendChild(h("button", { class: "fleet-cell fleet-more", type: "button", tabindex: "-1", "data-state": dom, "aria-label": rest.length + " more agents", title: rest.length + " more", onClick: () => onOpen && onOpen(rest[0]) }, HexGlyph(dom, { size: "strip" }), h("span", { class: "fleet-more-n num" }, "+" + rest.length)));
    }
  };
  root.addEventListener("keydown", (e) => {
    const cs = cells();
    const i = cs.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === "ArrowRight") { e.preventDefault(); rove(Math.min(cs.length - 1, i + 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); rove(Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); rove(0); }
    else if (e.key === "End") { e.preventDefault(); rove(cs.length - 1); }
    else if (/^[1-9]$/.test(e.key) && cs[Number(e.key) - 1]) { e.preventDefault(); rove(Number(e.key) - 1); }
  });
  root.update = (next) => {
    list = next || [];
    draw();
  };
  root.update(agents || []);
  return root;
}

// ---- 9.2 agent row / 9.3 agent card -----------------------------------------------------------------

// Menu items for the overflow menu (Open terminal, Prompt, Message, Assign task, Stop).
export function agentMenuItems(rec, a) {
  const act = a || {};
  const pane = rec.pane_id || rec.key;
  return [
    { label: "Open terminal", icon: "terminal", hint: "t", onSelect: () => act.onTerminal && act.onTerminal(rec) },
    { label: "Prompt", icon: "send", onSelect: () => act.onPrompt && act.onPrompt(rec), disabled: rec.state !== "idle" },
    { label: "Message", icon: "message", hint: "m", onSelect: () => act.onMessage && act.onMessage(rec) },
    { label: "Assign task", icon: "plus", onSelect: () => act.onAssign && act.onAssign(rec) },
    { label: "Copy pane id", icon: "copy", onSelect: () => copyText(pane) },
    { label: "Open files", icon: "folder", onSelect: () => { location.hash = agentHref(rec, "files"); }, disabled: !rec.cwd },
    { label: "Open in editor", icon: "external-link", onSelect: () => openEditor({ path: rec.cwd }), disabled: !rec.cwd },
    { label: "Rename pane", icon: "edit", onSelect: () => renamePane(pane, rec.title), disabled: !rec.pane_id },
    { label: "Rename tab", icon: "edit", onSelect: () => renameTab(rec.tab_id, ""), disabled: !rec.tab_id },
    { label: "Close pane", icon: "stop", danger: true, onSelect: () => closePane(pane, rec.title), disabled: !rec.pane_id },
    { label: "Close tab", icon: "stop", danger: true, onSelect: () => closeTab(rec.tab_id, rec.workspace || rec.tab_id), disabled: !rec.tab_id },
    { label: "Stop", icon: "stop", danger: true, onSelect: () => act.onStop && act.onStop(rec), disabled: !rec.colony },
  ];
}

function menuButton(rec, actions) {
  const b = h("button", { class: "btn btn-ghost btn-icon row-menu", type: "button", "aria-label": "Actions for " + rec.title, "aria-haspopup": "menu", title: "Actions", onClick: (e) => { e.stopPropagation(); openMenu(b, agentMenuItems(rec, actions), { placement: "end", label: "Actions for " + rec.title }); } }, icon("more"));
  return b;
}

// AgentRow({ agent, selected, onOpen(rec, {terminal}), actions, showProject })
export function AgentRow({ agent: a, selected, onOpen, actions, showProject } = {}) {
  const row = h(
    "div",
    { class: "agent-row", role: "row", tabindex: "0", "data-state": a.state, "data-key": a.key, "data-selected": selected ? "true" : null, "aria-selected": selected ? "true" : null, "aria-label": agentLabel(a), onClick: () => onOpen && onOpen(a, {}) },
    HexGlyph(a.state, { size: "mini" }),
    kindIcon(a.kind),
    h("span", { class: "agent-name" }, h("span", { class: "agent-title truncate" }, a.title), h("span", { class: "agent-ws truncate dim" }, a.workspace || "")),
    Badge({ status: a.state }),
    h("span", { class: "agent-task truncate dim" }, a.task || ""),
    showProject ? h("span", { class: "agent-project truncate dim" }, a.project ? a.project.split("/").pop() : "") : null,
    h("span", { class: "agent-age num dim" }, ageLabel(a)),
    menuButton(a, actions)
  );
  row.addEventListener("keydown", (e) => {
    if (e.target !== row) return;
    if (e.key === "Enter") { e.preventDefault(); onOpen && onOpen(a, { terminal: e.shiftKey }); }
    else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); const n = row.nextElementSibling; if (n) n.focus(); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); const n = row.previousElementSibling; if (n) n.focus(); }
    else if (e.key === ".") { e.preventDefault(); row.querySelector(".row-menu").click(); }
  });
  return row;
}

// What the agent is doing now: its in-progress task, else the latest channel line, else an honest blank.
export function nowLine(a) {
  if (a.task) return { label: "Task", text: a.task };
  if (a.lastMsg) return { label: "Latest", text: a.lastMsg };
  return { label: "", text: "Not attached to an atlas task" + (a.state ? " (" + a.state + ")" : "") };
}


// AgentCard({ agent, selected, onOpen, onTerminal, actions, channel, parent, onParent }): fluid. Click body opens the inspector;
// the primary button opens the Terminal tab. Border turns --st-input / --st-fail for needs-input / failed.
// channel: short alias of the agent's channel (or ""), parent: parent record (or null).
export function AgentCard({ agent: a, selected, onOpen, onTerminal, actions, channel, parent, onParent, onSupervise } = {}) {
  const now = nowLine(a);
  const kids = a.children || [];
  const chips = [
    h("span", { class: "chip-lite" }, kindIcon(a.kind), kindWord(a.kind)),
    channel ? h("span", { class: "chip-lite", title: "Channel " + channel.full }, icon("irc"), channel.alias) : null,
    a.colony ? h("span", { class: "chip-lite" }, "colony") : null,
    hpChip(a),
    parent ? h("button", { class: "chip-lite chip-link", type: "button", title: "Parent " + parent.title, onClick: (e) => { e.stopPropagation(); onParent && onParent(parent); } }, "under " + parent.title) : null,
    onSupervise && (kids.length || (channel && channel.sub && channel.lead === a.name)) ? h("button", { class: "chip-lite chip-link", type: "button", title: "Watch " + a.title + "'s subagents and their todo boards", onClick: (e) => { e.stopPropagation(); onSupervise(a, channel); } }, icon("agents"), "Supervise") : null,
  ];
  const card = h(
    "article",
    { class: "agent-card", "data-state": a.state, "data-key": a.key, "data-selected": selected ? "true" : null, tabindex: "0", "aria-label": agentLabel(a), onClick: () => onOpen && onOpen(a, {}) },
    h("header", null, HexGlyph(a.state, { size: [14, 16] }), h("h3", { class: "truncate", title: a.title }, a.title), menuButton(a, actions)),
    h("div", { class: "agent-now", title: now.text }, now.label ? h("span", { class: "agent-now-label" }, now.label) : null, h("span", { class: now.label ? "" : "dim" }, now.text)),
    h("div", { class: "agent-chips" }, chips),
    kids.length ? h("ul", { class: "agent-kids", "aria-label": kids.length + " subagents" }, kids.slice(0, 4).map((c) => h("li", { title: c.title + ", " + STATE_WORD[c.state] }, HexGlyph(c.state, { size: "mini" }), h("span", { class: "truncate" }, c.title))), kids.length > 4 ? h("li", { class: "dim" }, "+" + (kids.length - 4) + " more") : null) : null,
    h("footer", null, Badge({ status: a.state }), h("span", { class: "num dim", title: ageTitle(a) }, ageLabel(a) ? "for " + ageLabel(a) : ""), kids.length ? h("span", { class: "dim num" }, kids.length + (kids.length === 1 ? " subagent" : " subagents")) : null, a.tasks.length ? h("span", { class: "dim num" }, a.tasks.length + (a.tasks.length === 1 ? " task" : " tasks")) : null, h("span", { class: "grow agent-pane mono", title: "Pane id" }, a.pane_id || ""), Button({ label: "Open", size: "sm", onClick: (e) => { e.stopPropagation(); onTerminal && onTerminal(a); } }))
  );
  card.addEventListener("keydown", (e) => {
    if (e.target === card && e.key === "Enter") { e.preventDefault(); onOpen && onOpen(a, { terminal: e.shiftKey }); }
  });
  return card;
}

// AgentTable({ agents, sort: {key, dir}, onSort(key), selectedKey, onOpen, actions, projectOf(rec), channelOf(rec) }) -> dense sortable table.
export const TABLE_COLS = [["state", "State"], ["title", "Agent"], ["project", "Project"], ["now", "Now"], ["age", "In state"], ["subs", "Subagents"], ["channel", "Channel"]];
export function AgentTable({ agents, sort, onSort, selectedKey, onOpen, actions, projectOf, channelOf } = {}) {
  const head = h("tr", null, TABLE_COLS.map(([k, label]) => h("th", { scope: "col", "aria-sort": sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none" }, h("button", { type: "button", class: "th-btn", onClick: () => onSort(k) }, label, sort.key === k ? h("span", { class: "th-arrow", "aria-hidden": "true" }, sort.dir === 1 ? "\u2191" : "\u2193") : null))), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")));
  const rows = agents.map((a) => {
    const now = nowLine(a);
    const ch = channelOf ? channelOf(a) : null;
    const tr = h("tr", { class: "agent-tr", tabindex: "0", "data-state": a.state, "data-key": a.key, "data-selected": a.key === selectedKey ? "true" : null, "aria-label": agentLabel(a), onClick: () => onOpen && onOpen(a, {}) },
      h("td", { class: "td-state" }, h("span", { class: "td-flex" }, HexGlyph(a.state, { size: "mini" }), h("span", null, STATE_WORD[a.state]))),
      h("td", { class: "td-title" }, h("span", { class: "td-flex" }, kindIcon(a.kind), h("span", { class: "truncate", title: a.title }, a.title))),
      h("td", { class: "td-project dim" }, h("span", { class: "truncate", title: a.cwd }, projectOf ? projectOf(a) : "")),
      h("td", { class: "td-now" }, h("span", { class: "truncate", title: now.text }, now.label ? h("span", { class: "agent-now-label" }, now.label) : null, now.text)),
      h("td", { class: "td-age num dim", title: ageTitle(a) }, ageLabel(a)),
      h("td", { class: "td-subs num dim" }, (a.children || []).length || ""),
      h("td", { class: "td-chan dim" }, h("span", { class: "truncate", title: ch ? ch.full : "" }, ch ? ch.alias : "")),
      h("td", { class: "td-menu" }, menuButton(a, actions))
    );
    tr.addEventListener("keydown", (e) => {
      if (e.target !== tr) return;
      if (e.key === "Enter") { e.preventDefault(); onOpen && onOpen(a, { terminal: e.shiftKey }); }
      else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); const n = tr.nextElementSibling; if (n) n.focus(); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); const n = tr.previousElementSibling; if (n) n.focus(); }
      else if (e.key === ".") { e.preventDefault(); tr.querySelector(".row-menu").click(); }
    });
    return tr;
  });
  return h("div", { class: "agent-table-wrap" }, h("table", { class: "agent-table", "aria-label": "Agents" }, h("thead", null, head), h("tbody", null, rows)));
}


// ---- 9.6 inspector --------------------------------------------------------------------------------------------

// Served through the host gateway (/atlas/) the page origin IS the herdr host: frames use it, never the loopback URL the
// API reports (unreachable over Tailscale, mixed content on https).
const GATEWAY = Boolean(((document.querySelector('meta[name="atlas-base"]') || {}).content || "").replace(/\/+$/, ""));
function toHost(u) {
  if (GATEWAY) {
    u.protocol = location.protocol;
    u.host = location.host;
  }
  return u;
}
function frameTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// Terminal URL: the herdr web UI pane link in chrome-less mode (?chrome=pane&theme=) so no second app chrome appears.
export function paneUrl(rec) {
  if (!rec.deep_link) return "";
  const u = toHost(new URL(rec.deep_link, location.href));
  u.searchParams.set("chrome", "pane");
  u.searchParams.set("theme", frameTheme());
  return u.toString();
}

// Drawer deep links: the roster lens with this seat selected, and the Terminal workspace on its seat.
export const colonyHref = (rec) => "#/agents?lens=roster&seat=" + encodeURIComponent(rec.name || rec.key);
export const terminalHref = (rec) => "#/terminal?seat=" + encodeURIComponent(rec.name || rec.key);

const TABS = ["now", "channel", "tasks", "files", "terminal"];

// Inspector({ agent, tab, onTab(id), store }) -> Drawer node. Re-render with .update(agent, state).
// Terminal tab: lazy iframe, mounted on first open, alive while the drawer is open; webui down -> inline layer-3 state only.
export function Inspector({ agent, tab, onTab } = {}) {
  let rec = agent;
  let cur = TABS.includes(tab) ? tab : "now";
  let frame = null;
  let cap = null; // seat-text <pre> when the runtime has no web UI
  let busy = false;
  const body = h("div", { class: "insp-panels" });
  const tabs = Tabs({ label: "Agent detail", tabs: [{ id: "now", label: "Now" }, { id: "channel", label: "Channel" }, { id: "tasks", label: "Tasks" }, { id: "files", label: "Files" }, { id: "terminal", label: "Terminal" }], active: cur, onChange: (id) => { cur = id; paint(); if (onTab) onTab(id); } });
  const head = h("div", { class: "insp-head grow" });
  const composerHost = h("div", { class: "insp-composer" });

  // Prompt and Message are one action: the colony send handler (wave gate included), the single client send path.
  const send = async (_mode, text) => {
    const res = await sendToSeat({ to: rec.name, body: text, project: rec.project || rec.cwd });
    toast(res && res.delivered ? "Delivered to " + rec.name : "Queued for " + rec.name, { kind: "ok", why: res && res.message && res.message.delivery_text });
    agentsStore.refresh(["irc"]);
  };

  const consoleButton = () => h("span", { class: "row" },
    Button({ label: "Open in Colony", size: "sm", icon: "external-link", onClick: () => { location.hash = colonyHref(rec); } }),
    Button({ label: "Open terminal", size: "sm", icon: "terminal", onClick: () => { location.hash = terminalHref(rec); } }));
  const nowPanel = () => {
    const state = agentsStore.getState();
    const rows = [["State", Badge({ status: rec.state })], ["Age", (ageLabel(rec) || "n/a") + (rec.sinceApprox ? " (since this page opened)" : "")], ["Kind", kindWord(rec.kind)], ["Workspace", rec.workspace || ""], ["Pane", h("span", { class: "mono" }, rec.pane_id)], ["Directory", h("span", { class: "mono cwd", title: rec.cwd }, rec.cwd, h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": "Copy directory", onClick: () => copyText(rec.cwd) }, icon("copy")))], ["Project", rec.project ? rec.project.split("/").pop() : "None matched"], ["Latest task", rec.task || "Not attached to an atlas task"]];
    const recent = rec.messages.slice(-5).reverse();
    const keysRow = rec.pane_id ? h("div", { class: "row insp-keys", role: "group", "aria-label": "Send keys" }, h("span", { class: "dim" }, "Send keys"), QUICK_KEYS.map(([label, keys]) => Button({ label, size: "sm", disabled: !hostReachable(), title: hostReachable() ? "Send " + label + " to this pane" : "Needs Atlas opened through the agent runtime host (/atlas/)", onClick: () => sendKeys(rec.pane_id, keys) }))) : null;
    return h("div", { class: "insp-now" }, h("dl", { class: "kv" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])), h("div", { class: "row" }, consoleButton()), keysRow, h("h3", null, "Recent activity"), recent.length ? h("div", { class: "feed" }, recent.map((m) => FeedItem({ ts: m.ts, kind: "message", title: (m.from || "system") + (m.to && m.to !== "all" ? " to " + m.to : ""), detail: m.body, root: rec.cwd }))) : h("p", { class: "dim" }, "No channel activity for this agent yet."), state.sources.irc && !state.sources.irc.ok ? h("p", { class: "dim" }, "Channel source unavailable; counts may be incomplete.") : null);
  };
  const channelPanel = () => ChannelList({ messages: rec.messages, empty: "No messages to or from this agent.", root: rec.cwd, onPane: (id) => { const r = agentsStore.get(id); if (r) openAgentInspector(r); } });
  const filesPanel = () => FilesPanel({ root: rec.cwd, label: "agent", texts: [rec.task, ...rec.messages.slice(-30).map((m) => m.body)], chip: hpChip(rec) });
  const tasksPanel = () => (rec.tasks.length ? h("div", { class: "feed" }, rec.tasks.map((t) => FeedItem({ title: t.content, detail: t.phase || t.origin, status: t.status, onClick: () => { location.hash = "#/agents?lens=board"; } }))) : State({ variant: "empty", title: "No tasks", body: "Todos claimed by or assigned to this agent appear here.", inline: true }));
  const terminalPanel = () => {
    const st = agentsStore.getState();
    const wrap = h("div", { class: "insp-terminal" });
    if (st.layers.herdr.state === "down") return wrap.appendChild(DegradedState({ layer: "herdr", reason: st.layers.herdr.reason, inline: true, onStart: () => agentsStore.startHerdr(), onRecheck: () => agentsStore.recheck() })) && wrap;
    if (st.layers.webui.state === "down") {
      wrap.appendChild(DegradedState({ layer: "webui", busy, onRecheck: () => agentsStore.recheck(), onStart: async () => { busy = true; paint(); try { await api.post("herd/ensure", {}); toast("Terminal service started", { kind: "ok" }); } catch (e) { toastError(e, "Could not start the terminal service"); } busy = false; await agentsStore.recheck(); paint(); } }));
      return wrap;
    }
    if (st.layers.webui.none) {
      // No web UI on this runtime: show the seat's text instead of a frame. Kept across paints for the same pane (see paint()).
      if (!rec.pane_id) { wrap.appendChild(State({ variant: "empty", title: "No terminal", body: "This agent has no seat to read.", inline: true })); return wrap; }
      if (!cap || cap.dataset.pane !== rec.pane_id || !cap.isConnected) { if (cap) cap.stop(); cap = captureView(rec.pane_id); }
      wrap.append(cap, h("div", { class: "row insp-hint" }, h("span", { class: "dim grow" }, "Read-only view of this seat. Use the composer to send a prompt.")));
      return wrap;
    }
    const url = paneUrl(rec);
    if (!url) { wrap.appendChild(State({ variant: "empty", title: "No terminal link", body: "The agent runtime did not report a web address for this pane. Recheck in a moment.", inline: true })); return wrap; }
    if (!frame || frame.dataset.src !== url) {
      frame = h("iframe", { class: "pane-frame", src: url, title: "Terminal for " + rec.title, loading: "lazy", sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads", referrerpolicy: "no-referrer", allow: "clipboard-read; clipboard-write" });
      frame.dataset.src = url;
    }
    wrap.append(frame, h("div", { class: "row insp-hint" }, h("span", { class: "dim grow" }, "The terminal owns every key. Ctrl+Shift+\\ returns focus to the page."), consoleButton()));
    return wrap;
  };
  const builders = { now: nowPanel, channel: channelPanel, tasks: tasksPanel, files: filesPanel, terminal: terminalPanel };

  let termEl = null; // mounted on first open, kept in the DOM (hidden) so the iframe never reloads while the drawer is open
  let dyn = null;
  let composerState = null;
  function paintHead() {
    clear(head);
    head.append(HexGlyph(rec.state, { size: [14, 16] }), h("h2", { class: "truncate", title: rec.title }, rec.title), Badge({ status: rec.state }));
  }
  function paintComposer() {
    // The draft survives live updates: only rebuild when the agent's prompt-ability or the tab changes.
    const key = cur === "terminal" ? "none" : rec.state + ":" + rec.key;
    if (key === composerState) return;
    composerState = key;
    clear(composerHost);
    if (cur !== "terminal") composerHost.appendChild(Composer({ agent: rec, onSend: send, onOpenTerminal: () => { cur = "terminal"; paint(); if (onTab) onTab("terminal"); } }));
  }
  function paint() {
    paintHead();
    if (!dyn) { dyn = h("div", { class: "insp-panel-host" }); body.appendChild(dyn); }
    if (cur === "terminal") {
      dyn.hidden = true;
      const url = paneUrl(rec);
      const stateNow = agentsStore.getState();
      const noWeb = stateNow.layers.webui.none;
      const live = stateNow.layers.herdr.state !== "down" && (noWeb
        ? Boolean(cap) && cap.isConnected && cap.dataset.pane === rec.pane_id
        : frame && frame.isConnected && frame.dataset.src === url && stateNow.layers.webui.state !== "down");
      if (!termEl) { termEl = h("div", { ...tabPanelProps("terminal"), class: "insp-panel" }); body.appendChild(termEl); }
      if (!live) replace(termEl, builders.terminal());
      termEl.hidden = false;
    } else {
      if (termEl) termEl.hidden = true;
      dyn.hidden = false;
      replace(dyn, h("div", { ...tabPanelProps(cur), class: "insp-panel" }, builders[cur]()));
    }
    tabs.select(cur);
    paintComposer();
  }
  const node = Drawer({ title: rec.title, header: head, tabs, children: [body], footer: composerHost });
  node.classList.add("inspector-agent");
  node.update = (next) => {
    rec = next;
    paint();
  };
  node.setTab = (id) => { if (TABS.includes(id) && id !== cur) { cur = id; paint(); } };
  paint();
  return node;
}

let openInspectorNode = null;
let openInspectorKey = null;
let offStore = null;

// openAgentInspector(rec, { tab }): mounts the inspector in the shell's drawer region and keeps it live.
export function openAgentInspector(rec, opts) {
  const o = opts || {};
  if (openInspectorNode && openInspectorKey === rec.key) {
    if (o.tab) openInspectorNode.setTab(o.tab);
    return openInspectorNode;
  }
  const node = Inspector({ agent: rec, tab: o.tab, onTab: o.onTab });
  openInspectorNode = node;
  openInspectorKey = rec.key;
  if (offStore) offStore();
  offStore = agentsStore.subscribe((st) => {
    if (openInspectorNode !== node) return;
    const fresh = st.byKey.get(rec.key);
    if (fresh) node.update(fresh);
  });
  node._onCloseExtra = () => {
    if (offStore) offStore();
    offStore = null;
    openInspectorNode = null;
    openInspectorKey = null;
    if (o.onClose) o.onClose();
  };
  const prevClose = node._onClose;
  node._onClose = () => {
    if (prevClose) prevClose();
    node._onCloseExtra();
  };
  openDrawer(node, { focus: o.focus });
  return node;
}

export function closeAgentInspector() {
  return closeDrawer();
}

export { firstDownLayer, describeStatus, IconButton };
