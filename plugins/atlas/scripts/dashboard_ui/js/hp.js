// herdr-projects in the Command Center: the "Herdr projects" section of the Projects page and the "New thread" dialog
// (also reachable from the palette). Reads GET /api/v2/projects/hp, starts workers with POST /api/v2/projects/hp/threads
// only after an explicit review + confirm step. The configure command is shown, never run: it edits agent hook configs.

import { h, icon, replace } from "./dom.js";
import { api } from "./api.js";
import { Badge, Button, Input, Select, CommandBlock } from "./ui-core.js";
import { Modal, openModal, closeModal, toast } from "./ui-overlays.js";
import { getHp, explain, installModal, openEditor } from "./integrations.js";
import { focusPane } from "./herdr-actions.js";

export const CONFIGURE_CMD = "herdr-projects configure --dry-run";
const KINDS = [["worktree", "Worktree (own branch, own workspace)"], ["tab", "Tab (no repo needed)"], ["checkout", "Checkout (existing repo directory)"]];
const STATUS_TONE = { active: "working", open: "working", working: "working", blocked: "input", needs_you: "input", done: "done", merged: "done", failed: "fail", paused: "idle", idle: "idle", archived: "idle" };

const name = (p) => String(p || "").split("/").filter(Boolean).pop() || p;
const prLabel = (pr) => (pr && typeof pr === "object" ? pr.url || pr.number || JSON.stringify(pr) : String(pr));

function configureBlock(hint) {
  return h("div", { class: "hp-configure", "data-state": "unconfigured" },
    h("p", null, hint || "herdr-projects has no project root yet."),
    h("p", { class: "dim" }, "Preview first. Nothing below runs automatically:"),
    CommandBlock(CONFIGURE_CMD),
    h("p", { class: "dim hp-warn" }, "Note: configure edits agent hook configs (Claude, Codex and others), herdr's config.toml and links a skill. Hooks then run in every agent session on this machine. Read the dry-run output before running it for real."));
}

// ---- new thread dialog ---------------------------------------------------------------------------

/** Opens the dialog. opts: { project, repo, onDone }. Loads hp state itself and explains every unavailable case. */
export async function openNewThread(opts) {
  const o = opts || {};
  let hp;
  try {
    hp = await getHp(true);
  } catch (e) {
    return void explain(e, "thread");
  }
  if (!hp.installed) return installModal("herdr-projects is not installed", hp.install_cmd, "Threads need the herdr-projects plugin.");
  if (!hp.configured) {
    return void openModal(Modal({ title: "herdr-projects is not set up", children: [configureBlock(hp.hint)], actions: [Button({ label: "Close", variant: "primary", onClick: () => closeModal() })] }));
  }
  const projects = hp.projects || [];
  if (!projects.length) {
    return void openModal(Modal({ title: "No herdr project yet", children: [h("p", null, "A thread belongs to a project. Create one first:"), CommandBlock("herdr-projects new <name>")], actions: [Button({ label: "Close", variant: "primary", onClick: () => closeModal() })] }));
  }
  const slug0 = projects.some((p) => p.slug === o.project) ? o.project : projects[0].slug;
  const v = { project: slug0, title: "", repo: o.repo || ((projects.find((p) => p.slug === slug0) || {}).repos || [])[0] || "", kind: "worktree", task: "" };
  form(v, projects, hp, o, "");
}

function form(v, projects, hp, o, error) {
  const proj = Select({ label: "Project", id: "hp-project", options: projects.map((p) => ({ value: p.slug, label: p.slug + (p.goal ? " - " + p.goal : "") })), value: v.project, onChange: (x) => { v.project = x; } });
  const title = Input({ label: "Title", id: "hp-title", value: v.title, required: true, placeholder: "Fix login redirect", onInput: (x) => { v.title = x; } });
  const repo = Input({ label: "Repo directory", id: "hp-repo", value: v.repo, placeholder: "/absolute/path/to/repo", hint: "Absolute path of an existing directory. May be empty only for the tab kind.", onInput: (x) => { v.repo = x; } });
  const kind = Select({ label: "Kind", id: "hp-kind", options: KINDS.map(([value, label]) => ({ value, label })), value: v.kind, onChange: (x) => { v.kind = x; } });
  const task = Input({ label: "Task", id: "hp-task", value: v.task, multiline: true, required: true, placeholder: "What should the worker do?", hint: "Sent to herdr-projects on stdin (--task-file -).", onInput: (x) => { v.task = x; } });
  const msg = h("div", { class: "field-msg", role: "alert", id: "hp-error" }, error || "");
  msg.hidden = !error;
  const review = () => {
    const bad = !v.title.trim() ? "Give the thread a title." : !v.task.trim() ? "Describe the task." : v.kind !== "tab" && !v.repo.trim() ? "A repo directory is required unless the kind is tab." : v.repo.trim() && !v.repo.trim().startsWith("/") ? "The repo directory must be an absolute path." : "";
    if (bad) { msg.textContent = bad; msg.hidden = false; return; }
    confirmStep(v, projects, hp, o);
  };
  openModal(Modal({ title: "New herdr thread", children: [proj, title, repo, kind, task, msg], actions: [Button({ label: "Cancel", onClick: () => closeModal() }), Button({ label: "Review", variant: "primary", onClick: review })] }));
}

