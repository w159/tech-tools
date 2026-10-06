// Work: phased board. Inline add, edit, status, assign, claim, move, remove, reorder.
// Every change is one POST /api/v2/todos; the server's fresh `state` replaces ours.

import { h, icon, debounce, fmtRelative, statusLabel } from "../dom.js";
import { Badge, StatusDot, EmptyState, confirm, toast, toastError } from "../components.js";

const STATUSES = ["open", "in_progress", "blocked", "done"];

let state = null; // { phases, counts, updated }
let refresher = null;
let editing = null; // todo id being edited
let dragId = null;

function allPhases() {
  return (state.phases || []).map((p) => p.name);
}

function findTodo(id) {
  for (const phase of state.phases || []) {
    const item = (phase.items || []).find((t) => t.id === id);
    if (item) return { item, phase };
  }
  return null;
}

// "All projects" shows every project's board merged (GET /api/v2/todos?project=all), grouped
// by status. That view is read-mostly: status, claim, edit and remove target the task's own
// project; add, reorder and phase moves need one concrete project, so they are not offered.
function isMerged(ctx) {
  return !ctx.project || ctx.project === "all";
}

function projectLabel(root) {
  const parts = String(root || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(root || "unknown");
}

// Body fields that aim a write at the task's own project (merged view only).
function writeTarget(ctx, t) {
  return isMerged(ctx) && t.project ? { project: t.project } : {};
}

// One column per status that the filter chips currently show, each task keeping its project.
function statusColumns() {
  const byStatus = {};
  for (const phase of state.phases || []) {
    for (const t of phase.items || []) (byStatus[t.status] = byStatus[t.status] || []).push(Object.assign({}, t, { phaseName: phase.name }));
  }
  return STATUSES.filter((s) => shownStatuses.has(s)).map((s) => ({ name: statusLabel(s), status: s, items: byStatus[s] || [] }));
}

// Single-project mode targets the sidebar project. The todos API is per-project, so with
// no project chosen a write falls back to the default project pref, else the busiest one.
function workProject(ctx) {
  if (ctx.project && ctx.project !== "all") return ctx.project;
  const projects = (ctx.store.get("projects") || []).filter((p) => p && p.root);
  const pref = ctx.prefs && ctx.prefs.default_project;
  if (pref && pref !== "all" && projects.some((p) => p.root === pref)) return pref;
  const busiest = projects.slice().sort((a, b) => ((b.todos && b.todos.open) || 0) - ((a.todos && a.todos.open) || 0))[0];
  return busiest ? busiest.root : undefined;
}

async function mutate(ctx, body, okMessage) {
  try {
    const res = await ctx.api.post("todos", Object.assign({ project: workProject(ctx) }, body));
    // The POST answers with that one project's board; the merged view must be re-fetched.
    if (!isMerged(ctx) && res && res.state && res.state.phases) state = res.state;
    else await reload(ctx);
    if (okMessage) toast(okMessage, { kind: "ok", ttl: 1800 });
    paint(ctx);
    return true;
  } catch (err) {
    toastError(err, "Could not update the task");
    await reload(ctx).catch(() => {});
    paint(ctx);
    return false;
  }
}

async function reload(ctx) {
  state = await ctx.api.get("todos", { project: isMerged(ctx) ? "all" : workProject(ctx) });
}

function paint(ctx) {
  const host = document.getElementById("work-root");
  if (!host) return;
  const scrollers = Array.from(host.querySelectorAll(".col-body")).map((el) => el.scrollTop);
  const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : null;
  const fresh = build(ctx);
  host.replaceWith(fresh);
  fresh.querySelectorAll(".col-body").forEach((el, i) => {
    el.scrollTop = scrollers[i] || 0;
  });
  if (focusId) {
    const again = fresh.querySelector('[data-focus-key="' + CSS.escape(focusId) + '"]');
    if (again) again.focus();
  }
}

function ownerOf(t) {
  return t.owner || t.claimed_by || "";
}

function todoCard(ctx, t, phase, index) {
  if (editing === t.id) return editForm(ctx, t, phase);
  const merged = isMerged(ctx);
  const items = phase.items;
  const move = (delta) => {
    const ids = items.map((x) => x.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    mutate(ctx, { op: "reorder", phase: phase.name, ids });
  };
  const card = h(
    "li",
    {
      class: "todo",
      "data-status": t.status,
      draggable: merged ? "false" : "true",
      onDragstart: (e) => {
        dragId = t.id;
        card.dataset.dragging = "true";
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", t.id);
        }
      },
      onDragend: () => {
        dragId = null;
        delete card.dataset.dragging;
        document.querySelectorAll("[data-over]").forEach((n) => n.removeAttribute("data-over"));
      },
      onDragover: (e) => {
        if (dragId && dragId !== t.id) {
          e.preventDefault();
          card.dataset.over = "true";
        }
      },
      onDragleave: () => card.removeAttribute("data-over"),
      onDrop: (e) => {
        e.preventDefault();
        card.removeAttribute("data-over");
        const from = findTodo(dragId);
        if (!from) return;
        if (from.phase.name === phase.name) {
          const ids = items.map((x) => x.id).filter((id) => id !== dragId);
          ids.splice(ids.indexOf(t.id), 0, dragId);
          mutate(ctx, { op: "reorder", phase: phase.name, ids });
        } else {
          mutate(ctx, { op: "move", id: dragId, phase: phase.name });
        }
      },
    },
    h(
      "div",
      { class: "todo-top" },
      merged ? null : h("span", { class: "drag-handle", "aria-hidden": "true", title: "Drag to reorder" }, icon("grip")),
      StatusDot({ status: t.status }),
      h("button", { class: "todo-text", type: "button", "data-focus-key": "edit-" + t.id, onClick: () => { editing = t.id; paint(ctx); } }, h("span", { class: "todo-text-label" }, t.content), h("span", { class: "sr-only" }, ", " + statusLabel(t.status) + ", press to edit"))
    ),
    h(
      "div",
      { class: "todo-meta" },
      h(
        "label",
        { class: "row" },
        h("span", { class: "sr-only" }, "Status of " + t.content),
        h(
          "select",
          { class: "select", "data-focus-key": "st-" + t.id, onChange: (e) => mutate(ctx, Object.assign({ op: "status", id: t.id, status: e.target.value }, writeTarget(ctx, t))) },
          STATUSES.map((s) => {
            const o = h("option", { value: s }, statusLabel(s));
            if (s === t.status) o.selected = true;
            return o;
          })
        )
      ),
      merged ? h("span", { class: "tag", "data-project": t.project, title: t.project }, projectLabel(t.project)) : null,
      ownerOf(t) ? h("span", { class: "tag" }, ownerOf(t)) : h("span", { class: "dim" }, "unassigned"),
      t.updated ? h("span", null, fmtRelative(t.updated)) : null
    ),
    h(
      "div",
      { class: "todo-actions" },
      merged ? null : h("button", { class: "btn btn-ghost btn-sm btn-icon", type: "button", "aria-label": "Move up", disabled: index === 0, onClick: () => move(-1) }, icon("up")),
      merged ? null : h("button", { class: "btn btn-ghost btn-sm btn-icon", type: "button", "aria-label": "Move down", disabled: index === items.length - 1, onClick: () => move(1) }, icon("down")),
      ownerOf(t) ? null : h("button", { class: "btn btn-sm", type: "button", onClick: () => mutate(ctx, Object.assign({ op: "claim", id: t.id, owner: "human" }, writeTarget(ctx, t)), "Claimed") }, "Claim"),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: () => { editing = t.id; paint(ctx); } }, icon("edit"), "Edit"),
      h(
        "button",
        {
          class: "btn btn-ghost btn-sm",
          type: "button",
          onClick: async () => {
            const ok = await confirm({ title: "Remove this task?", body: t.content, danger: true, confirmLabel: "Remove" });
            if (ok) mutate(ctx, Object.assign({ op: "remove", id: t.id }, writeTarget(ctx, t)), "Removed");
          },
        },
        icon("trash"),
        "Remove"
      )
    )
  );
  return card;
}

