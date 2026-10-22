// Board page: tasks in four status columns, per project, live over the todos topic.
import { h, replace, relTime, baseName } from "../dom.js";
import {
  PageHeader,
  Button,
  IconButton,
  Select,
  Switch,
  Textarea,
  Field,
  Modal,
  Skeleton,
  Empty,
  confirm,
  toast,
} from "../ui.js";
import { get, post, topics, describeError } from "../api.js";
import { mergeAgents, statusOf } from "../state.js";
import { COLUMNS, columnsOf, menuFor, opBody } from "./board-model.js";

/** Small popover menu under an anchor; closes on outside click or Escape. */
function openMenu(anchor, entries, onPick) {
  const menu = h(
    "div",
    { class: "menu", role: "menu" },
    entries.map((e) =>
      h(
        "button",
        {
          type: "button",
          role: "menuitem",
          class: e.danger ? "menu-item danger" : "menu-item",
          onClick: () => {
            close();
            onPick(e.id);
          },
        },
        e.label,
      ),
    ),
  );
  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", away, true);
    document.removeEventListener("keydown", esc, true);
    document.dispatchEvent(new Event("menu-closed"));
  };
  const away = (ev) => {
    if (!menu.contains(ev.target)) close();
  };
  const esc = (ev) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
      anchor.focus();
    }
  };
  anchor.parentElement.append(menu);
  document.addEventListener("mousedown", away, true);
  document.addEventListener("keydown", esc, true);
  menu.querySelector("button").focus();
}