function confirmStep(v, projects, hp, o) {
  const note = h("div", { class: "field-msg", role: "alert", id: "hp-error" });
  note.hidden = true;
  const branchHint = v.kind === "worktree" ? "hp/" + v.project + "/<id>-" + v.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "";
  let go;
  const start = async () => {
    note.hidden = true;
    go.disabled = true;
    go.setAttribute("aria-busy", "true");
    go.lastChild.textContent = "Starting";
    try {
      const res = await api.post("projects/hp/threads", { project: v.project, title: v.title.trim(), repo: v.repo.trim() || undefined, kind: v.kind, task: v.task });
      closeModal();
      const t = res.thread || {};
      toast("Thread started in " + v.project, { kind: "ok", why: [t.id && "id " + t.id, t.branch || branchHint].filter(Boolean).join(", ") });
      await getHp(true).catch(() => null);
      if (o.onDone) o.onDone(res);
    } catch (e) {
      go.disabled = false;
      go.removeAttribute("aria-busy");
      go.lastChild.textContent = "Start thread";
      if (e.status === 424) return explain(e, "thread");
      const d = e.data || {};
      note.textContent = [e.error, e.why || d.why, d.detail, e.do].filter(Boolean).join(": ");
      note.hidden = false;
    }
  };
  go = Button({ label: "Start thread", variant: "primary", onClick: start });
  const rows = [["Project", v.project], ["Title", v.title.trim()], ["Kind", v.kind], ["Repo", v.repo.trim() || "none"], ["Branch", branchHint || "decided by herdr-projects"]];
  openModal(Modal({
    title: "Start this thread?",
    children: [
      h("p", null, "This starts a separate agent session. It uses tokens and, for the worktree kind, creates a branch and workspace."),
      h("dl", { class: "kv" }, rows.map(([k, x]) => [h("dt", null, k), h("dd", { class: "mono" }, x)])),
      h("details", { open: true }, h("summary", null, "Task"), h("pre", { class: "mono hp-task" }, v.task)),
      h("p", { class: "dim" }, "No profile, yolo or safety flags are sent: the worker runs with your herdr-projects defaults."),
      note,
    ],
    actions: [Button({ label: "Back", onClick: () => form(v, projects, hp, o, "") }), go],
  }));
}

// ---- projects page section -----------------------------------------------------------------------

function chip(text, title, extra) {
  return h("span", { class: "chip-lite " + (extra || ""), title: title || null }, text);
}

function threadRow(t) {
  const tone = STATUS_TONE[String(t.status || "").toLowerCase()] || "idle";
  const root = t.cwd;
  return h("li", { class: "hp-thread", "data-thread": t.id, "data-status": t.status || "unknown" },
    h("div", { class: "hp-thread-main" },
      h("div", { class: "hp-thread-top" }, Badge({ status: tone, text: t.status || "unknown" }), h("strong", { class: "truncate", title: t.title }, t.title || t.id), h("span", { class: "dim mono" }, "#" + t.id), t.group ? chip(t.group, "Group") : null),
      h("div", { class: "hp-thread-sub" },
        t.branch ? h("span", { class: "mono truncate", title: "Branch" }, t.branch) : h("span", { class: "dim" }, t.kind === "tab" ? "tab thread, no branch" : "no branch recorded"),
        t.channel ? h("a", { class: "chip-lite chip-link", href: "#/channels" + (t.channel_path ? "?channel=" + encodeURIComponent(t.channel_path) : ""), title: t.channel_path || t.channel }, icon("irc"), t.channel) : null,
        t.pr ? chip("PR " + prLabel(t.pr) + (t.pr_state ? " (" + t.pr_state + ")" : ""), "Pull request") : h("span", { class: "dim" }, "no PR"),
        t.note ? h("span", { class: "dim truncate", title: t.note }, t.note) : null),
      root ? h("div", { class: "hp-thread-files" }, h("span", { class: "dim mono truncate", title: root }, root)) : null),
    h("div", { class: "hp-thread-actions" },
      Button({ label: "Open", size: "sm", disabled: !t.pane_id, title: t.pane_id ? "Focus the thread's pane " + t.pane_id : "This thread has no live pane", onClick: () => focusPane(t.pane_id) }),
      Button({ label: "Editor", size: "sm", variant: "ghost", disabled: !root, title: root ? "Open the thread directory in tode" : "No directory recorded", onClick: () => openEditor({ path: root }) })));
}

