// Overview: KPIs, attention feed (actionable only), trend, recent runs.

import { h, debounce, fmtRelative } from "../dom.js";
import { Kpi, Card, Badge, StatusDot, Table, LineChart, EmptyState, toastError } from "../components.js";

function attentionItem(item, ctx) {
  const sev = item.severity === "fail" || item.severity === "warn" ? item.severity : "info";
  const meta = [];
  if (item.project) meta.push(String(item.project).split("/").filter(Boolean).pop() || item.project);
  if (item.count > 1) meta.push(item.count + " occurrences");
  if (item.last) meta.push("last " + fmtRelative(item.last));
  const action = item.action && item.action.target ? item.action : null;
  return h(
    "li",
    { class: "attn-item", "data-severity": sev },
    StatusDot({ status: sev }),
    h(
      "div",
      { class: "grow" },
      h("div", { class: "title" }, h("span", { class: "sr-only" }, sev === "fail" ? "Failure: " : sev === "warn" ? "Warning: " : "Note: "), item.title || "Untitled"),
      item.detail ? h("div", { class: "detail" }, item.detail) : null,
      meta.length ? h("div", { class: "meta" }, meta.join("  |  ")) : null
    ),
    action ? h("button", { class: "btn btn-sm", type: "button", onClick: () => ctx.navigate(action.target) }, action.label || "Open") : null
  );
}

function runsTable(rows) {
  return Table({
    dense: true,
    caption: "Recent runs",
    empty: "No runs in this window.",
    rows,
    columns: [
      { key: "status", label: "State", render: (r) => Badge({ status: r.status || (r.ended ? "done" : "running") }) },
      { key: "name", label: "Run", render: (r) => h("span", { class: "mono" }, "#" + (r.id || r.run || "?")), },
      { key: "project", label: "Project", render: (r) => (r.project ? String(r.project).split("/").filter(Boolean).pop() : "") },
      { key: "started", label: "Started", render: (r) => h("span", { class: "dim", style: { whiteSpace: "nowrap" } }, fmtRelative(r.started || r.ts)) },
    ],
  });
}

let refresher = null;

export default {
  id: "overview",
  title: "Overview",
  icon: "overview",
  group: "Observe",

  async load(ctx) {
    return ctx.api.get("overview", { project: ctx.project, window: "7d" });
  },

  render(ctx, data) {
    const d = data || {};
    const kpis = d.kpis || [];
    const attention = d.attention || [];
    ctx.store.set("attention", attention);
    const trend = d.trend || { labels: [], series: [] };
    const runs = d.recent_runs || [];

    const root = h("div", { class: "page", id: "overview-root" });
    root.appendChild(
      h(
        "div",
        { class: "page-head" },
        h("div", null, h("h1", null, "Overview"), h("p", { class: "sub" }, ctx.project === "all" ? "Everything Atlas touched across your projects in the last 7 days." : "Last 7 days in " + (ctx.project.split("/").filter(Boolean).pop() || ctx.project) + "."))
      )
    );

    root.appendChild(kpis.length ? h("div", { class: "kpi-grid" }, kpis.map((k) => Kpi({ label: k.label, value: k.value, delta: k.delta, status: k.status, hint: k.hint, onClick: k.id === "agents" ? () => ctx.navigate("colony") : k.id === "todos" ? () => ctx.navigate("work") : null }))) : null);

    const attn = Card({
      id: "attention",
      title: "Needs attention" + (attention.length ? " (" + attention.length + ")" : ""),
      flush: true,
      children: [
        attention.length
          ? h("ul", { class: "attn-list" }, attention.map((a) => attentionItem(a, ctx)))
          : h("div", { style: { padding: "var(--pad-card)" } }, h("div", { class: "row" }, StatusDot({ status: "ok" }), h("span", null, "Nothing needs you right now. Failures, stuck agents and blocked work show up here when they happen."))),
      ],
    });

    const side = h(
      "div",
      { class: "stack" },
      Card({ title: "Activity trend", children: [trend.series && trend.series.length ? LineChart({ labels: trend.labels, series: trend.series, height: 160 }) : h("p", { class: "dim" }, "No trend data yet.")] }),
      Card({ title: "Recent runs", flush: true, children: [runsTable(runs)] })
    );

    root.appendChild(h("div", { class: "ov-grid" }, attn, side));
    if (!kpis.length && !attention.length && !runs.length) {
      root.appendChild(EmptyState({ icon: "overview", title: "No Atlas activity recorded yet", body: "Run a session with the Atlas plugin enabled and this page fills in. Start with a project that has a .atlas directory.", command: "atlas doctor" }));
    }
    return root;
  },

  onEvent(evt, ctx) {
    if (evt !== "health" && evt !== "colony" && evt !== "todos") return;
    if (!refresher) {
      refresher = debounce(async () => {
        try {
          const data = await ctx.api.get("overview", { project: ctx.project, window: "7d" });
          ctx.store.set("attention", data.attention || []);
          const host = document.getElementById("page-root");
          const old = document.getElementById("overview-root");
          if (host && old) host.replaceChild(this.render(ctx, data), old);
        } catch (err) {
          toastError(err);
        }
      }, 2500);
    }
    refresher();
  },

  destroy() {
    if (refresher) refresher.cancel();
    refresher = null;
  },
};
