// Colony (#/colony): the Atlas-scoped roster for the selected project. Data: GET /api/v2/colony?project=<root>[&all=1]
// -> { lead, members:[{ name, kind, state, pane_id, steerable, headless, channel, tasks, last_note, log_path, exit_code,
// ended_at }], herdr_url }. Send: POST colony/<name>/send {text, project}; Kill: POST colony/<name>/kill {project}. The raw herdr terminal
// is the separate #/terminal route (pages/herdr.js).

import { h, replace, fmtRelative } from "../dom.js";
import { Badge, Button, State, toast, toastError, confirm } from "../components.js";

const BADGE = { running: "working", idle: "idle", stuck: "input", finished: "done", dead: "fail" };
const POLL_MS = 8000;
const S = { timer: null, dead: true };

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
  return m.steerable || m.headless ? "" : "This member cannot receive messages.";
}

const needsProject = (p) => !p || p === "all";
const terminalBtn = (ctx) => Button({ label: "Open terminal (herdr)", onClick: () => ctx.navigate("terminal") });
const pickProject = (ctx) => State({ variant: "empty", title: "Pick a project", body: "The colony roster is per project. Choose one in the project selector, or open the herdr terminal for every pane.", action: terminalBtn(ctx) });
const noMembers = (ctx) => State({ variant: "empty", title: "No colony members yet", body: "Members appear here when atlas workers are dispatched into this project's channel. Turn on Show all herdr panes to see every herdr pane.", action: terminalBtn(ctx) });

async function load(ctx, st, project) {
  try {
    st.data = await ctx.api.get("colony", { project, all: st.all ? "1" : "" });
    st.error = null;
  } catch (e) {
    st.error = e;
  }
}

function rosterNodes(members, ctx, refresh) {
  if (!members.length) return [noMembers(ctx)];
  const lead = members.find((m) => m.kind === "lead");
  return [
    lead ? h("section", { class: "colony-lead", "aria-label": "Lead" }, h("ul", { class: "colony-list" }, MemberRow(lead, ctx, refresh))) : h("p", { class: "dim" }, "No lead is attached to this project."),
    h("ul", { class: "colony-list", "aria-label": "Workers" }, members.filter((m) => m !== lead).map((m) => MemberRow(m, ctx, refresh))),
  ];
}

const sentText = (m, r) => (r.delivered ? "Delivered to " + m.name : "Queued for " + m.name + (m.headless ? ": delivered on its next tool call" : ""));

async function sendMessage(ctx, m, box, btn) {
  const text = box.value.trim();
  if (!text) return;
  btn.disabled = true;
  try {
    const r = await ctx.api.post("colony/" + encodeURIComponent(m.name) + "/send", sendBody(ctx, text));
    box.value = "";
    toast(sentText(m, r), { kind: "ok" });
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

const chip = (on, text, title, cls) => (on ? h("span", { class: "chip-lite" + (cls ? " " + cls : ""), title }, text) : null);

function rowTop(m, onKill) {
  return h("div", { class: "colony-top" },
    h("strong", { class: "truncate", title: m.name }, m.name),
    h("span", { class: "chip-lite" }, m.kind),
    Badge({ status: BADGE[m.state] || m.state, text: m.state }),
    chip(m.headless, "headless", "No terminal: messages arrive on its next tool call"),
    chip(m.steerable, "steerable", "Prompts reach it live"),
    chip(m.channel, m.channel, "Channel", "mono"),
    h("span", { class: "grow" }),
    canSteer(m) ? Button({ label: "Kill", size: "sm", variant: "danger", ariaLabel: "Kill " + m.name, onClick: onKill }) : null);
}

const rowMeta = (m) => h("div", { class: "colony-meta dim" },
  hasExit(m) ? h("span", { class: "num" }, "exit " + m.exit_code) : null,
  m.ended_at ? h("span", { class: "num" }, "ended " + fmtRelative(m.ended_at * 1000)) : null,
  m.log_path ? h("span", { class: "mono truncate", title: m.log_path }, "log " + m.log_path) : null);

const taskItem = (t) => h("li", { "data-status": t.status }, h("span", { class: "mb-item-st" }, t.status), h("span", { class: "truncate", title: t.title }, t.title));
function rowTasks(m) {
  const tasks = m.tasks || [];
  return tasks.length ? h("ul", { class: "mb-items", "aria-label": m.name + " tasks" }, tasks.map(taskItem)) : h("p", { class: "dim colony-notasks" }, "No tasks assigned");
}

function rowNote(m) {
  const n = m.last_note;
  if (!n) return h("div", { class: "mb-note dim" }, "No notes yet");
  return h("div", { class: "mb-note", title: n.text }, h("span", { class: "agent-now-label" }, "Note"), h("span", { class: "truncate" }, n.text), n.ts ? h("span", { class: "dim num" }, fmtRelative(n.ts * 1000)) : null);
}

function rowSend(ctx, m, block) {
  const box = h("input", { class: "input colony-send-text", type: "text", "aria-label": "Message " + m.name, placeholder: block || (m.headless ? "Delivered on its next tool call" : "Message this member"), disabled: !!block });
  const sendBtn = Button({ label: "Send", size: "sm", disabled: !!block, onClick: (e) => sendMessage(ctx, m, box, e.currentTarget) });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendBtn.click(); } });
  return h("div", { class: "colony-send" }, box, sendBtn);
}

const sendWhy = (m, block) => (block ? h("p", { class: "dim colony-send-why" }, block) : m.headless ? h("p", { class: "dim colony-send-why" }, "Headless: delivered on its next tool call.") : null);

function MemberRow(m, ctx, refresh) {
  const block = sendBlock(m);
  return h("li", { class: "colony-row", "data-kind": m.kind, "data-state": m.state },
    rowTop(m, () => killMember(ctx, m, refresh)),
    rowMeta(m),
    rowTasks(m),
    rowNote(m),
    rowSend(ctx, m, block),
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
      replace(body, ...rosterNodes(st.data.members || [], ctx, refresh));
    }

    async function refresh() {
      if (S.dead) return;
      const project = root();
      if (needsProject(project)) {
        st.data = null;
        return replace(body, pickProject(ctx));
      }
      await load(ctx, st, project);
      if (!S.dead) paint();
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
