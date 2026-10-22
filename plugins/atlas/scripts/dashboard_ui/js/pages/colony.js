// Colony (#/colony): the Atlas-scoped roster for the selected project. Data: GET /api/v2/colony?project=<root>[&all=1]
// -> { lead, members:[{ name, kind, state, pane_id, steerable, headless, channel, tasks, last_note, log_path, exit_code,
// ended_at }], herdr_url }. Send: POST colony/<name>/send {text, project}; Kill: POST colony/<name>/kill {project}. The live terminal workspace
// is the separate #/terminal route (pages/terminal.js).

import { h, replace, fmtRelative } from "../dom.js";
import { reportFetchFail, clearFetchFail } from "../fetch-fail.js";
import { spaceName, seatAddress, sourceLine } from "./terminal.js";
import { Badge, Button, State, toast, toastError } from "../components.js";
import { sendToMember, killSeat, waveAction } from "../send-path.js";

const BADGE = { running: "working", idle: "idle", stuck: "input", finished: "done", dead: "fail", parked: "idle" };
const S = { dead: true, drafts: {} };

export const canSteer = (m) => m.state === "running" || m.state === "idle" || m.state === "stuck";

// POST bodies: the server resolves the project from the body (api.post sends no query string).
export const projectOf = (ctx) => ctx.params.project || ctx.project;
export const sendBody = (ctx, text) => ({ text, project: projectOf(ctx) });
export const killBody = (ctx) => ({ project: projectOf(ctx) });

// Why the Send box is off, or "" when it is on.
const hasExit = (m) => m.exit_code !== null && m.exit_code !== undefined;
const finishedBlock = (m) => "Finished" + (hasExit(m) ? " (exit " + m.exit_code + ")" : "") + ": nothing to send to.";
const BLOCKED = { finished: finishedBlock, dead: () => "This member is gone: nothing to send to." };
export function sendBlock(m) {
  const why = BLOCKED[m.state];
  if (why) return why(m);
  if (m.deliver && m.deliver.ok === false) return m.deliver.reason;
  return m.steerable || m.headless ? "" : "This member cannot receive messages.";
}

const needsProject = (p) => !p || p === "all";
const terminalBtn = (ctx) => Button({ label: "Open terminal", onClick: () => ctx.navigate("terminal") });
// All projects: every live colony from the shared term snapshot, grouped by project, each member with a terminal deep link.
export function colonyGroups(snap) {
  const byProject = new Map();
  for (const c of (snap && snap.colonies) || []) {
    const key = c.project || (snap && snap.project) || "";
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push({ colony: c, seats: ((snap && snap.seats) || []).filter((s) => s.colony === c.id) });
  }
  return [...byProject].map(([project, colonies]) => ({ project, name: project.split("/").filter(Boolean).pop() || project, colonies }));
}
const allProjects = (snap, ctx) => {
  const groups = colonyGroups(snap);
  if (!groups.length) return State({ variant: "empty", title: "No live colonies in any project", body: "Start one from your agent and it appears here with its members.", action: terminalBtn(ctx) });
  return h("div", { class: "colony-all-projects" }, ...groups.map((g) => h("section", { class: "colony-group" },
    h("h2", { title: g.project }, g.name),
    ...g.colonies.map(({ colony, seats }) => h("div", { class: "colony-card" + (colony.finished ? " is-finished" : "") },
      h("div", { class: "colony-top" }, h("strong", { title: colony.id }, spaceName(colony)), colony.finished ? h("span", { class: "tw-fin" }, "finished") : null, h("span", { class: "dim truncate" }, colony.title || colony.task || ""), h("span", { class: "grow" }),
        Button({ label: "Open terminal", size: "sm", ariaLabel: "Open terminal for " + spaceName(colony), onClick: () => ctx.navigate("terminal", { space: colony.id, project: g.project }) })),
      sourceLine(colony) ? h("div", { class: "dim colony-source" }, sourceLine(colony)) : null,
      ...seats.map((s) => h("div", { class: "colony-top" }, h("span", { class: "truncate", title: s.name }, seatAddress(s)), h("span", { class: "chip-lite" }, s.role_title || s.role || "worker"), Badge({ status: BADGE[s.state] || s.state, text: s.state }),
        h("span", { class: "grow" }),
        Button({ label: "Open terminal", size: "sm", ariaLabel: "Open terminal for " + seatAddress(s), onClick: () => ctx.navigate("terminal", { ...terminalParams({ colony: colony.id, name: s.name }), project: g.project }) }))))))));
};
const noMembers = (ctx) => State({ variant: "empty", title: "No colony members yet", body: "Members appear here when atlas workers are dispatched into this project's channel. Turn on Show all panes to see every pane.", action: terminalBtn(ctx) });

