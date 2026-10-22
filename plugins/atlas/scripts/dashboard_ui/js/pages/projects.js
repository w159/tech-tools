// Projects (brief 5.8): the projects Atlas sees, with Pin and Hide stored in prefs.
import { h, replace, relTime, num } from "../dom.js";
import { get, prefs, savePrefs, describeError } from "../api.js";
import { buildHash } from "../router.js";
import { PageHeader, Table, StateDot, Button, Empty, toast } from "../ui.js";
import { mountView } from "./monitor-view.js";
import {
  splitProjects,
  pinPatch,
  hidePatch,
  projectHealth,
} from "./projects-model.js";

export function render(ctx) {
  let data = null;
  let host = null;

  async function save(patch) {
    try {
      await savePrefs(patch);
    } catch (e) {
      const d = describeError(e);
      toast(d.message, { kind: "error", detail: d.detail });
    }
  }

  function rowsTable(rows, isHidden) {
    const p = prefs.get();
    const pinned = new Set(p.pinned_projects || []);
    return Table({
      columns: [
        {
          key: "name",
          label: "Project",
          render: (r) =>
            h(
              "div",
              { class: "proj-cell" },
              h(
                "a",
                { href: buildHash("overview", { project: r.root }) },
                r.name || r.root,
              ),
              h("div", { class: "mono meta wrap" }, r.root),
            ),
        },
        {
          key: "last_active",
          label: "Last active",
          class: "num",
          render: (r) =>
            r.last_active ? `${relTime(r.last_active)} ago` : "never",
        },
        {
          key: "runs_7d",
          label: "Runs 7d",
          class: "num",
          render: (r) => num(r.runs_7d),
        },
        {
          key: "agents_active",
          label: "Agents active",
          class: "num",
          render: (r) => num(r.agents_active),
        },
        {
          key: "todos",
          label: "Open tasks",
          class: "num",
          render: (r) => num(r.todos && r.todos.open),
        },
        {
          key: "failures_7d",
          label: "Failures 7d",
          class: "num",
          render: (r) => num(r.failures_7d),
        },
        {
          key: "findings_open",
          label: "Findings open",
          class: "num",
          render: (r) => num(r.findings_open),
        },
        {
          key: "health",
          label: "Health",
          render: (r) => {
            const s = projectHealth(r.health);
            return StateDot(s.raw, { word: s.word });
          },
        },
        {
          key: "actions",
          label: "",
          render: (r) =>
            h(
              "div",
              { class: "row-actions" },
              !isHidden &&
                Button(
                  {
                    size: "sm",
                    variant: "ghost",
                    "aria-pressed": String(pinned.has(r.root)),
                    onClick: () => save(pinPatch(prefs.get(), r.root)),
                  },
                  pinned.has(r.root) ? "Unpin" : "Pin",
                ),
              Button(
                {
                  size: "sm",
                  variant: "ghost",
                  onClick: () => save(hidePatch(prefs.get(), r.root)),
                },
                isHidden ? "Show" : "Hide",
              ),
            ),
        },
      ],
      rows: rows.map((r) => ({ ...r, key: r.root })),
      empty: Empty({
        title: "No projects yet.",
        body: "Projects appear once an agent runs in a repo.",
      }),
    });
  }

  function paintBody() {
    const p = prefs.get();
    const { visible, hidden } = splitProjects(
      data.projects,
      p.pinned_projects,
      p.hidden_projects,
    );
    replace(
      host,
      rowsTable(visible, false),
      hidden.length
        ? h(
            "details",
            { class: "hidden-projects" },
            h("summary", {}, `Hidden projects (${hidden.length})`),
            rowsTable(hidden, true),
          )
        : null,
    );
  }

  const header = PageHeader({
    title: "Projects",
    description: "Where Atlas has worked on this machine.",
  });
  let unsub = null;
  const stop = mountView(ctx.root, header, {
    load: () => get("/api/v2/projects"),
    paint: (res) => {
      data = res;
      host = h("div", { class: "stack" });
      paintBody();
      if (unsub) unsub();
      unsub = prefs.subscribe(paintBody);
      return host;
    },
  });
  return () => {
    stop();
    if (unsub) unsub();
  };
}
