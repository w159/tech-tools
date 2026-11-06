import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "../rich-dom.js";
import { api } from "../api.js";
import { fetchFailures, clearFetchFail } from "../fetch-fail.js";

let dom, page, timers, calls, nav, stored, savedGet, savedNow, seq = 0, ctx, answers;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const realNow = Date.now;
const until = async (cond, what = "condition") => { const end = realNow() + 2000; while (!cond()) { if (realNow() > end) throw new Error("timed out: " + what); await new Promise((r) => realTimers.setTimeout(r, 1)); } };

beforeEach(async () => {
  dom = installRichDom();
  page = (await import("./overview.js?n=" + ++seq)).default;
  timers = [];
  calls = [];
  nav = [];
  stored = {};
  answers = { overview: {}, health: { subsystems: [] } };
  globalThis.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
  globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1] = [null, 0]; };
  savedGet = api.get;
  savedNow = Date.now;
  Date.now = () => realNow() + seq * 1_000_000; // the integrations cache is keyed on the clock; never serve another test's read
  api.get = async () => ({ tools: [] });
  ctx = {
    project: "/w/app",
    navigate: (t) => nav.push(t),
    api: {
      mode: "live",
      get: async (path, q) => {
        calls.push([path, q]);
        const a = path === "overview" ? answers.overview : answers.health;
        if (a instanceof Error) throw a;
        return a;
      },
      post: async (path, body) => { calls.push(["POST " + path, body]); return {}; },
    },
    store: { set: (k, v) => { stored[k] = v; } },
    agents: { getState: () => ({ counts: answers.counts || {} }) },
  };
});
afterEach(async () => {
  page.destroy();
  await new Promise((r) => realTimers.setTimeout(r, 0)); // let the integrations row finish painting into the still-installed DOM
  for (const f of fetchFailures()) clearFetchFail(f.endpoint);
  api.get = savedGet;
  Date.now = savedNow;
  globalThis.setTimeout = realTimers.setTimeout;
  globalThis.clearTimeout = realTimers.clearTimeout;
  restoreRichDom();
});

const render = (data, over = {}) => { Object.assign(ctx, over); const root = page.render(ctx, data); dom.body.appendChild(root); return root; };
const kpiBy = (root, label) => [...root.querySelectorAll(".kpi")].find((k) => k.querySelector(".kpi-label").textContent === label);
const val = (k) => k.querySelector(".kpi-value").textContent;
const hint = (k) => (k.querySelector(".kpi-hint") || { textContent: null }).textContent;