async function load(ctx, st, project) {
  try {
    st.data = await ctx.api.get("colony", { project, all: st.all ? "1" : "" });
    st.error = null;
    clearFetchFail("colony");
  } catch (e) {
    reportFetchFail("colony", "colony", e);
    st.error = e;
  }
}

const STATES = "running = working, idle = waiting for input, stuck = live but silent for 15 min with open todos, parked = a returned subagent with no terminal and 10+ min of silence; it reads nothing until revived, so Send is disabled, finished / dead = exited (nothing can read a message). \"no terminal pane\" means no terminal is attached: a message is delivered through the member's next tool call, not by typing into it.";
const intro = (d) => h("section", { class: "colony-intro" },
  h("p", { class: "dim" }, "The colony is the lead agent plus the workers it dispatched into this project's current channel. Send writes a message to the channel board addressed to one member; the member reads it on its next tool call (or it is typed into its terminal when it runs an idle claude/omp pane). Under each message you see whether it was delivered. " + STATES),
  d.channel
    ? h("p", { class: "colony-chan" }, "Current channel ", h("strong", { class: "mono" }, d.channel.name), " \u00B7 lead ", h("strong", null, d.channel.lead), " \u00B7 " + d.channel.members + (d.channel.members === 1 ? " worker" : " workers") + " \u00B7 project ", h("span", { class: "mono" }, d.project))
    : h("p", { class: "dim" }, "No lead has opened a channel in this project yet, so nobody can be messaged here."));

function rosterNodes(d, ctx, refresh) {
  const members = d.members || [];
  if (!members.length) return [intro(d), noMembers(ctx)];
  const lead = members.find((m) => m.kind === "lead");
  return [
    intro(d),
    lead ? h("section", { class: "colony-lead", "aria-label": "Lead" }, h("ul", { class: "colony-list" }, MemberRow(lead, ctx, refresh))) : h("p", { class: "dim" }, "No lead is attached to this project."),
    h("ul", { class: "colony-list", "aria-label": "Workers" }, members.filter((m) => m !== lead).map((m) => MemberRow(m, ctx, refresh))),
  ];
}

const sentText = (m, r) => (r.message && r.message.delivery_text) || (r.delivered ? "Delivered to " + m.name : "Queued for " + m.name);

async function sendMessage(ctx, m, box, btn, refresh) {
  const text = box.value.trim();
  if (!text) return;
  btn.disabled = true;
  try {
    const r = await sendToMember(ctx, m.name, text);
    box.value = "";
    delete S.drafts[m.name];
    toast(sentText(m, r), { kind: "ok" });
    refresh();
  } catch (e) {
    toastError(e, "Could not send to " + m.name);
  } finally {
    btn.disabled = false;
  }
}

// Test seam: lets tests inject api/confirm into killSeat/waveAction; empty in production.
export const rosterDeps = {};

async function killMember(ctx, m, refresh) {
  await killSeat({ name: m.name, kind: m.kind, project: projectOf(ctx) }, rosterDeps);
  refresh();
}

async function waveMember(ctx, m, verb, refresh) {
  await waveAction(verb, { name: m.name, project: projectOf(ctx) }, rosterDeps);
  refresh();
}

export const NO_PANE = "No terminal pane is attached, so a message is not typed in: it is injected into the session on its next tool call. This says nothing about whether the session is working.";
const chip = (on, text, title, cls) => (on ? h("span", { class: "chip-lite" + (cls ? " " + cls : ""), title }, text) : null);

const parked = (m) => m.state === "parked" || m.parked === true;

// Deep link into the Terminal workspace; without a colony id the page finds the seat in its snapshot.
export const terminalParams = (m) => (m.colony ? { space: m.colony, seat: m.name } : { seat: m.name });

// Pause/Resume/Cancel act on a worker's wave hold (the lead cannot be held); Resume replaces Pause once it is paused or canceled.
const waveButtons = (m, onWave) => (m.kind === "lead" || !canSteer(m) ? null : [
  m.paused || m.canceled
    ? Button({ label: "Resume", size: "sm", ariaLabel: "Resume " + m.name, onClick: () => onWave("resume") })
    : Button({ label: "Pause", size: "sm", ariaLabel: "Pause " + m.name, onClick: () => onWave("pause") }),
  m.canceled ? null : Button({ label: "Cancel", size: "sm", variant: "danger", ariaLabel: "Cancel " + m.name, onClick: () => onWave("cancel") }),
]);