function editForm(ctx, t, phase) {
  const content = h("textarea", { class: "textarea", rows: "2", "aria-label": "Task text" });
  content.value = t.content;
  const owner = h("input", { class: "input", type: "text", placeholder: "Owner (agent or person)", "aria-label": "Owner" });
  owner.value = ownerOf(t);
  const merged = isMerged(ctx);
  // A merged card sits in a status column, not a phase: its phase belongs to its own project.
  const phaseName = merged ? t.phaseName : phase.name;
  const phaseSel = merged
    ? null
    : h(
        "select",
        { class: "select", "aria-label": "Phase" },
        allPhases().map((p) => {
          const o = h("option", { value: p }, p);
          if (p === phaseName) o.selected = true;
          return o;
        })
      );
  const save = async (e) => {
    e.preventDefault();
    const text = content.value.trim();
    if (!text) {
      content.focus();
      return;
    }
    const patch = Object.assign({ op: "update", id: t.id }, writeTarget(ctx, t));
    if (text !== t.content) patch.content = text;
    if (phaseSel && phaseSel.value !== phaseName) patch.phase = phaseSel.value;
    const nextOwner = owner.value.trim();
    editing = null;
    let ok = true;
    if (patch.content || patch.phase) ok = await mutate(ctx, patch);
    if (ok && nextOwner !== ownerOf(t) && nextOwner) await mutate(ctx, Object.assign({ op: "assign", id: t.id, owner: nextOwner }, writeTarget(ctx, t)), "Saved");
    else if (ok && (patch.content || patch.phase)) toast("Saved", { kind: "ok", ttl: 1800 });
    else paint(ctx);
  };
  const form = h(
    "li",
    { class: "todo" },
    h(
      "form",
      { class: "edit-form", onSubmit: save, onKeydown: (e) => { if (e.key === "Escape") { e.stopPropagation(); editing = null; paint(ctx); } } },
      content,
      h("div", { class: "row" }, phaseSel, owner),
      h("div", { class: "row" }, h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Save"), h("button", { class: "btn btn-sm", type: "button", onClick: () => { editing = null; paint(ctx); } }, "Cancel"))
    )
  );
  queueMicrotask(() => content.focus());
  return form;
}

function addForm(ctx, phase) {
  const input = h("input", { class: "input", type: "text", placeholder: "Add a task to " + phase.name, "aria-label": "New task in " + phase.name });
  const owner = h("input", { class: "input", type: "text", placeholder: "Owner (optional)", "aria-label": "Owner for new task" });
  return h(
    "form",
    {
      class: "add-form",
      onSubmit: async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) {
          input.focus();
          return;
        }
        const body = { op: "add", content: text, phase: phase.name };
        if (owner.value.trim()) body.owner = owner.value.trim();
        const ok = await mutate(ctx, body, "Added");
        if (ok) {
          const next = document.querySelector('[data-add-phase="' + CSS.escape(phase.name) + '"]');
          if (next) next.focus();
        }
      },
    },
    h("div", { class: "row" }, input, h("button", { class: "btn btn-icon", type: "submit", "aria-label": "Add task to " + phase.name }, icon("plus"))),
    owner
  );
}

