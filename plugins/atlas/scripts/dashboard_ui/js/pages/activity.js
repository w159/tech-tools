// Activity (brief 5.5): what Atlas recorded, grouped, with inline detail.
import { h, relTime, num, truncate } from "../dom.js";
import { get } from "../api.js";
import { PageHeader, Table, Select, Segmented, Badge, Empty } from "../ui.js";
import {
  normalizeWindow,
  projectParam,
  projectLabel,
} from "./monitor-model.js";
import {
  GROUPS,
  normalizeGroup,
  kindOptions,
  kindLabel,
  statusTone,
} from "./activity-model.js";
import { mountView, WindowControl, Disclosure } from "./monitor-view.js";

export function render(ctx) {
  const win = normalizeWindow(ctx.params.window);
  const group = normalizeGroup(ctx.params.group);
  const kind = ctx.params.kind || "";
  const open = new Set();
  let kinds = {};

  const header = PageHeader({
    title: "Activity",
    description: "Everything Atlas recorded, newest first.",
    actions: WindowControl(ctx),
  });

  function detail(it) {
    const bits = [
      it.detail && h("p", { class: "mono wrap" }, it.detail),
      it.session &&
        h(
          "p",
          { class: "meta" },
          "Session ",
          h("span", { class: "mono" }, it.session),
        ),
      it.count > 1 && h("p", { class: "meta" }, `Seen ${num(it.count)} times.`),
      kinds[it.kind] &&
        kinds[it.kind].help &&
        h("p", { class: "meta" }, kinds[it.kind].help),
    ];
    return bits;
  }

  function paint(data) {
    kinds = data.kinds || {};
    const rows = [];
    for (const g of data.groups || []) {
      rows.push({
        __group: h(
          "span",
          {},
          h("strong", {}, g.label || projectLabel(g.key)),
          h(
            "span",
            { class: "meta" },
            ` ${num(g.count)} items, last ${relTime(g.last)} ago`,
          ),
        ),
      });
      for (const it of g.items || []) rows.push({ ...it, key: it.id });
    }
    const filters = h(
      "div",
      { class: "toolbar" },
      Select({
        label: "Kind",
        options: kindOptions(kinds),
        value: kind,
        onChange: (v) => ctx.setParams({ kind: v }),
      }),
      Segmented({
        label: "Group by",
        options: GROUPS,
        value: group,
        onChange: (v) => ctx.setParams({ group: v }),
      }),
      data.scratch_hidden
        ? h(
            "span",
            { class: "meta grow" },
            `${num(data.scratch_hidden)} scratch items hidden.`,
          )
        : null,
    );
    const table = Table({
      columns: [
        {
          key: "ts",
          label: "When",
          class: "num",
          render: (r) => relTime(r.ts),
        },
        {
          key: "kind",
          label: "Kind",
          render: (r) => Badge(kindLabel(kinds, r.kind), statusTone(r.status)),
        },
        {
          key: "project",
          label: "Project",
          render: (r) => projectLabel(r.project),
        },
        {
          key: "agent",
          label: "Agent",
          render: (r) => (r.agent ? h("span", { class: "mono" }, r.agent) : ""),
        },
        {
          key: "title",
          label: "What happened",
          render: (r) =>
            Disclosure(open, r.id, truncate(r.title, 90), detail(r)),
        },
      ],
      rows,
      empty: Empty({
        title: "Nothing recorded in this window.",
        body: "Try a longer window or clear the kind filter.",
      }),
    });
    return h(
      "div",
      { class: "stack" },
      filters,
      table,
      data.truncated &&
        h("p", { class: "meta" }, "Showing the newest items only."),
    );
  }

  return mountView(ctx.root, header, {
    load: () =>
      get("/api/v2/activity", {
        window: win,
        group,
        kind,
        project: projectParam(ctx.project),
      }),
    paint,
    rows: 8,
  });
}