function rowTop(m, onKill, onTerm, onWave) {
  return h("div", { class: "colony-top" },
    h("strong", { class: "truncate", title: m.name }, m.address || m.name),
    h("span", { class: "chip-lite" }, m.kind),
    parked(m) ? Badge({ status: "idle", text: "parked" }) : Badge({ status: BADGE[m.state] || m.state, text: m.state }),
    chip(m.headless, "no terminal pane", NO_PANE),
    chip(m.steerable, "steerable", "Prompts reach it live"),
    chip(m.channel, m.channel, "Channel", "mono"),
    h("span", { class: "grow" }),
    Button({ label: "Open terminal", size: "sm", ariaLabel: "Open terminal for " + m.name, onClick: onTerm }),
    waveButtons(m, onWave),
    canSteer(m) && m.kind !== "lead" ? Button({ label: "Stop", size: "sm", variant: "danger", ariaLabel: "Stop " + m.name, onClick: onKill }) : null);
}

// The lead's "active, last tool call 12s ago" / "idle 7 min": real session signals, shown beside (never instead of) the pane chip.
export const livenessText = (m) => (m.liveness && m.liveness.text) || "";

const rowMeta = (m) => h("div", { class: "colony-meta dim" },
  m.liveness ? h("span", { class: "num colony-live", "data-active": m.liveness.active ? "true" : "false", title: "From its newest " + m.liveness.source + ", not from a terminal pane" }, livenessText(m)) : null,
  m.last_active ? h("span", { class: "num", title: "Last activity: a note, a todo update or its join" }, (parked(m) ? "last seen " : "last active ") + fmtRelative(m.last_active * 1000)) : null,
  hasExit(m) ? h("span", { class: "num" }, "exit " + m.exit_code) : null,
  m.ended_at ? h("span", { class: "num" }, "ended " + fmtRelative(m.ended_at * 1000)) : null,
  m.log_path ? h("span", { class: "mono truncate", title: m.log_path }, "log " + m.log_path) : null);

const taskItem = (t) => h("li", { "data-status": t.status }, h("span", { class: "mb-item-st" }, t.status), h("span", { class: "truncate", title: t.title }, t.title));
function rowTasks(m) {
  const all = m.tasks || [];
  const open = all.filter((t) => t.status !== "completed" && t.status !== "done");
  const hidden = all.length - open.length;
  const shown = open.slice(0, 8);
  if (!all.length) return h("p", { class: "dim colony-notasks" }, "No tasks assigned");
  return h("div", null,
    shown.length ? h("ul", { class: "mb-items", "aria-label": m.name + " tasks" }, shown.map(taskItem)) : null,
    h("p", { class: "dim colony-notasks" }, [open.length > shown.length ? "+" + (open.length - shown.length) + " more open" : "", hidden ? hidden + " completed" : "", !open.length ? "nothing open" : ""].filter(Boolean).join(" \u00B7 ")));
}

function rowNote(m) {
  const n = m.last_note;
  if (!n) return h("div", { class: "mb-note dim" }, "No notes yet");
  return h("div", { class: "mb-note", title: n.text }, h("span", { class: "agent-now-label" }, "Note"), h("span", { class: "truncate" }, n.text), n.ts ? h("span", { class: "dim num" }, fmtRelative(n.ts * 1000)) : null);
}

function rowSend(ctx, m, block, refresh) {
  const box = h("input", { class: "input colony-send-text", type: "text", "aria-label": "Message " + m.name, placeholder: block || "Message " + m.name, disabled: !!block });
  box.value = S.drafts[m.name] || "";
  box.addEventListener("input", () => { S.drafts[m.name] = box.value; });
  const sendBtn = Button({ label: "Send", size: "sm", disabled: !!block, onClick: (e) => sendMessage(ctx, m, box, e.currentTarget, refresh) });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendBtn.click(); } });
  return h("div", { class: "colony-send" }, box, sendBtn);
}

const sendWhy = (m, block) => (block ? h("p", { class: "dim colony-send-why" }, block) : m.deliver && m.deliver.reason ? h("p", { class: "dim colony-send-why" }, m.deliver.reason) : null);

