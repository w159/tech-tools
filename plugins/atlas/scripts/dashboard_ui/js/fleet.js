// Fleet components (MASTER 3, 7.1, 9.2, 9.3, 9.6): Fleet Strip, agent row, agent card, rail tree, inspector.
// All take AgentRecords from agents-store.js. No top-level use of components.js (it re-exports this module).

import { h, icon, clear, replace, copyText } from "./dom.js";
import { api } from "./api.js";
import { HexGlyph, describeStatus } from "./glyphs.js";
import { agentsStore, STATE_WORD, ageSeconds, firstDownLayer } from "./agents-store.js";
import { Badge, Button, IconButton, Tabs, tabPanelProps, State, DegradedState } from "./ui-core.js";
import { Drawer, openDrawer, closeDrawer, openMenu, openPopover, closePopover, toast, toastError } from "./ui-overlays.js";
import { ChannelList, Composer, FeedItem } from "./ui-data.js";
import { renamePane, renameTab, closePane, closeTab, renameWorkspace, closeWorkspace, newTab, hostReachable, QUICK_KEYS, sendKeys } from "./herdr-actions.js";
import { FilesPanel, hpThreadFor, openEditor } from "./integrations.js";

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

// "folder@branch" display for a path; branch comes from the project's main channel when known.
export function folderOf(p) {
  return String(p || "").replace(/\/+$/, "").split("/").pop() || "";
}

export function kindIcon(kind) {
  return icon("kind-" + kind, { class: "icon kind-icon", "aria-hidden": "true" });
}

const KIND_WORD = { omp: "omp", claude: "Claude Code", codex: "Codex", shell: "Shell", unknown: "Agent" };
export const kindWord = (k) => KIND_WORD[k] || KIND_WORD.unknown;

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
  const root = h("div", { class: "fleet-strip", role: "toolbar", "aria-label": "Fleet" });
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
  return { label: "", text: a.state === "working" ? "Working, no task recorded" : "No task recorded" };
}

// state word + duration: "Working 12m", "Ready 3h"
export function stateFor(a) {
  const age = ageLabel(a);
  return STATE_WORD[a.state] + (age ? " " + age : "");
}

