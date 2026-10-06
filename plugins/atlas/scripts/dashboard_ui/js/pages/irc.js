// IRC: agent-to-agent and human-to-agent messages. Channel + agent filters,
// live tail over SSE (pinned to bottom unless you scroll up), composer.

import { h, icon, clear, fmtTime } from "../dom.js";
import { StatusDot, Badge, EmptyState, toast, toastError } from "../components.js";

const MAX_LINES = 1000;

let messages = [];
let seen = new Set();
let agents = [];
let channels = [];
let filters = { channel: "", agent: "", q: "" };
let paused = false;
let pendingWhilePaused = 0;
let log = null;
let pinned = true;

function matches(m) {
  if (filters.channel && m.channel !== filters.channel) return false;
  if (filters.agent && m.from !== filters.agent && m.to !== filters.agent) return false;
  if (filters.q && !((m.body || "") + " " + (m.from || "") + " " + (m.to || "")).toLowerCase().includes(filters.q.toLowerCase())) return false;
  return true;
}

function kindStatus(kind) {
  return kind === "exit" ? "exited" : kind === "system" ? "idle" : kind === "note" ? "info" : "ok";
}

// Only a dashboard message to a named agent has a delivery state (the backend labels the rest
// "read" because nobody is waiting on them); showing "read" on every mirrored line would be noise.
// queued -> read for -p workers (hook drains the cursor); delivered = typed into an interactive pane;
// refused = the pane was not steerable (shell / headless) and nothing was typed.
const DELIVERY = ["queued", "read", "delivered", "refused"];

function waitsForAgent(m) {
  return m.from === "human" && m.to && m.to !== "all" && m.to !== "human" && DELIVERY.includes(m.status);
}

function deliveryBadge(m) {
  if (!waitsForAgent(m)) return null;
  if (m.status === "queued") return Badge({ status: "open", text: "queued" });
  if (m.status === "refused") return Badge({ status: "fail", text: "refused" });
  return Badge({ status: "done", text: m.status });
}

function line(m) {
  return h(
    "div",
    { class: "msg", "data-kind": m.kind || "irc", "data-delivery": waitsForAgent(m) ? m.status : null },
    h("time", { class: "ts mono", datetime: m.ts || "" }, fmtTime(m.ts)),
    StatusDot({ status: kindStatus(m.kind) }),
    h("span", { class: "who mono", title: (m.from || "?") + " to " + (m.to || "?") }, (m.from || "?") + (m.to ? " > " + m.to : "")),
    h("span", { class: "body" }, m.body || ""),
    deliveryBadge(m)
  );
}

function drawLog() {
  if (!log) return;
  const keep = log.scrollTop; // a status flip redraws too; it must not yank a reader who scrolled up
  clear(log);
  const shown = messages.filter(matches);
  if (!shown.length) {
    log.appendChild(h("p", { class: "dim", style: { padding: "var(--s-3)" } }, messages.length ? "No messages match these filters." : "No messages yet. Agents talk here as they work."));
    return;
  }
  for (const m of shown) log.appendChild(line(m));
  if (pinned && !paused) log.scrollTop = log.scrollHeight;
  else log.scrollTop = keep;
}

function ingest(list) {
  let added = 0;
  for (const m of list || []) {
    const id = m.id || m.ts + m.from + m.body;
    if (seen.has(id)) continue;
    seen.add(id);
    messages.push(m);
    added += 1;
    if (m.from && !agents.includes(m.from)) agents.push(m.from);
    if (m.channel && !channels.includes(m.channel)) channels.push(m.channel);
  }
  if (messages.length > MAX_LINES) messages = messages.slice(-MAX_LINES);
  return added;
}

// A message already on screen keeps its line, but its delivery state moves queued -> read when the
// worker's hook drains it. ingest() skips seen ids, so apply status changes to the stored copy here.
function syncStatus(list) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  let changed = 0;
  for (const m of list || []) {
    const mine = m.id ? byId.get(m.id) : null;
    if (mine && m.status && mine.status !== m.status) {
      mine.status = m.status;
      changed += 1;
    }
  }
  return changed;
}

const hasQueued = () => messages.some((m) => waitsForAgent(m) && m.status === "queued");

function lastId() {
  const m = messages[messages.length - 1];
  return m ? m.ts || m.id : "";
}