// Status filter: done is hidden by default so a long board stays scannable.
const shownStatuses = new Set(["open", "in_progress", "blocked"]);

function filterChips(ctx, counts) {
  return STATUSES.filter((k) => counts[k] !== undefined).map((k) => {
    const on = shownStatuses.has(k);
    return h(
      "button",
      {
        class: "btn" + (on ? " btn-primary" : ""),
        type: "button",
        "aria-pressed": String(on),
        "aria-label": (on ? "Hide " : "Show ") + statusLabel(k) + " tasks (" + counts[k] + ")",
        onClick: () => {
          if (on) shownStatuses.delete(k);
          else shownStatuses.add(k);
          paint(ctx);
        },
      },
      statusLabel(k) + " " + counts[k]
    );
  });
}

function column(ctx, phase) {
  const items = phase.items || [];
  const merged = isMerged(ctx);
  const done = items.filter((t) => t.status === "done").length;
  // Keep each task's index in the full phase list: reordering is addressed by that position.
  const visible = items.map((t, i) => ({ t, i })).filter(({ t }) => merged || shownStatuses.has(t.status));
  const body = h(
    "ul",
    {
      class: "col-body",
      "aria-label": phase.name,
      onDragover: (e) => {
        if (dragId) e.preventDefault();
      },
      onDrop: (e) => {
        if (!dragId || e.target.closest(".todo")) return;
        e.preventDefault();
        const from = findTodo(dragId);
        if (from && from.phase.name !== phase.name) mutate(ctx, { op: "move", id: dragId, phase: phase.name });
      },
    },
    visible.length ? visible.map(({ t, i }) => todoCard(ctx, t, phase, i)) : h("li", { class: "dim", style: { padding: "var(--s-3)" } }, merged ? "No tasks with this status." : items.length ? "Everything here is hidden by the status filter (" + (items.length - visible.length) + " hidden)." : "Nothing in this phase yet.")
  );
  const form = merged ? null : addForm(ctx, phase);
  const firstInput = form && form.querySelector("input");
  if (firstInput) firstInput.setAttribute("data-add-phase", phase.name);
  const tally = merged ? String(items.length) : done + "/" + items.length + " done";
  return h("section", { class: "col", "aria-label": (merged ? "Status " : "Phase ") + phase.name }, h("div", { class: "col-head" }, h("h2", null, phase.name), h("span", { class: "tag" }, tally)), body, form);
}