// The newest message you sent this member and where it stands (queued / delivered at HH:MM:SS / not deliverable), from the board's delivery receipts.
const rowSent = (m) => {
  const s = m.last_sent;
  if (!s) return null;
  return h("div", { class: "colony-sent dim", "data-status": s.status, title: s.body },
    h("span", { class: "agent-now-label" }, "You sent"),
    h("span", { class: "truncate" }, s.body),
    h("span", { class: "num" }, fmtRelative(Date.parse(s.ts))),
    h("strong", { class: "colony-sent-st" }, s.delivery_text || s.status));
};

// The seat picked by a deep link (?seat=<name>, or ?agent=<name|pane id>); no param selects nothing.
const isSelected = (ctx, m) => { const want = ctx.params.seat || ctx.params.agent; return Boolean(want) && (want === m.name || want === m.pane_id); };

export function MemberRow(m, ctx, refresh) {
  const block = sendBlock(m);
  return h("li", { class: "colony-row", "data-kind": m.kind, "data-state": m.state, "data-selected": isSelected(ctx, m) ? "true" : null },
    rowTop(m, () => killMember(ctx, m, refresh), () => ctx.navigate("terminal", terminalParams(m)), (verb) => waveMember(ctx, m, verb, refresh)),
    rowMeta(m),
    rowTasks(m),
    rowNote(m),
    rowSend(ctx, m, block, refresh),
    rowSent(m),
    sendWhy(m, block));
}

// Roster lens body for the Agents page. No timer: the page calls refresh() on SSE herd/agents events (and on its poll tick when SSE is down).
// Header Pause/Resume/Cancel act on every live worker (never the lead); Cancel confirms once per worker via waveAction.
export async function waveAll(ctx, verb, members) {
  const workers = (members || []).filter((m) => m.kind !== "lead" && canSteer(m));
  for (const m of workers) await waveAction(verb, { name: m.name, project: projectOf(ctx) }, rosterDeps);
  return workers.length;
}

export function mountRoster(ctx, body, opts = {}) {
  const st = { all: false, data: null, error: null };
  S.dead = false;
  const toggle = h("input", { type: "checkbox", id: "colony-all", onChange: (e) => { st.all = e.target.checked; refresh(); } });
  const bar = h("div", { class: "colony-bar" },
    h("label", { class: "colony-all", for: "colony-all" }, toggle, " Show all panes"),
    h("span", { class: "grow" }),
    ...["pause", "resume", "cancel"].map((verb) => Button({ label: verb[0].toUpperCase() + verb.slice(1), size: "sm", variant: verb === "cancel" ? "danger" : undefined, ariaLabel: verb + " all workers", onClick: async () => { await waveAll(ctx, verb, st.data && st.data.members); refresh(); } })),
    Button({ label: "Open terminal", size: "sm", icon: "external-link", onClick: () => ctx.navigate("terminal") }));
  const list = h("div", { class: "colony-body" });
  replace(body, h("div", { class: "colony-roster" }, bar, list));

  function paint() {
    if (st.error) return replace(list, State({ variant: "error", error: st.error, onRetry: refresh }));
    if (!st.data) return replace(list, State({ variant: "loading", label: "colony", shape: "rows" }));
    replace(list, ...rosterNodes(st.data, ctx, refresh));
  }

  async function refresh() {
    if (S.dead) return;
    const project = projectOf(ctx);
    if (needsProject(project)) {
      try { st.all_snap = await ctx.api.get("term/snapshot", { all: "1" }); st.error = null; } catch (e) { st.error = e; }
      if (S.dead) return;
      const sig = JSON.stringify([st.error && String(st.error.message || st.error), st.all_snap]);
      if (sig === st.sig) return;
      st.sig = sig;
      return st.error ? paint() : replace(list, allProjects(st.all_snap, ctx));
    }
    await load(ctx, st, project);
    if (S.dead) return;
    // Repaint only when the data changed: a refresh that finds nothing new must not rebuild rows (scroll, focus, drafts).
    const sig = JSON.stringify([st.error && String(st.error.message || st.error), st.data]);
    if (sig === st.sig) return;
    st.sig = sig;
    if (opts.onMembers && st.data) opts.onMembers(st.data.members || []);
    if (!document.querySelector(".colony-send-text:focus")) paint();
  }

  paint();
  refresh();
  return { refresh, destroy: () => { S.dead = true; } };
}
