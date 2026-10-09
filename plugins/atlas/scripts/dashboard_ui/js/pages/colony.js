// Colony (#/colony): the Atlas-scoped roster for the selected project. Data: GET /api/v2/colony?project=<root>[&all=1]
// -> { lead, members:[{ name, kind, state, pane_id, steerable, headless, channel, tasks, last_note, log_path, exit_code,
// ended_at }], herdr_url }. Send: POST colony/<name>/send {text, project}; Kill: POST colony/<name>/kill {project}. The raw herdr terminal
// is the separate #/terminal route (pages/herdr.js).

import { h, replace, fmtRelative } from "../dom.js";
import { Badge, Button, State, toast, toastError, confirm } from "../components.js";

const BADGE = { running: "working", idle: "idle", stuck: "input", finished: "done", dead: "fail", parked: "idle" };
const POLL_MS = 8000;
const S = { timer: null, dead: true, drafts: {} };

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
const terminalBtn = (ctx) => Button({ label: "Open terminal (herdr)", onClick: () => ctx.navigate("terminal") });
const pickProject = (ctx) => {
  const projects = (ctx.store && ctx.store.get("projects")) || [];
  const buttons = projects.map((p) => Button({ label: p.name || p.root, onClick: () => ctx.setProject(p.root, true) }));
  return State({ variant: "empty", title: "Pick a project", body: "The colony is one project's lead and workers. Choose the project:", action: h("div", { class: "row", style: { flexWrap: "wrap", maxHeight: "40vh", overflowY: "auto" } }, ...buttons, terminalBtn(ctx)) });
};
const noMembers = (ctx) => State({ variant: "empty", title: "No colony members yet", body: "Members appear here when atlas workers are dispatched into this project's channel. Turn on Show all herdr panes to see every herdr pane.", action: terminalBtn(ctx) });

async function load(ctx, st, project) {
  try {
    st.data = await ctx.api.get("colony", { project, all: st.all ? "1" : "" });
    st.error = null;
  } catch (e) {
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
    const r = await ctx.api.post("colony/" + encodeURIComponent(m.name) + "/send", sendBody(ctx, text));
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

async function killMember(ctx, m, refresh) {
  const ok = await confirm({ title: "Kill " + m.name + "?", body: "Stops this " + m.kind + " and closes its pane. Its unfinished work stays on the board.", danger: true, confirmLabel: "Kill" });
  if (!ok) return;
  try {
    await ctx.api.post("colony/" + encodeURIComponent(m.name) + "/kill", killBody(ctx));
    toast(m.name + " killed", { kind: "ok" });
  } catch (e) {
    toastError(e, "Could not kill " + m.name);
  }
  refresh();
}

export const NO_PANE = "No terminal pane is attached, so a message is not typed in: it is injected into the session on its next tool call. This says nothing about whether the session is working.";
const chip = (on, text, title, cls) => (on ? h("span", { class: "chip-lite" + (cls ? " " + cls : ""), title }, text) : null);

const parked = (m) => m.state === "parked" || m.parked === true;

function rowTop(m, onKill) {
  return h("div", { class: "colony-top" },
    h("strong", { class: "truncate", title: m.name }, m.name),
    h("span", { class: "chip-lite" }, m.kind),
    parked(m) ? Badge({ status: "idle", text: "parked" }) : Badge({ status: BADGE[m.state] || m.state, text: m.state }),
    chip(m.headless, "no terminal pane", NO_PANE),
    chip(m.steerable, "steerable", "Prompts reach it live"),
    chip(m.channel, m.channel, "Channel", "mono"),
    h("span", { class: "grow" }),
    canSteer(m) && m.kind !== "lead" ? Button({ label: "Kill", size: "sm", variant: "danger", ariaLabel: "Kill " + m.name, onClick: onKill }) : null);
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

function MemberRow(m, ctx, refresh) {
  const block = sendBlock(m);
  return h("li", { class: "colony-row", "data-kind": m.kind, "data-state": m.state },
    rowTop(m, () => killMember(ctx, m, refresh)),
    rowMeta(m),
    rowTasks(m),
    rowNote(m),
    rowSend(ctx, m, block, refresh),
    rowSent(m),
    sendWhy(m, block));
}

export default {
  id: "colony",
  title: "Colony",
  icon: "herd",
  group: "Operate",
  async load() {
    this.destroy();
    S.dead = false;
    return null;
  },
  render(ctx) {
    const st = { all: false, data: null, error: null };
    const root = () => ctx.params.project || ctx.project;
    const body = h("div", { class: "colony-body" });
    const toggle = h("input", { type: "checkbox", id: "colony-all", onChange: (e) => { st.all = e.target.checked; refresh(); } });
    const bar = h("div", { class: "colony-bar" },
      h("label", { class: "colony-all", for: "colony-all" }, toggle, " Show all herdr panes"),
      h("span", { class: "grow" }),
      Button({ label: "Open terminal (herdr)", size: "sm", icon: "external-link", onClick: () => ctx.navigate("terminal") }));
    const page = h("div", { class: "page colony-roster" }, h("h1", null, "Colony"), bar, body);

    function paint() {
      if (st.error) return replace(body, State({ variant: "error", error: st.error, onRetry: refresh }));
      if (!st.data) return replace(body, State({ variant: "loading", label: "colony", shape: "rows" }));
      replace(body, ...rosterNodes(st.data, ctx, refresh));
    }

    async function refresh() {
      if (S.dead) return;
      const project = root();
      if (needsProject(project)) {
        st.data = null;
        st.sig = "";
        return replace(body, pickProject(ctx));
      }
      await load(ctx, st, project);
      if (S.dead) return;
      // Repaint only when the data changed: a poll that finds nothing new must not rebuild rows (scroll, focus, drafts).
      const sig = JSON.stringify([st.error && String(st.error.message || st.error), st.data]);
      if (sig !== st.sig) {
        st.sig = sig;
        paint();
      }
    }

    paint();
    refresh();
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (!document.hidden && !document.querySelector(".colony-send-text:focus")) refresh(); }, POLL_MS);
    return page;
  },
  destroy() {
    S.dead = true;
    clearInterval(S.timer);
    S.timer = null;
  },
};
