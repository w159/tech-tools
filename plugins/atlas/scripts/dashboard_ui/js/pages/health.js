// Health (brief 5.6): subsystem rows with evidence, silent failures, successes.
import { h, relTime, num, truncate } from "../dom.js";
import { get, topics } from "../api.js";
import { PageHeader, Panel, Table, StateDot, Sparkline, Empty } from "../ui.js";
import {
  normalizeWindow,
  projectParam,
  projectLabel,
} from "./monitor-model.js";
import {
  healthState,
  hasHistory,
  successLabel,
  failureLabel,
  sortSubsystems,
} from "./health-model.js";
import { mountView, WindowControl, Disclosure } from "./monitor-view.js";

function subsystemRow(open, sub) {
  const st = healthState(sub);
  const measured = sub.measured !== false;
  const times = measured
    ? h(
        "span",
        { class: "meta num" },
        `last ok ${sub.last_ok ? `${relTime(sub.last_ok)} ago` : "never"}`,
        sub.last_fail ? ` - last fail ${relTime(sub.last_fail)} ago` : "",
      )
    : null;
  const trend = measured
    ? hasHistory(sub)
      ? Sparkline({ buckets: sub.history })
      : h(
          "span",
          { class: "meta", title: sub.history_reason || "" },
          "No history",
        )
    : null;
  const head = h(
    "div",
    { class: "sub-head" },
    StateDot(st.raw, { word: st.word }),
    h("strong", {}, sub.label || sub.id),
    h(
      "span",
      { class: "sub-detail" },
      measured
        ? truncate(sub.detail || "", 160)
        : `Not measured: ${sub.reason || sub.detail || "no data source yet"}`,
    ),
    times,
    trend,
  );
  const evidence = (sub.evidence || []).length
    ? (sub.evidence || []).map((e) => h("p", { class: "mono wrap" }, e))
    : [h("p", { class: "meta" }, "No evidence lines.")];
  if (sub.history_source)
    evidence.push(h("p", { class: "meta" }, `History: ${sub.history_source}`));
  else if (measured && sub.history_reason)
    evidence.push(
      h("p", { class: "meta" }, `No history: ${sub.history_reason}`),
    );
  return h(
    "li",
    { class: "sub-row", id: `sub-${sub.id}` },
    Disclosure(open, sub.id, head, evidence),
  );
}

function failuresPanel(open, rows) {
  return Panel(
    { title: "Silent failures", flush: true },
    Table({
      columns: [
        {
          key: "kind",
          label: "What failed",
          render: (r) =>
            Disclosure(open, r.id || r.kind + r.project, failureLabel(r.kind), [
              h("p", { class: "mono wrap" }, r.sample || ""),
              r.hint && h("p", { class: "meta" }, r.hint),
              r.next && h("p", { class: "meta" }, r.next),
            ]),
        },
        {
          key: "project",
          label: "Project",
          render: (r) => projectLabel(r.project),
        },
        {
          key: "count",
          label: "Count",
          class: "num",
          render: (r) => num(r.count),
        },
        {
          key: "last",
          label: "Last",
          class: "num",
          render: (r) => `${relTime(r.last)} ago`,
        },
      ],
      rows,
      empty: Empty({ title: "No silent failures in this window." }),
    }),
  );
}

export function render(ctx) {
  const win = normalizeWindow(ctx.params.window);
  const open = new Set(ctx.params.focus ? [ctx.params.focus] : []);
  const header = PageHeader({
    title: "Health",
    description: "Is Atlas itself working?",
    actions: WindowControl(ctx),
  });
  return mountView(ctx.root, header, {
    stores: [topics.health],
    load: () =>
      get("/api/v2/health", {
        window: win,
        project: projectParam(ctx.project),
      }),
    paint: (data) =>
      h(
        "div",
        { class: "stack" },
        Panel(
          { title: "Subsystems", flush: true },
          h(
            "ul",
            { class: "sub-list" },
            sortSubsystems(data.subsystems).map((s) => subsystemRow(open, s)),
          ),
        ),
        failuresPanel(open, data.silent_failures || []),
        Panel(
          { title: "Successes" },
          (data.successes || []).length
            ? h(
                "ul",
                { class: "success-list" },
                data.successes.map((s) =>
                  h(
                    "li",
                    {},
                    h("strong", { class: "num" }, num(s.count)),
                    ` ${successLabel(s.kind)}`,
                    h(
                      "span",
                      { class: "meta" },
                      `, last ${relTime(s.last)} ago`,
                    ),
                  ),
                ),
              )
            : h("p", { class: "meta" }, "Nothing succeeded in this window."),
        ),
      ),
  });
}
