// Overview (brief 5.1): needs you, six numbers, running now, recent runs.
import { h, relTime, duration, num, delta, truncate } from "../dom.js";
import { get, topics } from "../api.js";
import { buildHash } from "../router.js";
import {
  PageHeader,
  Panel,
  KPI,
  Table,
  StateDot,
  Badge,
  Button,
  Empty,
} from "../ui.js";
import {
  normalizeWindow,
  projectParam,
  projectLabel,
  secondsBetween,
  severityState,
  parseTarget,
} from "./monitor-model.js";
import {
  kpiLink,
  runningNow,
  waitingAgents,
  runState,
} from "./overview-model.js";
import { mountView, WindowControl } from "./monitor-view.js";

const MAX_ATTENTION = 8;

function needsPanel(ctx, overview, agents) {
  const waiting = waitingAgents(agents, ctx.project);
  const items = overview.attention || [];
  const rows = [];
  for (const a of waiting) {
    rows.push(
      h(
        "li",
        { class: "attn-row" },
        StateDot("input"),
        h(
          "div",
          { class: "attn-main" },
          h("strong", {}, a.name),
          h(
            "span",
            { class: "meta" },
            `${projectLabel(a.project)} - waiting ${relTime(a.since) || "now"}`,
          ),
        ),
        Button(
          {
            size: "sm",
            onClick: () =>
              ctx.navigate("agents", {
                agent: a.key,
                project: projectParam(ctx.project),
              }),
          },
          "Open",
        ),
      ),
    );
  }
  for (const it of items.slice(0, MAX_ATTENTION)) {
    const sev = severityState(it.severity);
    const target = parseTarget(it.action && it.action.target);
    rows.push(
      h(
        "li",
        { class: "attn-row" },
        StateDot(sev.raw, { word: sev.word }),
        h(
          "div",
          { class: "attn-main" },
          h("strong", {}, truncate(it.title, 90)),
          h(
            "span",
            { class: "meta" },
            truncate(it.detail || it.what || "", 140),
          ),
        ),
        target.route &&
          Button(
            {
              size: "sm",
              onClick: () =>
                ctx.navigate(target.route, {
                  project: projectParam(ctx.project),
                  focus: target.focus,
                }),
            },
            (it.action && it.action.label) || "Open",
          ),
      ),
    );
  }
  const more = items.length - MAX_ATTENTION;
  return Panel(
    { title: "Needs you" },
    rows.length
      ? h("ul", { class: "attn-list" }, rows)
      : h(
          "p",
          { class: "calm" },
          StateDot("done", { word: "Nothing needs you." }),
        ),
    more > 0 && h("p", { class: "meta" }, `${more} more in Health.`),
  );
}

function numbers(ctx, overview) {
  const p = projectParam(ctx.project);
  const win = normalizeWindow(ctx.params.window);
  const tiles = (overview.kpis || []).slice(0, 6).map((k) => {
    const link = kpiLink(k.id);
    const d = delta(k.delta);
    return KPI({
      label: k.label,
      value: num(k.value),
      delta: d ? `${d}% vs previous ${win}` : "",
      href: link
        ? buildHash(link.route, { ...link.params, project: p, window: win })
        : undefined,
    });
  });
  return h("div", { class: "grid-kpi" }, tiles);
}

function runningPanel(ctx, agents) {
  const rows = runningNow(agents, ctx.project, 8);
  return Panel(
    {
      title: "Running now",
      actions: h(
        "a",
        { href: buildHash("agents", { project: projectParam(ctx.project) }) },
        "See all agents",
      ),
    },
    Table({
      columns: [
        { key: "state", label: "State", render: (r) => StateDot(r.state) },
        {
          key: "name",
          label: "Agent",
          render: (r) => h("span", { class: "mono" }, r.name),
        },
        { key: "task", label: "Task", render: (r) => truncate(r.task, 60) },
        {
          key: "since",
          label: "Since",
          class: "num",
          render: (r) => relTime(r.since),
        },
      ],
      rows,
      empty: Empty({ title: "No agents running." }),
    }),
  );
}

function runsPanel(overview) {
  const rows = (overview.recent_runs || []).slice(0, 10);
  return Panel(
    { title: "Recent runs" },
    Table({
      columns: [
        {
          key: "started",
          label: "Started",
          class: "num",
          render: (r) => relTime(r.started),
        },
        {
          key: "project",
          label: "Project",
          render: (r) => projectLabel(r.project),
        },
        { key: "kind", label: "Kind", render: (r) => Badge(r.kind || "run") },
        {
          key: "task",
          label: "Task",
          render: (r) => truncate(r.task || "", 50),
        },
        {
          key: "dur",
          label: "Duration",
          class: "num",
          render: (r) =>
            runState(r) === "running"
              ? "running"
              : duration(secondsBetween(r.started, r.ended)),
        },
      ],
      rows,
      empty: Empty({ title: "No runs in this window." }),
    }),
  );
}

export function render(ctx) {
  const win = normalizeWindow(ctx.params.window);
  const header = PageHeader({
    title: "Overview",
    description: "What needs you, what is running, what broke.",
    actions: WindowControl(ctx),
  });
  let unsubAgents = null;
  const stop = mountView(ctx.root, header, {
    stores: [topics.health],
    load: async () => {
      const [overview, agents] = await Promise.all([
        get("/api/v2/overview", {
          window: win,
          project: projectParam(ctx.project),
        }),
        topics.agents.get() || get("/api/v2/agents"),
      ]);
      return { overview, agents };
    },
    paint: ({ overview, agents }) => {
      // The agent-driven panels repaint on the live agents topic without refetching the numbers.
      const needs = h("div", {}, needsPanel(ctx, overview, agents));
      const running = h("div", {}, runningPanel(ctx, agents));
      if (unsubAgents) unsubAgents();
      unsubAgents = topics.agents.subscribe((a) => {
        if (!a) return;
        needs.replaceChildren(needsPanel(ctx, overview, a));
        running.replaceChildren(runningPanel(ctx, a));
      });
      return h(
        "div",
        { class: "stack" },
        needs,
        numbers(ctx, overview),
        h("div", { class: "cols-2" }, running, runsPanel(overview)),
      );
    },
  });
  return () => {
    stop();
    if (unsubAgents) unsubAgents();
  };
}
