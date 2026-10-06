// Colony: rigs (runs) and agents (seats) with live state, agent drawer with pane capture,
// notes, linked todos, guarded send box, kill with confirm, copy tmux attach command.

import { h, icon, clear, copyText, debounce, fmtDuration, fmtRelative, fmtTime, statusLabel } from "../dom.js";
import { Badge, StatusDot, Card, EmptyState, Terminal, Timeline, Drawer, confirm, toast, toastError, CommandBlock } from "../components.js";

const STATE_ORDER = ["needs_input", "failed", "working", "idle", "exited", "unknown"];

// A dashboard message to this agent is queued until the worker's hook drains it (then read), delivered
// when typed into an interactive pane, or refused when the pane is not steerable.
// Everything else in the notes list has no reader to wait for, so it carries no delivery tag.
const DELIVERY = ["queued", "read", "delivered", "refused"];

function waitsForAgent(n, name) {
  return n.from === "human" && n.to === name && DELIVERY.includes(n.status);
}

function noteItems(notes, name) {
  return (notes || []).slice(-30).reverse().map((n) => {
    const waits = waitsForAgent(n, name);
    return {
      ts: fmtTime(n.ts),
      title: n.from ? n.from + (n.to ? " to " + n.to : "") : "note",
      detail: n.body || n.text || n.content || "",
      status: waits ? (n.status === "queued" ? "open" : n.status === "refused" ? "fail" : "done") : n.kind === "exit" ? "idle" : "info",
      meta: waits ? n.status : null,
    };
  });
}

let drawerTimer = null;
let drawerKey = "";
let refresher = null;
let lastData = null;

function stopDrawerPolling() {
  clearInterval(drawerTimer);
  drawerTimer = null;
  drawerKey = "";
}

function countBadges(counts) {
  const c = counts || {};
  return h(
    "div",
    { class: "colony-counts", role: "group", "aria-label": "Agent states" },
    STATE_ORDER.filter((k) => c[k] !== undefined).map((k) =>
      Badge({ status: k, text: (k === "unknown" ? "Unknown / stale" : statusLabel(k)) + " " + c[k] })
    )
  );
}

function agentCard(rig, agent, ctx) {
  const stuck = agent.stuck && agent.stuck.is_stuck;
  return h(
    "button",
    {
      class: "agent",
      type: "button",
      "data-state": agent.state,
      "aria-label": agent.name + ", " + statusLabel(agent.state) + (stuck ? ", looks stuck" : ""),
      onClick: () => openAgent(rig, agent, ctx),
    },
    h("span", { class: "agent-top" }, StatusDot({ status: agent.state }), h("span", { class: "agent-name truncate" }, agent.name), h("span", { class: "agent-state" }, statusLabel(agent.state))),
    h("span", { class: "agent-foot" }, h("span", { class: "tag" }, agent.role || "agent"), h("span", { class: "tag" }, agent.harness || "other"), agent.idle_seconds !== null && agent.idle_seconds !== undefined ? h("span", null, "idle " + fmtDuration(agent.idle_seconds)) : null),
    h("span", { class: "agent-note" }, agent.last_note || "No notes yet."),
    h("span", { class: "agent-foot" }, stuck ? Badge({ status: "warn", text: "looks stuck" }) : null, (agent.todo_ids || []).length ? h("span", null, agent.todo_ids.length + (agent.todo_ids.length === 1 ? " task" : " tasks")) : null, agent.window ? h("span", { class: "mono" }, "win " + agent.window) : h("span", null, "no tmux pane"))
  );
}