describe("overview page", () => {
  test("describes itself in the Observe group", () => {
    expect([page.id, page.title, page.icon, page.group]).toEqual(["overview", "Overview", "overview", "Observe"]);
  });

  describe("load", () => {
    test("reads the 7 day overview for the project and the health roll-up, merging both with the agent counts", async () => {
      answers.overview = { kpis: [{ id: "x" }] };
      answers.health = { subsystems: [{ status: "ok" }] };
      answers.counts = { working: 2 };
      const d = await page.load(ctx);
      expect(calls).toEqual([["overview", { project: "/w/app", window: "7d" }], ["/api/v2/health", { window: "7d", project: "/w/app" }]]);
      expect(d.kpis).toEqual([{ id: "x" }]);
      expect(d.health).toEqual({ subsystems: [{ status: "ok" }] });
      expect(d.counts).toEqual({ working: 2 });
    });
    test("the all-projects view sends no project to health, and no project means none either", async () => {
      ctx.project = "all";
      await page.load(ctx);
      expect(calls[1]).toEqual(["/api/v2/health", { window: "7d" }]);
      calls.length = 0;
      ctx.project = "";
      await page.load(ctx);
      expect(calls[1]).toEqual(["/api/v2/health", { window: "7d" }]);
    });
    test("the counts are a copy, so later store changes do not leak in", async () => {
      answers.counts = { working: 1 };
      const d = await page.load(ctx);
      answers.counts.working = 9;
      expect(d.counts.working).toBe(1);
    });
    test("a failing health read yields health null and is reported once, then cleared when it recovers", async () => {
      answers.health = new Error("down");
      const d = await page.load(ctx);
      expect(d.health).toBeNull();
      expect(fetchFailures().map((f) => f.endpoint)).toEqual(["/api/v2/health"]);
      answers.health = { subsystems: [] };
      await page.load(ctx);
      expect(fetchFailures()).toEqual([]);
    });
    test("a failing overview read rejects the load", async () => {
      answers.overview = new Error("boom");
      await expect(page.load(ctx)).rejects.toThrow("boom");
    });
  });

  describe("header", () => {
    test("all projects, or the last path segment of the current one", () => {
      expect(render({}, { project: "all" }).querySelector(".sub").textContent).toBe("Everything Atlas touched across your projects in the last 7 days.");
      expect(render({}, { project: "/w/app/" }).querySelector(".sub").textContent).toBe("Last 7 days in app.");
    });
    test("a project that is only slashes is shown as given", () => {
      expect(render({}, { project: "/" }).querySelector(".sub").textContent).toBe("Last 7 days in /.");
    });
  });

  describe("right now", () => {
    const glanceOf = (data) => { const r = render(data); return { r, healthK: kpiBy(r, "Is Atlas healthy?"), run: kpiBy(r, "What is running now?"), need: kpiBy(r, "What needs me?") }; };
    test("health is Healthy when no subsystem fails or warns, with the counts in the hint", () => {
      const { healthK } = glanceOf({ health: { subsystems: [{ status: "ok" }, { status: "ok" }] } });
      expect(val(healthK)).toBe("Healthy");
      expect(healthK.querySelector(".sr-only").textContent).toBe("status Healthy");
      expect(hint(healthK)).toBe("0 failing, 0 warning of 2 subsystems, last 7 days (same as the Health page). Open Health.");
    });
    test("failures win over warnings and are counted", () => {
      const { healthK } = glanceOf({ health: { subsystems: [{ status: "fail" }, { status: "fail" }, { status: "warn" }] } });
      expect(val(healthK)).toBe("2 failing");
      expect(healthK.querySelector(".sr-only").textContent).toContain("Failed");
    });
    test("warnings alone pluralise correctly", () => {
      expect(val(glanceOf({ health: { subsystems: [{ status: "warn" }] } }).healthK)).toBe("1 warning");
      expect(val(glanceOf({ health: { subsystems: [{ status: "warn" }, { status: "warn" }] } }).healthK)).toBe("2 warnings");
    });
    test("no health answer reads Unknown with no status and says the check did not answer", () => {
      const { healthK } = glanceOf({ health: null });
      expect(val(healthK)).toBe("Unknown");
      expect(healthK.querySelector(".sr-only")).toBeNull();
      expect(hint(healthK)).toBe("Health check did not answer.");
    });
    test("health with no subsystems list is healthy", () => {
      expect(val(glanceOf({ health: {} }).healthK)).toBe("Healthy");
    });
    test("clicking the health tile opens Health", () => {
      fire(glanceOf({ health: null }).healthK, "click");
      expect(nav).toEqual(["health"]);
    });
    test("running shows the working count with an ok status and opens Agents", () => {
      const { run } = glanceOf({ counts: { working: 3, idle: 4 } });
      expect(val(run)).toBe("3");
      expect(hint(run)).toBe("3 working, 4 ready. Open Agents.");
      expect(run.querySelector(".sr-only").textContent).toBe("status Healthy");
      fire(run, "click");
      expect(nav).toEqual(["agents"]);
    });
    test("nothing running has no status", () => {
      const { run } = glanceOf({});
      expect(val(run)).toBe("0");
      expect(hint(run)).toBe("0 working, 0 ready. Open Agents.");
      expect(run.querySelector(".sr-only")).toBeNull();
    });
    test("what needs me adds waiting, failed and actionable attention items; info items do not count", () => {
      const { need } = glanceOf({ counts: { input: 2, fail: 1 }, attention: [{ severity: "fail" }, { severity: "warn" }, { severity: "info" }] });
      expect(val(need)).toBe("5");
      expect(hint(need)).toBe("2 agents waiting for input, 1 failed, 2 attention items below. Same count as the top bar.");
      expect(need.querySelector(".sr-only").textContent).toContain("Warn");
    });
    test("nothing waiting is ok and says so", () => {
      const { need } = glanceOf({ attention: [{ severity: "info" }] });
      expect(val(need)).toBe("0");
      expect(hint(need)).toBe("Nothing is waiting on you.");
      expect(need.querySelector(".sr-only").textContent).toBe("status Healthy");
    });
    test("what needs me opens Agents when agents wait, else the attention card", () => {
      fire(glanceOf({ counts: { input: 1 } }).need, "click");
      fire(glanceOf({ counts: { fail: 1 } }).need, "click");
      fire(glanceOf({ counts: {} }).need, "click");
      expect(nav).toEqual(["agents", "agents", "overview#attention"]);
    });
  });

  describe("last 7 days", () => {
    test("each KPI shows value, delta and hint; agents and todos open their pages, others are not clickable", () => {
      const r = render({ kpis: [{ id: "agents", label: "Agents", value: 7, delta: 3, hint: "h1" }, { id: "todos", label: "Todos", value: 2 }, { id: "other", label: "Other", value: 1 }] });
      expect(val(kpiBy(r, "Agents"))).toBe("7");
      expect(hint(kpiBy(r, "Agents"))).toBe("h1");
      fire(kpiBy(r, "Agents"), "click");
      fire(kpiBy(r, "Todos"), "click");
      expect(nav).toEqual(["agents", "agents?lens=board"]);
      expect(kpiBy(r, "Other").tagName.toLowerCase()).toBe("div");
      expect(kpiBy(r, "Agents").tagName.toLowerCase()).toBe("button");
    });
    test("with no delta but a numeric prior, the hint leads with the prior week", () => {
      const r = render({ kpis: [{ id: "a", label: "A", value: 1, prior: 5, hint: "extra" }, { id: "b", label: "B", value: 1, prior: 0, delta: null }, { id: "c", label: "C", value: 1, prior: 5, delta: 0 }] });
      expect(hint(kpiBy(r, "A"))).toBe("prior 7 days: 5. extra");
      expect(hint(kpiBy(r, "B"))).toBe("prior 7 days: 0. ");
      expect(hint(kpiBy(r, "C"))).toBeNull();
    });
    test("no KPIs means no week grid", () => {
      const r = render({ attention: [{ title: "x" }] });
      expect(r.querySelectorAll(".kpi-grid")).toHaveLength(1);
      expect(render({ kpis: [{ id: "a", label: "A", value: 1 }] }).querySelectorAll(".kpi-grid")).toHaveLength(2);
    });
  });

  describe("attention card", () => {
    const item = (over = {}) => ({ title: "Daemon down", severity: "fail", ...over });
    const items = (r) => r.querySelectorAll(".attn-item");
    test("empty list reassures", () => {
      const r = render({});
      expect(r.querySelector("#attention .card-head h2").textContent).toBe("Needs you: attention items");
      expect(r.querySelector("#attention").textContent).toContain("Nothing needs you right now.");
    });
    test("the title counts only actionable items", () => {
      const r = render({ attention: [item(), item({ severity: "warn" }), item({ severity: "info" })] });
      expect(r.querySelector("#attention .card-head h2").textContent).toBe("Needs you: attention items (2)");
      expect(items(r)).toHaveLength(3);
    });
    test("severity picks the marker word, unknown severity falls back to a note", () => {
      const r = render({ attention: [item(), item({ severity: "warn" }), item({ severity: "weird" }), item({ severity: undefined })] });
      const marks = items(r).map((li) => [li.getAttribute("data-severity"), li.querySelector(".sr-only").textContent]);
      expect(marks).toEqual([["fail", "Failure: "], ["warn", "Warning: "], ["info", "Note: "], ["info", "Note: "]]);
    });
    test("shows title (or Untitled), detail, what, and a Do this line when given", () => {
      const r = render({ attention: [item({ detail: "d", what: "w", next: "n" }), item({ title: "" })] });
      const [a, b] = items(r);
      expect(a.querySelector(".title").textContent).toBe("Failure: Daemon down");
      expect([...a.querySelectorAll(".detail")].map((x) => x.textContent)).toEqual(["d", "w", "Do this: n"]);
      expect(a.querySelector("strong").textContent).toBe("Do this: ");
      expect(b.querySelector(".title").textContent).toBe("Failure: Untitled");
      expect(b.querySelectorAll(".detail")).toHaveLength(0);
      expect(b.querySelector(".meta")).toBeNull();
    });
    test("meta joins project folder, occurrence count above one, and a relative last time", () => {
      const r = render({ attention: [item({ project: "/w/app/", count: 3, last: new Date(Date.now() - 3600_000).toISOString() }), item({ count: 1 }), item({ project: "/" })] });
      const metas = items(r).map((li) => (li.querySelector(".meta") || { textContent: null }).textContent);
      expect(metas[0]).toMatch(/^app {2}\|  3 occurrences {2}\|  last /);
      expect(metas[1]).toBeNull();
      expect(metas[2]).toBe("/");
    });
    test("an item action with a target gets a button that navigates, defaulting its label to Open", () => {
      const r = render({ attention: [item({ action: { target: "health#x", label: "Go" } }), item({ action: { target: "t2" } }), item({ action: { label: "dead" } })] });
      const btns = items(r).map((li) => [...li.querySelectorAll("button")].filter((b) => b.className.includes("btn-sm")));
      expect(btns.map((b) => b.map((x) => x.textContent))).toEqual([["Go"], ["Open"], []]);
      fire(btns[0][0], "click");
      fire(btns[1][0], "click");
      expect(nav).toEqual(["health#x", "t2"]);
    });
    test("an item with a kind gets a fix button and a dismiss button; without a kind neither", () => {
      const r = render({ attention: [item({ kind: "k", finding_id: "f1" }), item()] });
      const [a, b] = items(r);
      expect([...a.querySelectorAll("button")].map((x) => x.textContent)).toEqual(["Open in Improve", "Dismiss"]);
      expect(b.querySelectorAll("button")).toHaveLength(0);
      fire(a.querySelector("button"), "click");
      expect(nav).toEqual(["improve?finding=f1"]);
    });
    test("dismissing posts the id, then refetches and repaints in place without the item", async () => {
      const root = render({ attention: [item({ kind: "k", id: "d1", finding_id: "f1" })] });
      answers.overview = { attention: [] };
      const dismiss = [...root.querySelectorAll("button")].find((b) => b.textContent === "Dismiss");
      fire(dismiss, "click");
      await until(() => root.querySelectorAll(".attn-item").length === 0, "item removed");
      expect(calls.find((c) => c[0] === "POST /api/v2/dismiss")[1]).toEqual({ id: "d1" });
      expect(calls.some((c) => c[0] === "overview")).toBe(true);
      expect(dom.doc.getElementById("overview-root")).toBe(root);
    });
    test("older failures are explained, singular and plural", () => {
      expect(render({ attention_historic: 1 }).querySelector("#attention").textContent).toContain("1 older failure in the last 7 days have not recurred");
      expect(render({ attention_historic: 2 }).querySelector("#attention").textContent).toContain("2 older failures in");
      expect(render({}).querySelector("#attention").textContent).not.toContain("older failure");
    });
    test("rendering publishes the attention list to the shared store", () => {
      const list = [item()];
      render({ attention: list });
      expect(stored.attention).toBe(list);
      render({});
      expect(stored.attention).toEqual([]);
    });
  });

  describe("side column", () => {
    test("no trend series says so; a series draws a chart", () => {
      expect(render({}).textContent).toContain("No trend data yet.");
      expect(render({ trend: { labels: [], series: [] } }).textContent).toContain("No trend data yet.");
      const r = render({ trend: { labels: ["a", "b"], series: [{ name: "runs", values: [1, 2] }] } });
      expect(r.textContent).not.toContain("No trend data yet.");
      expect(r.querySelector("svg")).not.toBeNull();
    });
    test("recent runs table: state badge, summary fallbacks, project folder and start time", () => {
      const r = render({ recent_runs: [
        { state: "done", task: "Fix it", project: "/w/app", started: new Date(Date.now() - 7200_000).toISOString() },
        { state: "running", kind: "claude", model: "opus" },
        { state: "unfinished" },
        { state: "other", ts: new Date(Date.now() - 60_000).toISOString() },
        { },
      ] });
      const rows = r.querySelectorAll("tbody tr");
      expect(rows).toHaveLength(5);
      const cells = (row) => [...row.querySelectorAll("td")].map((c) => c.textContent);
      expect(cells(rows[0]).slice(0, 3)).toEqual(["done", "Fix it", "app"]);
      expect(cells(rows[0])[3]).toMatch(/2h|2 hours|ago/);
      expect(cells(rows[1]).slice(0, 2)).toEqual(["running", "claude · opus"]);
      expect(cells(rows[2])[0]).toBe("never closed");
      expect(cells(rows[2])[1]).toBe("(no summary)");
      expect(cells(rows[3])[0]).toBe("other");
      expect(cells(rows[4])[0]).toBe("done");
      expect([...r.querySelectorAll("tbody tr .badge, tbody tr [data-status]")].map((b) => b.getAttribute("data-status"))).toEqual(["ok", "info", "warn", "warn", "warn"]);
      expect(r.querySelector("caption").textContent).toBe("Recent runs");
    });
    test("an empty window shows the table's empty text", () => {
      expect(render({ kpis: [{ id: "a", label: "A", value: 1 }] }).textContent).toContain("No runs in this window.");
    });
  });

  describe("empty page", () => {
    test("with no kpis, attention or runs the getting-started state shows", () => {
      const r = render({});
      expect(r.textContent).toContain("No Atlas activity recorded yet");
      expect(r.textContent).toContain("atlas doctor");
    });
    test("any one of the three removes it", () => {
      for (const d of [{ kpis: [{ id: "a", label: "A", value: 1 }] }, { attention: [{ title: "x" }] }, { recent_runs: [{ state: "done" }] }]) {
        expect(render(d).textContent).not.toContain("No Atlas activity recorded yet");
      }
    });
    test("a missing data argument renders the empty page", () => {
      expect(render(undefined).textContent).toContain("No Atlas activity recorded yet");
    });
  });

  test("the integrations row is part of the page", () => {
    expect(render({}).querySelector(".int-row")).not.toBeNull();
  });

  describe("live updates", () => {
    const mountLive = async (data) => { const root = render(data); dom.body.setAttribute?.("id", "x"); return root; };
    const host = () => { const h = document.createElement("div"); h.id = "page-root"; dom.body.appendChild(h); return h; };
    const flush = async (what) => { await until(() => timers.some((t) => t[0]), what || "debounce armed"); const t = timers.find((x) => x[0]); t[0](); t[0] = null; };
    test("only health, herd, todos and poll-mode ticks cause a refresh", () => {
      for (const e of ["irc", "tick", "other"]) page.onEvent(e, ctx);
      expect(timers).toHaveLength(0);
      page.onEvent("health", ctx);
      expect(timers.filter((t) => t[0])).toHaveLength(1);
      expect(timers[0][1]).toBe(2500);
      page.onEvent("herd", ctx);
      page.onEvent("todos", ctx);
      ctx.api.mode = "poll";
      page.onEvent("tick", ctx);
    });
    test("a poll-mode tick refreshes", () => {
      ctx.api.mode = "poll";
      page.onEvent("tick", ctx);
      expect(timers.filter((t) => t[0])).toHaveLength(1);
    });
    test("events are debounced: repeated events fire the fetch once", async () => {
      render({});
      host();
      page.onEvent("health", ctx);
      page.onEvent("health", ctx);
      const live = timers.filter((t) => t[0]);
      expect(live).toHaveLength(1);
    });
    test("changed data repaints the page in place and updates the shared attention list", async () => {
      const root = render({});
      host();
      answers.overview = { attention: [{ title: "Fresh", severity: "warn" }] };
      page.onEvent("health", ctx);
      await flush();
      await until(() => root.querySelector(".attn-item"), "repainted");
      expect(root.querySelector(".attn-item .title").textContent).toBe("Warning: Fresh");
      expect(stored.attention).toEqual([{ title: "Fresh", severity: "warn" }]);
      expect(dom.doc.getElementById("overview-root")).toBe(root);
    });
    test("identical data repaints nothing (the shown data is the same as the last render)", async () => {
      const data = { ...(await page.load(ctx)) };
      const root = render(data);
      host();
      let renders = 0;
      const orig = page.render;
      page.render = (...a) => { renders += 1; return orig.apply(page, a); };
      page.onEvent("health", ctx);
      await flush();
      await new Promise((r) => realTimers.setTimeout(r, 20));
      page.render = orig;
      expect(renders).toBe(0);
    });
    test("with no page-root host nothing is painted but the shared list still updates", async () => {
      const root = render({});
      answers.overview = { attention: [{ title: "Fresh", severity: "warn" }] };
      page.onEvent("health", ctx);
      await flush();
      await until(() => stored.attention && stored.attention.length === 1);
      expect(root.querySelector(".attn-item")).toBeNull();
    });
    test("a failed refresh toasts the error and keeps the page", async () => {
      const root = render({});
      host();
      answers.overview = Object.assign(new Error("net"), { error: "network down" });
      page.onEvent("health", ctx);
      await flush();
      await until(() => dom.body.textContent.includes("network down") || dom.body.querySelector(".toast"), "error toast");
      expect(dom.doc.getElementById("overview-root")).toBe(root);
    });
    test("destroy cancels a pending refresh and the next event arms a fresh one", () => {
      page.onEvent("health", ctx);
      page.destroy();
      expect(timers.filter((t) => t[0])).toHaveLength(0);
      page.onEvent("health", ctx);
      expect(timers.filter((t) => t[0])).toHaveLength(1);
    });
    test("reload with no mounted page does not throw and does not paint", async () => {
      answers.overview = { attention: [{ title: "x", severity: "fail" }] };
      await page.reload(ctx);
      expect(dom.doc.getElementById("overview-root")).toBeNull();
    });
    test("reload failure toasts", async () => {
      answers.overview = Object.assign(new Error("x"), { error: "reload broke" });
      await page.reload(ctx);
      await until(() => dom.body.textContent.includes("reload broke") || dom.body.querySelector(".toast"), "toast");
    });
  });
});