async function fetchMore(ctx) {
  try {
    const res = await ctx.api.get("irc", { project: ctx.project, since: lastId(), limit: 200 });
    const added = ingest(res.messages);
    if (res.agents) agents = Array.from(new Set(agents.concat(res.agents)));
    if (res.channels) channels = Array.from(new Set(channels.concat(res.channels)));
    // Only while something waits on a worker: re-read the recent page and flip drained lines to read.
    // A flip adds no line, so it redraws without bumping the "new messages" chip.
    let flipped = 0;
    if (hasQueued()) {
      const recent = await ctx.api.get("irc", { project: ctx.project, limit: 200 });
      flipped = syncStatus(recent.messages);
    }
    if (added) {
      if (paused || !pinned) {
        pendingWhilePaused += added;
        updateChip();
      } else {
        drawLog();
      }
    } else if (flipped) {
      drawLog();
    }
  } catch {
    // transient: the next event or poll tick retries
  }
}

function updateChip() {
  const chip = document.getElementById("irc-resume");
  if (!chip) return;
  chip.hidden = !(paused || !pinned);
  chip.textContent = pendingWhilePaused ? "Jump to latest (" + pendingWhilePaused + " new)" : "Jump to latest";
}

// The IRC post route needs one project root. Under "All projects", use the project of the
// most recent message involving the recipient, else the default or first known project.
function postProject(ctx, recipient) {
  if (ctx.project && ctx.project !== "all") return ctx.project;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.project && (m.from === recipient || m.to === recipient)) return m.project;
  }
  const projects = (ctx.store.get("projects") || []).filter((p) => p && p.root);
  const pref = ctx.prefs && ctx.prefs.default_project;
  if (pref && pref !== "all" && projects.some((p) => p.root === pref)) return pref;
  return projects.length ? projects[0].root : undefined;
}