function rigCard(rig, ctx) {
  const agents = (rig.agents || []).slice().sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
  const killRig = h(
    "button",
    {
      class: "btn btn-danger btn-sm",
      type: "button",
      onClick: async () => {
        const ok = await confirm({ title: "Stop rig " + rig.run + "?", body: "This ends every agent in " + rig.run + (rig.tmux_session ? " and closes tmux session " + rig.tmux_session : "") + ". Unsaved work in those panes is lost.", danger: true, confirmLabel: "Stop rig" });
        if (!ok) return;
        try {
          await ctx.api.post("colony/kill", { run: rig.run });
          toast("Stopped rig " + rig.run, { kind: "ok" });
          refreshNow(ctx);
        } catch (err) {
          toastError(err, "Could not stop the rig");
        }
      },
    },
    icon("close"),
    "Stop rig"
  );
  const attach = h(
    "button",
    { class: "btn btn-sm", type: "button", onClick: () => copyAttach(ctx, rig.run, null) },
    icon("terminal"),
    "Copy attach command"
  );
  return h(
    "section",
    { class: "card rig", "data-state": rig.state, "aria-label": "Rig " + rig.run },
    h(
      "div",
      { class: "card-head rig-head" },
      h("div", null, h("h2", null, h("span", { class: "mono" }, rig.run)), h("div", { class: "rig-meta" }, Badge({ status: rig.state === "running" ? "running" : rig.state === "partial" ? "partial" : "stopped", text: rig.state }), rig.project_name ? h("span", null, rig.project_name) : null, rig.started ? h("span", null, "started " + fmtRelative(rig.started)) : null)),
      h("div", { class: "card-actions" }, rig.tmux_session ? attach : null, killRig)
    ),
    agents.length ? h("div", { class: "agent-grid" }, agents.map((a) => agentCard(rig, a, ctx))) : h("p", { class: "dim", style: { padding: "var(--pad-card)" } }, "No agents in this rig yet.")
  );
}

async function copyAttach(ctx, run, name) {
  try {
    const res = await ctx.api.post("colony/attach-command", name ? { run, name } : { run });
    const ok = await copyText(res.command || "");
    toast(ok ? "Copied: " + res.command : "Copy failed. Command: " + res.command, { kind: ok ? "ok" : "warn" });
  } catch (err) {
    toastError(err, "Could not build the attach command");
  }
}

async function fetchHelp(ctx) {
  try {
    const help = await ctx.api.post("colony/spawn-help", {});
    // Contract: { steps: [{label, command}], next, tmux_available }. Tolerate the older flat shapes.
    let steps = Array.isArray(help.steps) ? help.steps.filter((s) => s && s.command) : [];
    // Installing tmux is only a step when it is actually missing.
    if (help.tmux_available !== false) steps = steps.filter((s) => !/^brew install tmux/.test(String(s.command)));
    const commands = steps.length ? steps.map((s) => String(s.command)) : Array.isArray(help.commands) ? help.commands : help.command ? [help.command] : ["export ATLAS_MUX=tmux"];
    return { commands, steps, note: help.next || help.note || help.why || "" };
  } catch {
    return { commands: ["export ATLAS_MUX=tmux"], steps: [], note: "" };
  }
}

// One labelled, copyable command per spawn-help step, as a single block so flex rows keep it whole.
function labelledCommands(help) {
  const steps = help && help.steps && help.steps.length ? help.steps : ((help && help.commands) || []).map((c) => ({ command: c }));
  return h(
    "div",
    { class: "stack", style: { width: "100%", maxWidth: "780px", textAlign: "left" } },
    steps.map((s) => h("div", { class: "stack" }, s.label ? h("span", { class: "dim" }, s.label) : null, CommandBlock(s.command)))
  );
}

function onboarding(ctx, data) {
  const help = (data && data._help) || { commands: ["export ATLAS_MUX=tmux"], steps: [], note: "" };
  const missingTmux = data && data.tmux_available === false;
  return EmptyState({
    icon: "colony",
    title: missingTmux ? "tmux is not installed" : "The colony is off",
    body: (missingTmux ? "Install tmux first (for example, brew install tmux), then turn" : "Turn") + " on the tmux colony so every agent gets its own pane you can watch and message. " + (help.note ? help.note.charAt(0).toUpperCase() + help.note.slice(1) + "." : ""),
    actions: [labelledCommands(help), h("button", { class: "btn", type: "button", onClick: () => refreshNow(ctx) }, "I ran it, check again")],
  });
}