// AgentCard({ agent, selected, onOpen, onTerminal, actions, channel, parent, onParent }): fluid. Click body opens the inspector;
// the primary button opens the Terminal tab. Border turns --st-input / --st-fail for needs-input / failed.
// channel: short alias of the agent's channel (or ""), parent: parent record (or null).
export function AgentCard({ agent: a, selected, onOpen, onTerminal, actions, channel, parent, onParent } = {}) {
  const now = nowLine(a);
  const kids = a.children || [];
  const chips = [
    h("span", { class: "chip-lite" }, kindIcon(a.kind), kindWord(a.kind)),
    channel ? h("span", { class: "chip-lite", title: "Channel " + channel.full }, icon("irc"), channel.alias) : null,
    a.colony ? h("span", { class: "chip-lite" }, "colony") : null,
    hpChip(a),
    parent ? h("button", { class: "chip-lite chip-link", type: "button", title: "Parent " + parent.title, onClick: (e) => { e.stopPropagation(); onParent && onParent(parent); } }, "under " + parent.title) : null,
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

// ---- 7.1 rail tree: host > workspace > agent > subagent ------------------------------------------------------

const TREE_AUTO_COLLAPSE = 40;

// RailTree({ onSelect(rec, {terminal}), selectedKey }) -> role=tree; .update(storeState, selectedKey)
// Up/Down move, Right/Left expand/collapse, Enter selects, Shift+Enter opens the Terminal tab.
export function RailTree({ onSelect, onRecheck } = {}) {
  const root = h("div", { class: "rail-tree", role: "tree", "aria-label": "Agents" });
  const open = new Map(); // workspace id -> bool (user choice)
  let last = null;
  let sel = null;
  const items = () => Array.from(root.querySelectorAll('[role="treeitem"]')).filter((x) => x.offsetParent !== null);
  const focusAt = (n) => {
    const list = items();
    list.forEach((x) => (x.tabIndex = -1));
    if (list[n]) { list[n].tabIndex = 0; list[n].focus(); }
  };
  const agentItem = (a, depth) => {
    const kids = a.children || [];
    const li = h("div", { class: "tree-row tree-agent", role: "treeitem", "aria-level": String(depth), "aria-selected": sel === a.key ? "true" : "false", "data-state": a.state, "data-key": a.key, tabindex: "-1", style: { "--depth": depth }, "aria-label": agentLabel(a), onClick: () => onSelect && onSelect(a, {}) }, HexGlyph(a.state, { size: depth > 3 ? [12, 14] : "mini" }), kindIcon(a.kind), h("span", { class: "tree-label truncate", title: a.title }, a.title), h("span", { class: "tree-age num dim" }, ageLabel(a)));
    li.dataset.fresh = last && last.changed.has(a.key) ? "true" : "";
    return [li, ...kids.flatMap((c) => agentItem(c, depth + 1))];
  };
  const draw = () => {
    const st = last;
    clear(root);
    if (!st) return;
    const host = h("div", { class: "tree-row tree-host", role: "treeitem", "aria-level": "1", "aria-expanded": "true", tabindex: "-1" }, h("span", { class: "tree-dot", "data-up": st.layers.herdr.state === "up" ? "true" : "false", "aria-hidden": "true" }), h("span", { class: "tree-label truncate" }, "This machine"), h("span", { class: "tree-tag dim" }, "Host"));
    root.appendChild(host);
    if (!st.loaded) { root.appendChild(h("p", { class: "tree-note dim", role: "status" }, "Loading agents")); return; }
    if (st.layers.herdr.state === "down") {
      root.appendChild(h("div", { class: "tree-note" }, h("p", null, "herdr isn't running"), h("p", { class: "dim" }, "Atlas can't list agents without it."), Button({ label: "Recheck", size: "sm", onClick: onRecheck })));
      return;
    }
    if (!st.tree.length) { root.appendChild(h("p", { class: "tree-note dim" }, "No agents running")); return; }
    const many = st.agents.length > TREE_AUTO_COLLAPSE;
    for (const w of st.tree) {
      const hasSel = w.agents.some((a) => a.key === sel);
      const isOpen = open.has(w.id) ? open.get(w.id) : !many || hasSel;
      const wsMenu = h("button", { class: "btn btn-ghost btn-icon row-menu", type: "button", "aria-label": "Actions for workspace " + w.label, "aria-haspopup": "menu", onClick: (e) => { e.stopPropagation(); openMenu(wsMenu, [{ label: "New tab", icon: "plus", onSelect: () => newTab(w.id) }, { label: "Rename workspace", icon: "edit", onSelect: () => renameWorkspace(w.id, w.label) }, { label: "Close workspace", icon: "stop", danger: true, onSelect: () => closeWorkspace(w.id, w.label) }], { placement: "end", label: "Actions for workspace " + w.label }); } }, icon("more"));
      const wr = h("div", { class: "tree-row tree-ws", role: "treeitem", "aria-level": "2", "aria-expanded": isOpen ? "true" : "false", tabindex: "-1", "data-id": w.id, onClick: () => { open.set(w.id, !isOpen); draw(); } }, icon(isOpen ? "chevron-down" : "chevron-right", { class: "icon tree-chev" }), h("span", { class: "tree-label truncate" }, w.label), h("span", { class: "tree-count num dim" }, String(w.paneCount || w.agents.length)), HexGlyph(w.state, { size: "mini" }), wsMenu);
      root.appendChild(wr);
      if (isOpen) for (const a of w.agents) for (const n of agentItem(a, 3)) root.appendChild(n);
    }
    const all = items();
    const idx = Math.max(0, all.findIndex((x) => x.dataset.key === sel));
    if (all[idx]) all[idx].tabIndex = 0;
  };
  root.addEventListener("keydown", (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const cur = list[i];
    if (e.key === "ArrowDown") { e.preventDefault(); focusAt(Math.min(list.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(Math.max(0, i - 1)); }
    else if (e.key === "ArrowRight" && cur.classList.contains("tree-ws") && cur.getAttribute("aria-expanded") === "false") { e.preventDefault(); open.set(cur.dataset.id, true); draw(); }
    else if (e.key === "ArrowLeft" && cur.classList.contains("tree-ws") && cur.getAttribute("aria-expanded") === "true") { e.preventDefault(); open.set(cur.dataset.id, false); draw(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (cur.dataset.key) { const rec = agentsStore.get(cur.dataset.key); if (rec && onSelect) onSelect(rec, { terminal: e.shiftKey }); }
      else cur.click();
    }
  });
  root.update = (st, selectedKey) => {
    last = st;
    sel = selectedKey || null;
    const had = root.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    draw();
    if (had) { const el = root.querySelector('[data-key="' + CSS.escape(had) + '"]'); if (el) { el.tabIndex = 0; el.focus(); } }
  };
  return root;
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

// Full herdr-web-ui (?chrome=full): hosted unmodified by the Colony route (pages/herdr.js).
export function consoleUrl(base, pane) {
  if (!base && !GATEWAY) return "";
  const u = toHost(new URL(base || location.origin, location.href));
  u.searchParams.set("chrome", "full");
  u.searchParams.set("theme", frameTheme());
  if (pane) { u.searchParams.set("pane", pane); u.searchParams.set("machine", "local"); }
  return u.toString();
}

const TABS = ["now", "channel", "tasks", "files", "terminal"];

// Inspector({ agent, tab, onTab(id), store }) -> Drawer node. Re-render with .update(agent, state).
// Terminal tab: lazy iframe, mounted on first open, alive while the drawer is open; webui down -> inline layer-3 state only.
export function Inspector({ agent, tab, onTab } = {}) {
  let rec = agent;
  let cur = TABS.includes(tab) ? tab : "now";
  let frame = null;
  let busy = false;
  const body = h("div", { class: "insp-panels" });
  const tabs = Tabs({ label: "Agent detail", tabs: [{ id: "now", label: "Now" }, { id: "channel", label: "Channel" }, { id: "tasks", label: "Tasks" }, { id: "files", label: "Files" }, { id: "terminal", label: "Terminal" }], active: cur, onChange: (id) => { cur = id; paint(); if (onTab) onTab(id); } });
  const head = h("div", { class: "insp-head grow" });
  const composerHost = h("div", { class: "insp-composer" });

  const send = async (mode, text) => {
    if (mode === "prompt") {
      await api.post("herd/agents/" + encodeURIComponent(rec.pane_id) + "/prompt", { text });
      toast("Prompt sent to " + rec.name + " in " + (rec.workspace || "workspace"), { kind: "ok" });
    } else {
      const res = await api.post("irc", { project: rec.project || "all", to: rec.name, body: text, from: "human" });
      toast(res && res.delivered ? "Posted to " + rec.name : "Posted to the channel", { kind: "ok", why: res && res.next });
      agentsStore.refresh(["irc"]);
    }
  };

  const consoleButton = () => Button({ label: "Open in Colony", size: "sm", icon: "external-link", onClick: () => { location.hash = "#/colony?pane=" + encodeURIComponent(rec.pane_id || rec.key); } });
  const nowPanel = () => {
    const state = agentsStore.getState();
    const rows = [["State", Badge({ status: rec.state })], ["Age", (ageLabel(rec) || "n/a") + (rec.sinceApprox ? " (since this page opened)" : "")], ["Kind", kindWord(rec.kind)], ["Workspace", rec.workspace || ""], ["Pane", h("span", { class: "mono" }, rec.pane_id)], ["Directory", h("span", { class: "mono cwd", title: rec.cwd }, rec.cwd, h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": "Copy directory", onClick: () => copyText(rec.cwd) }, icon("copy")))], ["Project", rec.project ? rec.project.split("/").pop() : "None matched"], ["Latest task", rec.task || "No task recorded"]];
    const recent = rec.messages.slice(-5).reverse();
    const keysRow = rec.pane_id ? h("div", { class: "row insp-keys", role: "group", "aria-label": "Send keys" }, h("span", { class: "dim" }, "Send keys"), QUICK_KEYS.map(([label, keys]) => Button({ label, size: "sm", disabled: !hostReachable(), title: hostReachable() ? "Send " + label + " to this pane" : "Needs Atlas opened through the herdr host (/atlas/)", onClick: () => sendKeys(rec.pane_id, keys) }))) : null;
    return h("div", { class: "insp-now" }, h("dl", { class: "kv" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])), h("div", { class: "row" }, consoleButton()), keysRow, h("h3", null, "Recent activity"), recent.length ? h("div", { class: "feed" }, recent.map((m) => FeedItem({ ts: m.ts, kind: "message", title: (m.from || "system") + (m.to && m.to !== "all" ? " to " + m.to : ""), detail: m.body, root: rec.cwd }))) : h("p", { class: "dim" }, "No channel activity for this agent yet."), state.sources.irc && !state.sources.irc.ok ? h("p", { class: "dim" }, "Channel source unavailable; counts may be incomplete.") : null);
  };
  const channelPanel = () => ChannelList({ messages: rec.messages, empty: "No messages to or from this agent.", root: rec.cwd, onPane: (id) => { const r = agentsStore.get(id); if (r) openAgentInspector(r); } });
  const filesPanel = () => FilesPanel({ root: rec.cwd, label: "agent", texts: [rec.task, ...rec.messages.slice(-30).map((m) => m.body)], chip: hpChip(rec) });
  const tasksPanel = () => (rec.tasks.length ? h("div", { class: "feed" }, rec.tasks.map((t) => FeedItem({ title: t.content, detail: t.phase || t.origin, status: t.status, onClick: () => { location.hash = "#/agents?lens=board"; } }))) : State({ variant: "empty", title: "No tasks", body: "Todos claimed by or assigned to this agent appear here.", inline: true }));
  const terminalPanel = () => {
    const st = agentsStore.getState();
    const wrap = h("div", { class: "insp-terminal" });
    if (st.layers.herdr.state === "down") return wrap.appendChild(DegradedState({ layer: "herdr", reason: st.layers.herdr.reason, inline: true, onRecheck: () => agentsStore.recheck() })) && wrap;
    if (st.layers.webui.state === "down") {
      wrap.appendChild(DegradedState({ layer: "webui", busy, onRecheck: () => agentsStore.recheck(), onStart: async () => { busy = true; paint(); try { await api.post("herd/ensure", {}); toast("Terminal service started", { kind: "ok" }); } catch (e) { toastError(e, "Could not start the terminal service"); } busy = false; await agentsStore.recheck(); paint(); } }));
      return wrap;
    }
    const url = paneUrl(rec);
    if (!url) { wrap.appendChild(State({ variant: "empty", title: "No terminal link", body: "herdr did not report a web address for this pane. Recheck in a moment.", inline: true })); return wrap; }
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
      const live = frame && frame.isConnected && frame.dataset.src === url && stateNow.layers.webui.state !== "down" && stateNow.layers.herdr.state !== "down";
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