export function render(ctx) {
  const S = {
    state: null,
    error: null,
    archived: false,
    showDone: ctx.params.status === "done",
    project: ctx.project,
    projects: [],
    projectsReady: false, // false while GET /api/v2/projects is in flight
    onProjects: null, // set by an open Add task dialog
    disposed: false,
    stale: false,
  };
  const effective = () => (ctx.project !== "all" ? ctx.project : S.project);
  const host = h("div");

  async function load() {
    try {
      S.state = await get("/api/v2/todos", {
        project: effective(),
        archived: S.archived ? "1" : "",
      });
      S.error = null;
    } catch (e) {
      S.error = describeError(e).message;
    }
    paint();
  }

  async function apply(action, item, extra) {
    try {
      await post("/api/v2/todos", opBody(action, item, effective(), extra));
      await load();
    } catch (e) {
      const d = describeError(e);
      toast(d.message, { kind: "error", detail: d.detail });
    }
  }

  function agentRows() {
    return mergeAgents(topics.agents.get(), null).filter(
      (r) => r.kind !== "shell",
    );
  }

  function assignModal(item) {
    const names = agentRows().map((r) => r.name);
    if (!names.length)
      return toast("No agents to assign to", {
        kind: "warn",
        detail: "Launch one first.",
      });
    const pick = Select({
      label: "Agent",
      options: names,
      value: item.owner || names[0],
    });
    const ok = Button({ variant: "primary" }, "Assign");
    const cancel = Button({}, "Cancel");
    const modal = Modal(
      { title: "Assign to agent", footer: [cancel, ok] },
      Field({ label: "Agent" }, pick),
    );
    cancel.addEventListener("click", modal.close);
    ok.addEventListener("click", () => {
      modal.close();
      apply("assign", item, { owner: pick.value });
    });
  }

  function addModal() {
    const content = Textarea({
      rows: 3,
      placeholder: "What needs doing?",
      autofocus: true,
    });
    const projOptions = () =>
      S.projects.map((p) => ({
        value: p.root,
        label: p.name || baseName(p.root),
      }));
    const proj = Select({
      label: "Project",
      options: S.projectsReady
        ? projOptions()
        : [{ value: "", label: "Loading projects..." }],
      value: S.projectsReady && S.projects[0] && S.projects[0].root,
      disabled: !S.projectsReady,
    });
    const needsList = effective() === "all";
    const submit = Button({ variant: "primary" }, "Add task");
    // The list may still be in flight: keep submit off until it lands, then preselect the first project.
    if (needsList && !S.projectsReady) {
      submit.disabled = true;
      S.onProjects = () => {
        S.onProjects = null;
        proj.replaceChildren(
          ...projOptions().map((o) => h("option", { value: o.value }, o.label)),
        );
        proj.disabled = false;
        submit.disabled = false;
      };
    }
    const cancel = Button({}, "Cancel");
    const fields = [Field({ label: "Task" }, content)];
    if (effective() === "all") fields.push(Field({ label: "Project" }, proj));
    const modal = Modal(
      { title: "Add task", footer: [cancel, submit] },
      fields,
    );
    cancel.addEventListener("click", () => {
      S.onProjects = null;
      modal.close();
    });
    // Enter submits; Shift+Enter keeps the newline.
    content.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        if (!submit.disabled) submit.click();
      }
    });
    submit.addEventListener("click", async () => {
      const text = content.value.trim();
      if (!text) return content.focus();
      const root = effective() !== "all" ? effective() : proj.value;
      if (!root) return toast("Pick a project first", { kind: "warn" });
      submit.disabled = true;
      try {
        await post("/api/v2/todos", {
          op: "add",
          project: root,
          content: text,
        });
        modal.close();
        await load();
      } catch (e) {
        const d = describeError(e);
        toast(d.message, { kind: "error", detail: d.detail });
        submit.disabled = false;
      }
    });
  }

  function ownerView(item) {
    if (!item.owner) return null;
    const rows = agentRows();
    const live = rows.find(
      (r) => r.name === item.owner || r.key === item.owner,
    );
    const tone = live ? live.tone : statusOf("unknown").tone;
    return h(
      "span",
      { class: "state" },
      h("span", { class: `dot s-${tone}`, "aria-hidden": "true" }),
      h("span", { class: "mono" }, item.owner),
    );
  }

  function card(item) {
    const more = IconButton({
      icon: "menu",
      label: "Task actions",
      size: "sm",
    });
    more.addEventListener("click", () =>
      openMenu(more, menuFor(item, { archived: S.archived }), async (id) => {
        if (id === "assign") return assignModal(item);
        if (id === "remove") {
          const ok = await confirm({
            title: "Remove this task?",
            body: item.content,
            confirmLabel: "Remove",
            danger: true,
          });
          if (!ok) return;
        }
        apply(id, item);
      }),
    );
    return h(
      "li",
      { class: "card" },
      h("div", { class: "card-text" }, item.content),
      h(
        "div",
        { class: "card-meta meta" },
        item.phase && item.phase !== "unphased"
          ? h("span", { class: "label" }, item.phase)
          : null,
        ownerView(item),
        ctx.project === "all" && item.project
          ? h("span", {}, baseName(item.project))
          : null,
        h("span", {}, relTime(item.updated)),
        h("span", { class: "card-more" }, more),
      ),
    );
  }

  function column({ status, label }, items) {
    const collapsed = status === "done" && !S.showDone && !S.archived;
    return h(
      "section",
      { class: "board-col", dataset: { status }, "aria-label": label },
      h(
        "header",
        { class: "board-col-head" },
        h("h2", {}, label),
        h("span", { class: "count-badge" }, items.length),
        status === "done" && !S.archived
          ? Button(
              {
                size: "sm",
                variant: "ghost",
                onClick: () => {
                  S.showDone = !S.showDone;
                  paint();
                },
              },
              S.showDone ? "Hide" : "Show",
            )
          : null,
      ),
      collapsed
        ? null
        : h(
            "ul",
            { class: "card-list" },
            items.length
              ? items.map(card)
              : h("li", { class: "meta" }, "Nothing here."),
          ),
    );
  }

  function paint() {
    if (S.disposed) return;
    S.stale = !!document.querySelector(".menu");
    if (S.stale) return;
    if (!S.state && !S.error) return replace(host, Skeleton(6));
    if (!S.state)
      return replace(
        host,
        Empty({
          title: "The board did not load.",
          body: S.error,
          action: Button({ onClick: load }, "Retry"),
        }),
      );
    const cols = columnsOf(S.state);
    const total = COLUMNS.reduce((n, c) => n + cols[c.status].length, 0);
    if (!total)
      return replace(
        host,
        Empty({
          title: S.archived ? "No archived tasks." : "No tasks yet.",
          action: S.archived
            ? null
            : Button(
                { variant: "primary", icon: "plus", onClick: addModal },
                "Add task",
              ),
        }),
      );
    replace(
      host,
      h(
        "div",
        { class: "board" },
        COLUMNS.map((c) => column(c, cols[c.status])),
      ),
    );
  }

  const projectSelect = Select({
    label: "Project",
    options: [{ value: "all", label: "All projects" }],
    value: "all",
    onChange: (v) => {
      S.project = v;
      load();
    },
  });
  projectSelect.hidden = ctx.project !== "all";
  const archivedSwitch = Switch({
    label: "Show archived",
    onChange: (v) => {
      S.archived = v;
      load();
    },
  });

  replace(
    ctx.root,
    PageHeader({
      title: "Board",
      description: "Tasks Atlas and its agents are working through.",
      actions: [
        projectSelect,
        h(
          "label",
          { class: "inline-switch" },
          archivedSwitch,
          h("span", {}, "Show archived"),
        ),
        Button(
          { variant: "primary", icon: "plus", onClick: addModal },
          "Add task",
        ),
      ],
    }),
    host,
  );
  paint();
  get("/api/v2/projects").then(
    (res) => {
      S.projects = (res.projects || []).filter((p) => p.root);
      for (const p of S.projects)
        projectSelect.append(
          h("option", { value: p.root }, p.name || baseName(p.root)),
        );
      S.projectsReady = true;
      if (S.onProjects) S.onProjects();
    },
    (e) => {
      console.error("projects load failed", e);
      S.projectsReady = true; // dialog shows an empty list and the "Pick a project first" toast
      if (S.onProjects) S.onProjects();
    },
  );
  load();
  // The topic body equals the all-projects GET, which takes seconds to build; reuse it when it fits.
  const unsubscribe = topics.todos.subscribe((v) => {
    if (!S.archived && v && v.phases && v.project === effective()) {
      S.state = v;
      S.error = null;
      paint();
    } else load();
  });
  // Live updates must not rebuild the board under an open card menu; repaint once it closes.
  const repaintAfterMenu = () => {
    if (S.stale) paint();
  };
  document.addEventListener("menu-closed", repaintAfterMenu);
  return () => {
    S.disposed = true;
    unsubscribe();
    document.removeEventListener("menu-closed", repaintAfterMenu);
  };
}