function build(ctx) {
  const root = h("div", { class: "page irc", id: "irc-root" });
  const channelSel = h(
    "select",
    { class: "select", id: "irc-channel", "aria-label": "Channel", onChange: (e) => { filters.channel = e.target.value; drawLog(); } },
    h("option", { value: "" }, "All channels"),
    channels.map((c) => h("option", { value: c }, c))
  );
  const agentSel = h(
    "select",
    { class: "select", id: "irc-agent", "aria-label": "Agent", onChange: (e) => { filters.agent = e.target.value; drawLog(); } },
    h("option", { value: "" }, "All agents"),
    agents.map((a) => h("option", { value: a }, a))
  );
  channelSel.value = filters.channel;
  agentSel.value = filters.agent;
  const search = h("input", { class: "input search", type: "search", placeholder: "Filter messages", "aria-label": "Filter messages", value: filters.q, onInput: (e) => { filters.q = e.target.value; drawLog(); } });
  const pause = h(
    "button",
    {
      class: "btn",
      type: "button",
      "aria-pressed": paused ? "true" : "false",
      onClick: (e) => {
        paused = !paused;
        e.currentTarget.setAttribute("aria-pressed", paused ? "true" : "false");
        e.currentTarget.textContent = paused ? "Resume live tail" : "Pause live tail";
        if (!paused) {
          pendingWhilePaused = 0;
          pinned = true;
          drawLog();
        }
        updateChip();
      },
    },
    paused ? "Resume live tail" : "Pause live tail"
  );

  root.appendChild(h("div", { class: "page-head" }, h("div", null, h("h1", null, "IRC"), h("p", { class: "sub" }, "What your agents are saying to each other, and to you.")), h("div", { class: "page-actions" }, pause)));
  root.appendChild(h("div", { class: "filterbar", role: "search" }, h("label", { class: "row" }, h("span", { class: "dim" }, "Channel"), channelSel), h("label", { class: "row" }, h("span", { class: "dim" }, "Agent"), agentSel), search));

  log = h("div", { class: "logview irc-log", tabindex: "0", role: "log", "aria-label": "Messages", "aria-live": "off" });
  log.addEventListener("scroll", () => {
    pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    if (pinned && !paused) {
      pendingWhilePaused = 0;
    }
    updateChip();
  });
  root.appendChild(log);
  root.appendChild(
    h("button", { class: "btn btn-sm follow-chip", type: "button", id: "irc-resume", hidden: true, onClick: () => { paused = false; pinned = true; pendingWhilePaused = 0; drawLog(); updateChip(); const p = document.querySelector("#irc-root .page-actions .btn"); if (p) { p.textContent = "Pause live tail"; p.setAttribute("aria-pressed", "false"); } } }, "Jump to latest")
  );

  const to = h("select", { class: "select", id: "irc-to", "aria-label": "Send to" }, agents.length ? agents.map((a) => h("option", { value: a }, a)) : h("option", { value: "" }, "No agents yet"));
  const body = h("textarea", { class: "textarea", id: "irc-body", rows: "2", placeholder: "Message an agent. Enter sends, Shift+Enter adds a line.", "aria-label": "Message" });
  const err = h("div", { id: "irc-error", hidden: true });
  const send = h("button", { class: "btn btn-primary", type: "submit" }, icon("send"), "Send");
  const form = h(
    "form",
    {
      class: "composer",
      onSubmit: async (e) => {
        e.preventDefault();
        const text = body.value.trim();
        if (!text || !to.value) {
          (text ? to : body).focus();
          return;
        }
        send.disabled = true;
        err.hidden = true;
        try {
          const res = await ctx.api.post("irc", { project: postProject(ctx, to.value), to: to.value, body: text, from: "human" });
          body.value = "";
          if (res && res.delivered === "queued") toast("Queued for " + to.value + ": " + (res.detail || "the worker reads it on its next tool call"), { kind: "warn" });
          else if (res && res.delivered === false && res.ok === false) {
            clear(err);
            err.className = "field-error";
            err.setAttribute("role", "alert");
            err.append(...[h("div", null, res.error || "Not sent"), res.why ? h("div", { class: "why" }, res.why) : null, res.do ? h("div", { class: "do" }, res.do) : null].filter(Boolean));
            err.hidden = false;
            toast((res.error || "Not sent") + ": refused, recorded as a note only", { kind: "warn" });
          }
          else if (res && res.delivered === false) toast("Saved as a note. " + to.value + " has no live pane to type into.", { kind: "warn" });
          else if (res && res.delivered === true) toast("Delivered to " + to.value, { kind: "ok" });
          await fetchMore(ctx);
          pinned = true;
          drawLog();
        } catch (ex) {
          clear(err);
          err.className = "field-error";
          err.setAttribute("role", "alert");
          err.append(...[h("div", null, ex.error || "Send failed"), ex.why ? h("div", { class: "why" }, ex.why) : null, ex.do ? h("div", { class: "do" }, ex.do) : null].filter(Boolean));
          err.hidden = false;
          toastError(ex, "Could not send");
        } finally {
          send.disabled = false;
        }
      },
    },
    h("div", { class: "field" }, h("label", { for: "irc-to" }, "To"), to),
    h("div", { class: "field" }, h("label", { for: "irc-body" }, "Message"), body),
    send
  );
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  root.appendChild(form);
  root.appendChild(err);
  drawLog();
  updateChip();
  return root;
}

export default {
  id: "irc",
  title: "IRC",
  icon: "irc",
  group: "Operate",

  async load(ctx) {
    messages = [];
    seen = new Set();
    agents = [];
    channels = [];
    paused = false;
    pinned = true;
    pendingWhilePaused = 0;
    const res = await ctx.api.get("irc", { project: ctx.project, limit: 200 });
    ingest(res.messages);
    agents = Array.from(new Set(agents.concat(res.agents || [])));
    channels = Array.from(new Set(channels.concat(res.channels || [])));
    return res;
  },

  render(ctx) {
    if (!messages.length && !agents.length) {
      const wrap = h("div", { class: "page", id: "irc-root" }, h("div", { class: "page-head" }, h("h1", null, "IRC")));
      wrap.appendChild(EmptyState({ icon: "irc", title: "No messages yet", body: "When agents post board notes or message each other, they stream in here live. You can message any agent from this page once one has spoken." }));
      return wrap;
    }
    return build(ctx);
  },

  onEvent(evt, ctx) {
    if (evt === "irc" || (evt === "tick" && ctx && ctx.api.mode === "poll")) fetchMore(ctx);
  },

  destroy() {
    log = null;
    messages = [];
    seen = new Set();
  },
};