function agentSections(ctx, rig, agent, detail, parts) {
  const stuck = detail.stuck && detail.stuck.is_stuck;
  const state = h(
    "div",
    { class: "drawer-section" },
    h("div", { class: "row", style: { flexWrap: "wrap" } }, Badge({ status: detail.state }), h("span", { class: "tag" }, detail.role || "agent"), h("span", { class: "tag" }, detail.harness || "other"), detail.exit_code !== null && detail.exit_code !== undefined ? h("span", { class: "tag" }, "exit " + detail.exit_code) : null),
    h("p", { class: "dim", style: { marginTop: "var(--s-2)" } }, "Run " + rig.run + (detail.window ? ", window " + detail.window : ", no tmux pane") + (detail.last_activity ? ", active " + fmtRelative(detail.last_activity) : ""))
  );
  const diagnosis = stuck
    ? h("div", { class: "stuck", role: "note" }, h("div", { class: "row" }, StatusDot({ status: "warn" }), h("strong", null, "This agent looks stuck")), h("p", null, detail.stuck.reason || "No recent output."), h("p", { class: "dim" }, "Send it a message below, or open the pane with the attach command and look."))
    : null;

  parts.terminal = Terminal({ text: parts.initialText || "", follow: true, label: "Pane output for " + agent.name });
  const followBox = h("input", { type: "checkbox", checked: true, onChange: (e) => parts.terminal.setFollow(e.target.checked) });
  const term = h(
    "div",
    { class: "drawer-section" },
    h("div", { class: "row", style: { justifyContent: "space-between" } }, h("h3", null, "Pane output"), h("label", { class: "check" }, followBox, "Follow")),
    parts.terminal,
    h("p", { class: "dim", id: "capture-meta" }, "")
  );

  parts.notesBox = h("div", null);
  parts.agentName = agent.name;
  parts.setNotes = (list) => {
    parts.notes = list || [];
    clear(parts.notesBox);
    parts.notesBox.appendChild(Timeline({ empty: "No notes from this agent yet.", items: noteItems(parts.notes, agent.name) }));
  };
  parts.hasQueued = () => parts.notes.some((n) => waitsForAgent(n, agent.name) && n.status === "queued");
  parts.setNotes(detail.notes);
  const notes = h("div", { class: "drawer-section" }, h("h3", null, "Notes"), parts.notesBox);

  const todos = h(
    "div",
    { class: "drawer-section" },
    h("h3", null, "Linked tasks"),
    (detail.todos || []).length
      ? (detail.todos || []).map((t) => h("a", { class: "todo-link", href: "#/work" }, StatusDot({ status: t.status }), h("span", { class: "grow" }, t.content), h("span", { class: "tag" }, statusLabel(t.status))))
      : h("p", { class: "dim" }, "No tasks linked to this agent.")
  );

  const errBox = h("div", { id: "send-error", hidden: true });
  const text = h("textarea", { class: "textarea", id: "send-text", rows: "3", placeholder: "Message " + agent.name, "aria-label": "Message to " + agent.name });
  const force = h("input", { type: "checkbox", id: "send-force" });
  const sendBtn = h("button", { class: "btn btn-primary", type: "submit" }, icon("send"), "Send");
  const form = h(
    "form",
    {
      class: "send-box",
      onSubmit: async (e) => {
        e.preventDefault();
        const body = text.value.trim();
        if (!body) {
          text.focus();
          return;
        }
        sendBtn.disabled = true;
        errBox.hidden = true;
        try {
          const res = await ctx.api.post("colony/send", { run: rig.run, name: agent.name, text: body, force: force.checked });
          text.value = "";
          force.checked = false;
          if (res && res.delivered === "queued") toast("Queued for " + agent.name + ": " + (res.detail || "the worker reads it on its next tool call"), { kind: "warn" });
          else toast(res && res.delivered === false ? "Recorded as a note; this agent has no tmux pane to type into" : "Delivered to " + agent.name, { kind: res && res.delivered === false ? "warn" : "ok" });
          if (parts.refreshCapture) parts.refreshCapture();
          if (parts.refreshNotes) parts.refreshNotes();
        } catch (err) {
          clear(errBox);
          errBox.className = "field-error";
          errBox.setAttribute("role", "alert");
          errBox.append(...[h("div", null, err.error || "Send failed"), err.why ? h("div", { class: "why" }, err.why) : null, err.do ? h("div", { class: "do" }, err.do) : null].filter(Boolean));
          errBox.hidden = false;
          // a refusal (409 pane_not_steerable) still records the message, tagged refused: show it
          if (err && err.error === "pane_not_steerable" && parts.refreshNotes) parts.refreshNotes();
          const guard = /prompt|typing|needs.?input|guard|force/i.test((err.error || "") + " " + (err.why || "") + " " + (err.do || ""));
          if (guard) {
            force.focus();
          }
        } finally {
          sendBtn.disabled = false;
        }
      },
    },
    h("h3", null, "Send a message"),
    text,
    errBox,
    h("div", { class: "row", style: { justifyContent: "space-between" } }, h("label", { class: "check", title: "Type into the pane even if it is showing a prompt" }, force, "Send anyway (override typing guard)"), sendBtn)
  );

  const actions = h(
    "div",
    { class: "drawer-section row", style: { flexWrap: "wrap" } },
    h("button", { class: "btn", type: "button", onClick: () => copyAttach(ctx, rig.run, agent.name) }, icon("terminal"), "Copy attach command"),
    h(
      "button",
      {
        class: "btn btn-danger",
        type: "button",
        onClick: async () => {
          const ok = await confirm({ title: "Stop " + agent.name + "?", body: "This ends the agent in " + rig.run + ". Anything it has not saved is lost.", danger: true, confirmLabel: "Stop agent" });
          if (!ok) return;
          try {
            await ctx.api.post("colony/kill", { run: rig.run, name: agent.name });
            toast("Stopped " + agent.name, { kind: "ok" });
            ctx.closeDrawer();
            refreshNow(ctx);
          } catch (err) {
            toastError(err, "Could not stop the agent");
          }
        },
      },
      icon("close"),
      "Stop agent"
    )
  );

  return [state, diagnosis, term, notes, todos, form, actions];
}