function projectBlock(p, redraw) {
  const threads = p.threads || [];
  const needs = threads.filter((t) => /need|block/i.test(String(t.status || "") + " " + String(t.group_token || ""))).length;
  return h("article", { class: "hp-project", "data-project": p.slug, "aria-label": "Herdr project " + p.slug },
    h("header", { class: "hp-project-head" },
      h("div", { class: "grow" }, h("h3", null, p.name || p.slug, " ", h("span", { class: "dim mono" }, p.slug)), h("p", { class: "dim" }, p.goal || p.summary || "No goal recorded")),
      Badge({ status: STATUS_TONE[String(p.status || "").toLowerCase()] || "idle", text: p.status || "unknown" }),
      needs ? Badge({ status: "input", text: needs + " need you" }) : null,
      Button({ label: "New thread", size: "sm", variant: "primary", onClick: () => openNewThread({ project: p.slug, repo: (p.repos || [])[0], onDone: redraw }) })),
    h("div", { class: "hp-repos" }, (p.repos || []).length ? (p.repos || []).map((r) => h("span", { class: "chip-lite mono", title: r }, icon("folder"), name(r))) : h("span", { class: "dim" }, "No repos recorded")),
    threads.length ? h("ul", { class: "hp-threads" }, threads.map((t) => threadRow(t))) : h("p", { class: "dim" }, "No threads yet."));
}

/** Section node for the Projects page; .reload() refetches. */
export function HerdrProjectsSection() {
  const root = h("section", { class: "hp-section", "aria-label": "Herdr projects", id: "herdr-projects" });
  let hp = null;
  let err = null;
  const head = () => h("div", { class: "hp-head" }, h("h2", { class: "pg-h2" }, "Herdr projects"), hp && hp.configured && hp.needs_you ? Badge({ status: "input", text: hp.needs_you + (hp.needs_you === 1 ? " project needs you" : " projects need you") }) : null,
    h("span", { class: "grow" }), Button({ label: "Refresh", size: "sm", onClick: () => load(true) }), hp && hp.installed && hp.configured ? Button({ label: "New thread", size: "sm", variant: "primary", onClick: () => openNewThread({ onDone: () => load(true) }) }) : null);
  function draw() {
    let body;
    if (err) body = h("div", { class: "state state-error", role: "alert" }, h("p", { class: "state-title" }, "Could not read herdr-projects"), h("p", { class: "state-body" }, [err.error, err.why, err.do, (err.data || {}).detail].filter(Boolean).join(": ")), Button({ label: "Retry", variant: "primary", onClick: () => load(true) }));
    else if (!hp) body = h("p", { class: "pg-hint", role: "status" }, "Reading herdr-projects");
    else if (!hp.installed) body = h("div", { class: "hp-configure", "data-state": "not-installed" }, h("p", null, "herdr-projects is not installed."), CommandBlock(hp.install_cmd || "herdr plugin install eliasstravik/herdr-projects"));
    else if (!hp.configured) body = configureBlock(hp.hint);
    else if (!(hp.projects || []).length) body = h("div", { class: "hp-configure", "data-state": "empty" }, h("p", null, "No herdr project under " + hp.root + " yet."), CommandBlock("herdr-projects new <name>"));
    else body = h("div", { class: "hp-projects" }, hp.projects.map((p) => projectBlock(p, () => load(true))));
    replace(root, head(), hp && hp.root ? h("p", { class: "dim mono hp-root", title: hp.root }, hp.root) : null, body);
  }
  async function load(force) {
    try {
      hp = await getHp(force);
      err = null;
    } catch (e) {
      err = e;
    }
    draw();
  }
  root.reload = load;
  draw();
  load(false);
  return root;
}
