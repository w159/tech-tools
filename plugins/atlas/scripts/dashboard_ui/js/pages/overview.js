// Overview: KPIs, attention feed (actionable only), trend, recent runs.

import { h, debounce, fmtRelative, patchInto } from "../dom.js";
import { stableJson } from "../api.js";
import { Kpi, Card, Badge, StatusDot, Table, LineChart, EmptyState, toastError } from "../components.js";
import { IntegrationsRow } from "../integrations.js";

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
      item.what ? h("div", { class: "detail" }, item.what) : null,
      item.next ? h("div", { class: "detail" }, h("strong", null, "Do this: "), item.next) : null,
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
      { key: "status", label: "State", render: (r) => Badge({ status: r.state === "done" ? "ok" : r.state === "running" ? "info" : "warn", text: r.state === "unfinished" ? "never closed" : r.state || "done" }) },
      { key: "name", label: "Session turn", render: (r) => h("span", null, r.task || [r.kind, r.model].filter(Boolean).join(" · ") || "(no summary)") },
      { key: "project", label: "Project", render: (r) => (r.project ? String(r.project).split("/").filter(Boolean).pop() : "") },
      { key: "started", label: "Started", render: (r) => h("span", { class: "dim", style: { whiteSpace: "nowrap" } }, fmtRelative(r.started || r.ts)) },
    ],
  });
}

// Overview data = the overview payload plus a health roll-up and live agent counts, fetched together so one key covers all.
async function fetchAll(ctx) {
  const [ov, health] = await Promise.all([
    ctx.api.get("overview", { project: ctx.project, window: "7d" }),
    ctx.api.get("/api/v2/health", { window: "7d", ...(ctx.project && ctx.project !== "all" ? { project: ctx.project } : {}) }).catch(() => null),
  ]);
  return { ...ov, health, counts: { ...ctx.agents.getState().counts } };
}

// "Is Atlas healthy, what is running, what needs me" — three answers, each a link into its detail page.
function healthKpi(d, ctx) {
  const subs = (d.health && d.health.subsystems) || [];
  const bad = subs.filter((s) => s.status === "fail").length;
  const warn = subs.filter((s) => s.status === "warn").length;
  let value = "Healthy";
  let status = "ok";
  if (!d.health) {
    value = "Unknown";
    status = undefined;
  } else if (bad) {
    value = bad + " failing";
    status = "fail";
  } else if (warn) {
    value = warn + " warning" + (warn > 1 ? "s" : "");
    status = "warn";
  }
  const hint = d.health ? bad + " failing, " + warn + " warning of " + subs.length + " subsystems, last 7 days (same as the Health page). Open Health." : "Health check did not answer.";
  return Kpi({ label: "Is Atlas healthy?", value, status, hint, onClick: () => ctx.navigate("health") });
}

function needsKpi(c, attention, ctx) {
  const input = c.input || 0;
  const fail = c.fail || 0;
  const items = attention.filter((a) => a.severity === "fail" || a.severity === "warn").length;
  const needs = input + fail + items;
  const hint = needs ? input + " agents waiting for input, " + fail + " failed, " + items + " attention items below. Same count as the top bar." : "Nothing is waiting on you.";
  return Kpi({ label: "What needs me?", value: String(needs), status: needs ? "warn" : "ok", hint, onClick: () => ctx.navigate(input || fail ? "agents" : "overview#attention") });
}

function glance(d, ctx, attention) {
  const c = d.counts || {};
  return h(
    "div",
    { class: "kpi-grid ov-glance" },
    healthKpi(d, ctx),
    Kpi({ label: "What is running now?", value: String(c.working || 0), status: c.working ? "ok" : undefined, hint: (c.working || 0) + " working, " + (c.idle || 0) + " ready. Open Agents.", onClick: () => ctx.navigate("agents") }),
    needsKpi(c, attention, ctx)
  );
}

function pageHead(ctx) {
  const sub = ctx.project === "all" ? "Everything Atlas touched across your projects in the last 7 days." : "Last 7 days in " + (ctx.project.split("/").filter(Boolean).pop() || ctx.project) + ".";
  return h("div", { class: "page-head" }, h("div", null, h("h1", null, "Overview"), h("p", { class: "sub" }, sub)));
}