async function openAgent(rig, agent, ctx) {
  stopDrawerPolling();
  const key = rig.run + "/" + agent.name;
  drawerKey = key;
  const parts = {};
  let detail = Object.assign({ notes: [], todos: [] }, agent);
  try {
    detail = Object.assign(detail, await ctx.api.get("colony/agent", { run: rig.run, name: agent.name, project: rig.project || ctx.project }));
  } catch (err) {
    toastError(err, "Could not load agent details");
  }
  if (drawerKey !== key) return;
  parts.initialText = detail.pane_tail || "";
  const body = agentSections(ctx, rig, agent, detail, parts).filter(Boolean);
  const drawer = Drawer({ title: agent.name, onClose: stopDrawerPolling, width: 600, children: body });
  ctx.openDrawer(drawer);

  parts.refreshCapture = async () => {
    if (drawerKey !== key) return;
    try {
      const cap = await ctx.api.get("colony/capture", { run: rig.run, name: agent.name, lines: 200 });
      if (drawerKey !== key) return;
      parts.terminal.update(cap.text || "");
      const meta = drawer.querySelector("#capture-meta");
      if (meta) meta.textContent = (cap.source === "tmux" ? "Live from tmux" : "Reconstructed from notes (no tmux pane)") + ", captured " + fmtTime(cap.captured);
    } catch {
      const meta = drawer.querySelector("#capture-meta");
      if (meta) meta.textContent = "Capture unavailable right now; retrying.";
    }
  };
  // Notes load once with the drawer; re-read them after a send and, only while a message to this
  // agent is still queued, on the capture tick so the tag flips to read when its hook drains it.
  parts.refreshNotes = async () => {
    if (drawerKey !== key) return;
    try {
      const fresh = await ctx.api.get("colony/agent", { run: rig.run, name: agent.name, project: rig.project || ctx.project });
      if (drawerKey !== key) return;
      parts.setNotes(fresh.notes);
    } catch {
      // transient: the next tick retries
    }
  };
  parts.refreshCapture();
  drawerTimer = setInterval(() => {
    parts.refreshCapture();
    if (parts.hasQueued()) parts.refreshNotes();
  }, 2500);
}