function build(ctx) {
  const root = h("div", { class: "page", id: "work-root" });
  const counts = state.counts || {};
  root.appendChild(
    h(
      "div",
      { class: "page-head" },
      h("div", null, h("h1", null, "Work"), h("p", { class: "sub" }, isMerged(ctx) ? "Every project's board, grouped by status. Each task is labelled with its project; pick a project in the sidebar to add, reorder or move tasks." : "Tasks by phase for this project.")),
      h("div", { class: "page-actions" }, filterChips(ctx, counts))
    )
  );
  const phases = state.phases || [];
  if (!phases.length) {
    const first = h("input", { class: "input", type: "text", placeholder: "First task", "aria-label": "First task" });
    root.appendChild(
      EmptyState({
        icon: "work",
        title: "No tasks yet",
        body: "Add the first task to start a board. Agents add their own as they plan; everything lands here under its phase.",
        actions: [
          h(
            "form",
            {
              class: "row",
              onSubmit: (e) => {
                e.preventDefault();
                if (first.value.trim()) mutate(ctx, { op: "add", content: first.value.trim(), phase: "Backlog" }, "Added");
              },
            },
            first,
            h("button", { class: "btn btn-primary", type: "submit" }, "Add task")
          ),
        ],
      })
    );
    return root;
  }
  root.appendChild(h("div", { class: "board" }, (isMerged(ctx) ? statusColumns() : phases).map((p) => column(ctx, p))));
  return root;
}

export default {
  id: "work",
  title: "Work",
  icon: "work",
  group: "Operate",

  async load(ctx) {
    editing = null;
    await reload(ctx);
    return state;
  },

  render(ctx) {
    return build(ctx);
  },

  onEvent(evt, ctx) {
    if (evt !== "todos" || editing || dragId) return;
    if (!refresher) {
      refresher = debounce(async () => {
        try {
          await reload(ctx);
          paint(ctx);
        } catch {
          // the next event retries; the board keeps showing the last good state
        }
      }, 700);
    }
    refresher();
  },

  destroy() {
    if (refresher) refresher.cancel();
    refresher = null;
    editing = null;
    dragId = null;
    state = null;
  },
};