function weekKpi(k, ctx) {
  const noDelta = k.delta === null || k.delta === undefined;
  const hint = noDelta && typeof k.prior === "number" ? "prior 7 days: " + k.prior + ". " + (k.hint || "") : k.hint;
  const target = { agents: "agents", todos: "agents?lens=board" }[k.id];
  return Kpi({ label: k.label, value: k.value, delta: k.delta, status: k.status, hint, onClick: target ? () => ctx.navigate(target) : null });
}

function attentionCard(d, attention, ctx) {
  const actionable = attention.filter((a) => a.severity === "fail" || a.severity === "warn").length;
  const historic = d.attention_historic;
  return Card({
    id: "attention",
    title: "Needs you: attention items" + (attention.length ? " (" + actionable + ")" : ""),
    flush: true,
    children: [
      attention.length
        ? h("ul", { class: "attn-list" }, attention.map((a) => attentionItem(a, ctx)))
        : h("div", { style: { padding: "var(--pad-card)" } }, h("div", { class: "row" }, StatusDot({ status: "ok" }), h("span", null, "Nothing needs you right now. Failures, stuck agents and blocked work show up here when they happen."))),
      historic ? h("div", { class: "detail", style: { padding: "var(--pad-card)" } }, historic + " older failure" + (historic > 1 ? "s" : "") + " in the last 7 days have not recurred in 24h and need no action; they are listed as historic in Health.") : null,
    ],
  });
}

function sideColumn(trend, runs) {
  const t = trend || { labels: [], series: [] };
  return h(
    "div",
    { class: "stack" },
    Card({ title: "Activity trend", children: [t.series && t.series.length ? LineChart({ labels: t.labels, series: t.series, height: 160 }) : h("p", { class: "dim" }, "No trend data yet.")] }),
    Card({ title: "Recent runs", flush: true, children: [runsTable(runs)] })
  );
}

function emptyOverview() {
  return EmptyState({ icon: "overview", title: "No Atlas activity recorded yet", body: "Run a session with the Atlas plugin enabled and this page fills in. Start with a project that has a .atlas directory.", command: "atlas doctor" });
}

let refresher = null;
let lastKey = "";

export default {
  id: "overview",
  title: "Overview",
  icon: "overview",
  group: "Observe",

  async load(ctx) {
    return fetchAll(ctx);
  },
  render(ctx, data) {
    const d = data || {};
    lastKey = stableJson(d);
    const kpis = d.kpis || [];
    const attention = d.attention || [];
    ctx.store.set("attention", attention);
    const runs = d.recent_runs || [];

    const root = h("div", { class: "page", id: "overview-root" });
    root.appendChild(pageHead(ctx));
    root.appendChild(IntegrationsRow());

    root.appendChild(h("h2", { class: "ov-h" }, "Right now", h("span", { class: "dim" }, " — click a card for the detail page")));
    root.appendChild(glance(d, ctx, attention));
    root.appendChild(h("h2", { class: "ov-h" }, "Last 7 days", h("span", { class: "dim" }, " — counted from the Atlas database")));
    root.appendChild(kpis.length ? h("div", { class: "kpi-grid" }, kpis.map((k) => weekKpi(k, ctx))) : null);
    root.appendChild(h("div", { class: "ov-grid" }, attentionCard(d, attention, ctx), sideColumn(d.trend, runs)));
    if (!kpis.length && !attention.length && !runs.length) root.appendChild(emptyOverview());
    return root;
  },

  onEvent(evt, ctx) {
    if (evt !== "health" && evt !== "herd" && evt !== "todos" && !(evt === "tick" && ctx.api.mode === "poll")) return;
    if (!refresher) {
      refresher = debounce(async () => {
        try {
          const data = await fetchAll(ctx);
          ctx.store.set("attention", data.attention || []);
          const key = stableJson(data);
          if (key === lastKey) return;
          lastKey = key;
          const host = document.getElementById("page-root");
          const old = document.getElementById("overview-root");
          if (host && old) patchInto(old, this.render(ctx, data));
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