function renderPage(ctx, data) {
  const d = data || {};
  const root = h("div", { class: "page", id: "colony-root" });
  const rigs = d.rigs || [];
  root.appendChild(
    h(
      "div",
      { class: "page-head" },
      h("div", null, h("h1", null, "Colony"), h("p", { class: "sub" }, rigs.length ? rigs.length + (rigs.length === 1 ? " rig" : " rigs") + ", " + rigs.reduce((n, r) => n + (r.agents || []).length, 0) + " agents." : "Rigs are runs; agents are the seats inside them.")),
      h("div", { class: "page-actions" }, d.counts ? countBadges(d.counts) : null, h("button", { class: "btn", type: "button", onClick: () => refreshNow(ctx) }, "Refresh"))
    )
  );
  const muxOff = d.mux_enabled === false || d.tmux_available === false;
  if (!rigs.length) {
    root.appendChild(
      muxOff
        ? onboarding(ctx, d)
        : EmptyState({ icon: "colony", title: "No rigs are running", body: "Start an Atlas run that dispatches subagents and its rig shows up here with live agent state.", actions: d._help && d._help.commands.length ? [labelledCommands(d._help)] : null })
    );
    return root;
  }
  if (muxOff) {
    root.appendChild(
      Card({ title: "tmux colony is off", children: [h("p", { class: "dim" }, "Agents below come from dispatch records and board notes, so there is no live pane to read or type into. Turn on tmux to get one."), d._help ? labelledCommands(d._help) : null] })
    );
  }
  for (const rig of rigs) root.appendChild(rigCard(rig, ctx));
  return root;
}

async function refreshNow(ctx) {
  try {
    const data = await withHelp(ctx, await ctx.api.get("colony", { project: ctx.project }));
    lastData = data;
    swapPage(ctx, data);
  } catch (err) {
    toastError(err, "Could not refresh the colony");
  }
}

async function withHelp(ctx, data) {
  const needsHelp = data.mux_enabled === false || data.tmux_available === false || !(data.rigs || []).length;
  if (needsHelp) data._help = await fetchHelp(ctx);
  return data;
}

function swapPage(ctx, data) {
  const host = document.getElementById("page-root");
  const old = document.getElementById("colony-root");
  if (host && old) host.replaceChild(renderPage(ctx, data), old);
}

export default {
  id: "colony",
  title: "Colony",
  icon: "colony",
  group: "Operate",

  async load(ctx) {
    lastData = await withHelp(ctx, await ctx.api.get("colony", { project: ctx.project }));
    return lastData;
  },

  render(ctx, data) {
    const node = renderPage(ctx, data);
    // Deep link: #/colony?run=<run>&agent=<name> opens that agent's drawer.
    const { run, agent } = ctx.params || {};
    if (agent) {
      const rig = ((data && data.rigs) || []).find((r) => !run || r.run === run);
      const seat = rig && (rig.agents || []).find((a) => a.name === agent);
      if (rig && seat) queueMicrotask(() => openAgent(rig, seat, ctx));
    }
    return node;
  },

  onEvent(evt, ctx) {
    if (evt !== "colony" && evt !== "tick") return;
    if (evt === "tick" && lastData && (lastData.rigs || []).length === 0) return;
    if (!refresher) refresher = debounce(() => refreshNow(ctx), 800);
    if (evt === "colony") refresher();
  },

  destroy() {
    stopDrawerPolling();
    if (refresher) refresher.cancel();
    refresher = null;
    lastData = null;
  },
};


