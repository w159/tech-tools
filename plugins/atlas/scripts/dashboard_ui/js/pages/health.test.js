import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "../rich-dom.js";

let dom, page, calls, nav, answers, ctx, seq = 0, savedNow;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const realNow = Date.now;
const NOW = Date.parse("2026-06-10T12:00:00Z");
const until = async (cond, what = "condition") => { const end = realNow() + 2000; while (!cond()) { if (realNow() > end) throw new Error("timed out: " + what); await new Promise((r) => realTimers.setTimeout(r, 1)); } };
const ago = (s) => new Date(NOW - s * 1000).toISOString();

beforeEach(async () => {
  dom = installRichDom();
  page = (await import("./health.js?n=" + ++seq)).default;
  calls = []; nav = [];
  answers = { health: { subsystems: [], silent_failures: [], checked_at: ago(30) }, post: {} };
  savedNow = Date.now;
  Date.now = () => NOW;
  ctx = {
    project: "all", params: {},
    api: {
      mode: "live",
      get: async (path, q) => { calls.push([path, q]); if (answers.health instanceof Error) throw answers.health; return answers.health; },
      post: async (path, body) => { calls.push(["POST " + path, body]); if (answers.post instanceof Error) throw answers.post; return answers.post; },
    },
    navigate: (t) => nav.push(t),
  };
});
afterEach(() => { page.destroy(); Date.now = savedNow; restoreRichDom(); });

const mount = async (health, over = {}) => {
  if (health !== undefined) answers.health = { subsystems: [], silent_failures: [], checked_at: ago(30), ...health };
  Object.assign(ctx, over);
  const data = await page.load(ctx);
  const el = page.render(ctx, data);
  dom.body.appendChild(el);
  return el;
};
const cardTitles = (el) => [...el.querySelectorAll(".card-head h2")].map((h) => h.textContent);
const card = (el, start) => [...el.querySelectorAll("section.card")].find((c) => c.querySelector(".card-head h2").textContent.startsWith(start));
const btn = (el, text) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);
const sub = (over = {}) => ({ id: "ingest", label: "Ingest", status: "ok", detail: "all good", ...over });
const fail = (over = {}) => ({ id: "f1", kind: "hook_crash", title: "Hook crashed", state: "active", count: 2, project: "/w/app", last: ago(120), ...over });

describe("health page", () => {
  test("identity", () => { expect([page.id, page.title, page.icon, page.group]).toEqual(["health", "Health", "heart", "Observe"]); });

  describe("load", () => {
    test("asks for the default 7d window; all-projects sends no project", async () => {
      await mount();
      expect(calls).toEqual([["/api/v2/health", { window: "7d" }]]);
    });
    test("a project and a valid window param are sent; an invalid window falls back to 7d", async () => {
      await mount(undefined, { project: "/w/app", params: { window: "24h" } });
      expect(calls[0][1]).toEqual({ window: "24h", project: "/w/app" });
      page.destroy(); calls.length = 0;
      await mount(undefined, { project: "/w/app", params: { window: "bogus" } });
      expect(calls[0][1]).toEqual({ window: "7d", project: "/w/app" });
    });
    test("a failed read shows the error with Retry; Retry recovers", async () => {
      answers.health = Object.assign(new Error("x"), { error: "Daemon down", why: "no socket", do: "start it" });
      const data = await page.load(ctx);
      expect(data == null).toBe(true);
      const el = page.render(ctx, data);
      dom.body.appendChild(el);
      expect(el.textContent).toContain("Daemon down");
      expect(el.textContent).toContain("no socket — start it");
      answers.health = { subsystems: [sub()], checked_at: ago(1) };
      fire(btn(el, "Retry"), "click");
      await until(() => el.querySelector("#sub-ingest"), "recovered");
    });
    test("error wording: 404, bare failure, endpoint silent", async () => {
      answers.health = Object.assign(new Error("x"), { status: 404 });
      let el = page.render(ctx, await page.load(ctx));
      expect(el.textContent).toContain("Health API is not available yet");
      expect(el.textContent).toContain("The health endpoint did not answer.");
      answers.health = Object.assign(new Error("x"), {});
      el = page.render(ctx, await page.load(ctx));
      expect(el.textContent).toContain("Request failed");
    });
    test("render before any load shows the checking line", () => {
      expect(page.render(ctx).textContent).toContain("Checking subsystems…");
    });
  });

  describe("summary and banner", () => {
    test("counts failing and warning subsystems and names the window and check time", async () => {
      const el = await mount({ subsystems: [sub({ status: "fail" }), sub({ id: "b", status: "warn" }), sub({ id: "c", status: "warn" }), sub({ id: "d" })] });
      const p = el.querySelector("p[role=status].pg-sub");
      expect(p.textContent).toContain("4 subsystems: 1 failing, 2 warning. Measured over the last 7 days; checked 30s ago (" + ago(30) + ").");
    });
    test("the window label follows the active window", async () => {
      const el = await mount(undefined, { params: { window: "30d" } });
      expect(el.querySelector("p[role=status].pg-sub").textContent).toContain("last 30 days");
    });
    test("data warnings raise one alert listing each source; singular wording for one", async () => {
      let el = await mount({ data_warnings: [{ source: "todos", message: "locked" }] });
      expect(el.querySelector("[role=alert] strong").textContent).toBe("1 data source failed while building this page");
      expect(el.querySelector("[role=alert] li").textContent).toBe("todos: locked");
      page.destroy();
      el = await mount({ data_warnings: [{ source: "a", message: "x" }, { source: "b", message: "y" }] });
      expect(el.querySelector("[role=alert] strong").textContent).toBe("2 data sources failed while building this page");
      page.destroy();
      el = await mount({ data_warnings: [] });
      expect(el.querySelector("[role=alert]")).toBeNull();
    });
  });

  describe("subsystem cards", () => {
    test("no subsystems shows the empty state", async () => {
      expect((await mount()).textContent).toContain("No subsystem data");
    });
    test("an OK card shows label, status badge, what, detail and the About drawer", async () => {
      const el = await mount({ subsystems: [sub({ what: "reads sessions", warn_means: "slow", next: "restart" })] });
      const c = el.querySelector("#sub-ingest");
      expect(c.className).toBe("pg-subsys is-ok");
      expect(c.getAttribute("aria-label")).toBe("Ingest: ok");
      expect(c.querySelector("h3").textContent).toBe("Ingest");
      expect(c.querySelector(".pg-hint").textContent).toBe("reads sessions");
      expect(c.querySelector(".pg-subsys-detail").textContent).toBe("all good");
      const about = c.querySelector("details[data-keep=about-ingest]");
      expect(about.querySelector("summary").textContent).toBe("About this check");
      expect(about.textContent).toContain("If this warns");
      expect(about.textContent).toContain("Do this: restart");
    });
    test("a warn or fail card puts the explanation on the card and has no About drawer", async () => {
      const el = await mount({ subsystems: [sub({ status: "warn", warn_means: "lagging", next: "wait" }), sub({ id: "b", status: "fail", warn_means: "dead" })] });
      const a = el.querySelector("#sub-ingest");
      expect(a.className).toBe("pg-subsys is-warn");
      expect(a.querySelector(".pg-hintbox strong").textContent).toBe("Why warn");
      expect(a.querySelector("details.pg-evidence")).toBeNull();
      const b = el.querySelector("#sub-b");
      expect(b.querySelector(".pg-hintbox strong").textContent).toBe("Why fail");
      expect(b.textContent).not.toContain("Do this");
    });
    test("an OK card with no explanation shows an empty About drawer, and missing text is defaulted", async () => {
      const el = await mount({ subsystems: [{ id: "x" }] });
      const c = el.querySelector("#sub-x");
      expect(c.getAttribute("aria-label")).toBe("x: unknown");
      expect(c.className).toBe("pg-subsys is-info");
      expect(c.querySelector("h3").textContent).toBe("x");
      expect(c.querySelector(".pg-subsys-detail").textContent).toBe("No detail reported.");
    });
    test("unknown status is shown as info but keeps its word", async () => {
      const el = await mount({ subsystems: [sub({ status: "unknown" }), sub({ id: "q", status: "odd" })] });
      expect(el.querySelector("#sub-ingest").className).toBe("pg-subsys is-info");
      expect(el.querySelector("#sub-ingest .badge").textContent).toBe("unknown");
      expect(el.querySelector("#sub-q").className).toBe("pg-subsys is-info");
    });
    test("last OK and last failure show relative times or the honest reason", async () => {
      const el = await mount({ subsystems: [
        sub({ id: "t", last_ok: ago(7200), last_fail: ago(90000), history: [{ ok: 1 }] }),
        sub({ id: "n", history: [{ ok: 1 }] }),
        sub({ id: "h", history: [] }),
        sub({ id: "u", history_reason: "no clock" }),
        sub({ id: "m", measured: false, reason: "no source", ok_label: "Last seen", fail_label: "Last miss" }),
      ] });
      const kv = (id) => [...el.querySelectorAll(`#sub-${id} .pg-kv`)].map((k) => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]);
      expect(kv("t")).toEqual([["Last OK", "2h ago"], ["Last failure", "1d ago"]]);
      expect(el.querySelector("#sub-t time").getAttribute("datetime")).toBe(ago(7200));
      expect(kv("n")).toEqual([["Last OK", "No success recorded in this window"], ["Last failure", "None recorded in this window"]]);
      expect(kv("u")[1][1]).toBe("Not tracked: no clock");
      expect(kv("m")).toEqual([["Last seen", "Not measured"], ["Last miss", "Not measured"]]);
      expect(el.querySelector("#sub-m details[data-keep=why-m] p").textContent).toBe("no source");
      expect(el.querySelector("#sub-t details[data-keep=why-t]")).toBeNull();
    });
    test("not measured with no reason says no data source yet; with both times it hides the drawer", async () => {
      const el = await mount({ subsystems: [sub({ id: "m", measured: false }), sub({ id: "b", measured: false, reason: "r", last_ok: ago(5), last_fail: ago(6) })] });
      expect(el.querySelector("#sub-m details[data-keep=why-m] p").textContent).toBe("no data source yet");
      expect(el.querySelector("#sub-b details[data-keep=why-b]")).toBeNull();
    });
    test("history draws a sparkline with its source; empty buckets say no activity; no history says why", async () => {
      const el = await mount({ subsystems: [
        sub({ id: "s", history: [{ ok: 1, fail: 1 }, { ok: 2 }], history_source: "hook log" }),
        sub({ id: "e", history: [{ ok: 0, fail: 0 }] }),
        sub({ id: "x", history_reason: "no ts" }),
        sub({ id: "y" }),
      ] });
      expect(el.querySelector("#sub-s .pg-spark").getAttribute("title")).toBe("hook log");
      expect(el.querySelector("#sub-s .pg-spark .pg-hint").textContent).toBe("hook log");
      expect(el.querySelector("#sub-s .pg-spark svg")).not.toBeNull();
      expect(el.querySelector("#sub-e").textContent).toContain("No activity in this window");
      expect(el.querySelector("#sub-x").textContent).toContain("No history: no ts");
      expect(el.querySelector("#sub-y").textContent).toContain("No history: no timestamped source");
    });
    test("a spark with no source name falls back to the generic caption", async () => {
      const el = await mount({ subsystems: [sub({ history: [{ ok: 1 }] })] });
      expect(el.querySelector("#sub-ingest .pg-spark .pg-hint").textContent).toBe("activity per bucket");
    });
    test("evidence is a counted drawer; hook-fault lines get an active or historic badge", async () => {
      const el = await mount({ subsystems: [sub({ evidence: ["plain", "boom; last seen 2h ago; active", "boom; last seen 3d ago; none since"] }), sub({ id: "b", evidence: [] })] });
      const d = el.querySelector("#sub-ingest details[data-keep=ev-ingest]");
      expect(d.querySelector("summary").textContent).toBe("Evidence (3)");
      const lis = [...d.querySelectorAll("li")];
      expect(lis[0].textContent).toBe("plain");
      expect(lis[1].textContent).toBe("boom; last seen 2h ago; activeactive");
      expect(lis[1].querySelector("[data-status]").getAttribute("data-status")).toBe("warn");
      expect(lis[2].textContent.endsWith("historic")).toBe(true);
      expect(lis[2].querySelector("[data-status]").getAttribute("data-status")).toBe("info");
      expect(el.querySelector("#sub-b details[data-keep=ev-b]")).toBeNull();
    });
  });

  describe("silent failures", () => {
    test("none shows the reassuring empty state", async () => {
      const el = await mount();
      expect(card(el, "Silent failures (0 distinct, 0 occurrences)").textContent).toContain("No silent failures");
    });
    test("splits happening-now from historic, sorted by count, with totals in the title", async () => {
      const el = await mount({ silent_failures: [fail({ id: "a", count: 1 }), fail({ id: "b", count: 5 }), fail({ id: "c", state: "gone", count: 3, kind: "x", title: "Old" })] });
      const c = card(el, "Silent failures");
      expect(c.querySelector(".card-head h2").textContent).toBe("Silent failures (3 distinct, 9 occurrences)");
      const heads = [...c.querySelectorAll("h3.pg-sub")].map((h) => h.textContent);
      expect(heads).toEqual(["Happening now (2)", "Historic, aging out (1)"]);
      const grids = c.querySelectorAll(".pg-subsys-grid");
      expect([...grids[0].querySelectorAll("article")].map((a) => a.id)).toEqual(["b", "a"]);
      expect([...grids[1].querySelectorAll("article")].map((a) => a.id)).toEqual(["c"]);
    });
    test("with only historic ones the now-section says nothing is failing", async () => {
      const el = await mount({ silent_failures: [fail({ state: "gone" })] });
      expect(card(el, "Silent failures").textContent).toContain("Nothing is failing quietly right now");
    });
    test("a failure card has the tone, state text, sample clip, advice, facts", async () => {
      const long = "x".repeat(300);
      const el = await mount({ silent_failures: [fail({ what: "hook died", sample: long, next: "python3 fix.py", ages_out: "2026-06-20T00:00:00Z" })] });
      const a = el.querySelector("article#f1");
      expect(a.className).toBe("pg-subsys is-warn");
      expect(a.getAttribute("aria-label")).toBe("Hook crashed: happening now");
      expect(a.querySelector(".pg-hint").textContent).toBe("hook died");
      expect(a.querySelector("pre").textContent).toBe("x".repeat(220) + "…");
      expect(a.querySelector(".pg-hintbox").textContent).toBe("Do thispython3 fix.py");
      const facts = Object.fromEntries([...a.querySelectorAll(".pg-kv")].map((k) => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]));
      expect(facts).toEqual({ Times: "×2", Project: "app", "Last seen": "2m ago", "Stops counting": "2026-06-20 unless it recurs" });
    });
    test("short samples are not clipped, absent ones omitted; hint fallback and default advice", async () => {
      const el = await mount({ silent_failures: [fail({ id: "a", sample: "short", hint: "try this" }), fail({ id: "b" })] });
      expect(el.querySelector("#a pre").textContent).toBe("short");
      expect(el.querySelector("#a .pg-hintbox p").textContent).toBe("try this");
      expect(el.querySelector("#b pre")).toBeNull();
      expect(el.querySelector("#b .pg-hintbox p").textContent).toBe("No action recorded for this failure kind.");
    });
    test("a sample of exactly 220 characters is kept whole", async () => {
      const el = await mount({ silent_failures: [fail({ sample: "y".repeat(220) })] });
      expect(el.querySelector("pre").textContent).toBe("y".repeat(220));
    });
    test("historic and non-atlas kinds are marked accordingly", async () => {
      const el = await mount({ silent_failures: [fail({ id: "h", state: "gone", ages_out: "2026-06-12T00:00:00Z" }), fail({ id: "n", kind: "tool_misuse" }), fail({ id: "e", state: "gone", count: 0, last: null, project: null })] });
      expect(el.querySelector("#h").getAttribute("aria-label")).toBe("Hook crashed: historic");
      expect(el.querySelector("#h").className).toBe("pg-subsys is-info");
      expect(el.querySelector("#n").getAttribute("aria-label")).toBe("Hook crashed: not an atlas fault");
      const facts = (id) => Object.fromEntries([...el.querySelectorAll(`#${id} .pg-kv`)].map((k) => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]));
      expect(facts("h")["Stops counting"]).toBe("2026-06-12, no action needed");
      expect(facts("e")).toEqual({ Times: "×1", Project: "—", "Last seen": "—", Clears: "when fixed" });
    });
    test("a card without a title shows its kind", async () => {
      const el = await mount({ silent_failures: [fail({ title: undefined })] });
      expect(el.querySelector("#f1 h3").textContent).toBe("hook_crash");
    });
    test("the action button reflects the failure: open in Improve navigates, session copies", async () => {
      const el = await mount({ silent_failures: [fail({ id: "a", finding_id: "F9" })] });
      fire(btn(el, "Open in Improve"), "click");
      expect(nav).toEqual(["improve?finding=F9"]);
    });
    test("dismissing posts the id, refetches and redraws without that failure", async () => {
      const el = await mount({ silent_failures: [fail({ id: "a" })] });
      answers.health = { subsystems: [], silent_failures: [fail({ id: "a", dismissed: true })], checked_at: ago(30) };
      fire(btn(el, "Dismiss"), "click");
      await until(() => el.querySelector("details[data-keep=dismissed-failures]"), "dismissed drawer");
      expect(calls.find((c) => c[0] === "POST /api/v2/dismiss")[1]).toEqual({ id: "a" });
      expect(calls.filter((c) => c[0] === "/api/v2/health")).toHaveLength(2);
      const d = el.querySelector("details[data-keep=dismissed-failures]");
      expect(d.querySelector("summary").textContent).toBe("Dismissed (1): hidden until they happen again");
      expect(d.querySelector("li").textContent).toContain("Hook crashed");
      expect(el.querySelector("article#a")).toBeNull();
      expect(card(el, "Silent failures").textContent).toContain("No silent failures");
    });
    test("Restore on a dismissed one posts the undo", async () => {
      const el = await mount({ silent_failures: [fail({ id: "a", dismissed: true })] });
      fire(btn(el, "Restore"), "click");
      await until(() => calls.some((c) => c[0] === "POST /api/v2/dismiss"));
      expect(calls.find((c) => c[0] === "POST /api/v2/dismiss")[1]).toEqual({ id: "a", undo: true });
    });
  });

  describe("tool errors and enforcement", () => {
    test("tool errors: empty state, counts line, table of causes and legacy hint", async () => {
      let el = await mount({ tool_errors: { total: 0 } });
      expect(card(el, "Tool errors by cause (0)").textContent).toContain("No model-misuse or environment tool errors in this window.");
      page.destroy();
      el = await mount({ tool_errors: { total: 5, counts: { model_misuse: 3, environment: 2 }, legacy: 4, top_causes: [{ class: "env", tool: "Bash", snippet: "exit 1", count: 2, last: ago(60) }, {}] } });
      const c = card(el, "Tool errors by cause (5)");
      expect(c.textContent).toContain("3 model misuse (edit without read, bad arguments), 2 environment (nonzero exit, missing path, timeout, MCP) in this window.");
      const rows = [...c.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((x) => x.textContent));
      expect(rows).toEqual([["env", "Bash", "exit 1", "×2", "1m ago"], ["—", "—", "—", "×0", "never"]]);
      expect(c.textContent).toContain("4 legacy tool errors — pre-capture history, no error text; not attributable");
    });
    test("legacy count shows even when there is nothing else, with a custom hint", async () => {
      const el = await mount({ tool_errors: { total: 0, legacy: 2, legacy_hint: "old" } });
      expect(card(el, "Tool errors").textContent).toContain("2 legacy tool errors — old");
      const none = await mount({ tool_errors: { total: 1, counts: {}, legacy: 0, top_causes: [] } });
      expect(card(none, "Tool errors").textContent).not.toContain("legacy");
    });
    test("a missing tool_errors block is an empty card", async () => {
      expect(cardTitles(await mount())).toContain("Tool errors by cause (0)");
    });
    test("enforcement: empty, then rules table with counts and project breakdown", async () => {
      let el = await mount({ enforcement: { total: 0 } });
      expect(card(el, "Enforcement (0)").textContent).toContain("No denies or gate blocks in this window.");
      page.destroy();
      el = await mount({ enforcement: { total: 3, counts: { gate_deny: 2, gate_block: 1 }, top_rules: [{ rule: "no-rm", kind: "deny", count: 2, last: ago(30) }, {}], projects: [{ name: "alpha", count: 2 }, { project: "/w/beta", count: 1 }] } });
      const c = card(el, "Enforcement (3)");
      expect(c.textContent).toContain("2 denied calls, 1 gate blocks in this window.");
      const rows = [...c.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((x) => x.textContent));
      expect(rows).toEqual([["no-rm", "deny", "×2", "30s ago"], ["—", "enforced", "×0", "never"]]);
      expect(c.textContent).toContain("By project: alpha ×2, beta ×1");
    });
    test("enforcement without projects omits the breakdown", async () => {
      const el = await mount({ enforcement: { total: 1, top_rules: [], projects: [] } });
      expect(card(el, "Enforcement").textContent).not.toContain("By project");
    });
  });

  describe("working", () => {
    test("lists successful operations or says there are none", async () => {
      expect(card(await mount(), "Working (0)").textContent).toContain("No successful operations recorded in this window.");
      page.destroy();
      const el = await mount({ successes: [{ kind: "ingest", count: 4, last: ago(300) }, {}] });
      const rows = [...card(el, "Working (2)").querySelectorAll(".pg-success")].map((r) => r.textContent);
      expect(rows).toEqual(["ingest×45m ago", "—×0never"]);
    });
  });

  describe("window tabs and refresh", () => {
    test("shows the three windows with the active one selected", async () => {
      const el = await mount();
      const tabs = [...el.querySelectorAll("[role=tab]")];
      expect(tabs.map((t) => t.textContent)).toEqual(["Last 24h", "Last 7 days", "Last 30 days"]);
      expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    });
    test("choosing a window refetches with it and redraws", async () => {
      const el = await mount();
      fire([...el.querySelectorAll("[role=tab]")][2], "click");
      await until(() => calls.length === 2, "second read");
      expect(calls[1][1]).toEqual({ window: "30d" });
      await until(() => el.querySelector("p[role=status].pg-sub").textContent.includes("last 30 days"));
    });
    test("Refresh forces a redraw even when nothing changed", async () => {
      const el = await mount({ subsystems: [sub()] });
      const before = el.querySelector("#sub-ingest");
      fire(btn(el, "Refresh"), "click");
      await until(() => calls.length === 2);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      expect(el.querySelector("#sub-ingest")).toBe(before);
    });
    test("a refresh with changed data repaints", async () => {
      const el = await mount({ subsystems: [sub()] });
      answers.health = { subsystems: [sub(), sub({ id: "b", label: "Bee" })], silent_failures: [], checked_at: ago(1) };
      fire(btn(el, "Refresh"), "click");
      await until(() => el.querySelector("#sub-b"), "new card");
    });
    test("a failed refresh keeps the old data on screen", async () => {
      const el = await mount({ subsystems: [sub()] });
      answers.health = new Error("down");
      fire(btn(el, "Refresh"), "click");
      await until(() => calls.length === 2);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      expect(el.querySelector("#sub-ingest")).not.toBeNull();
    });
    test("recovering from an error repaints even when the payload equals the earlier one", async () => {
      const el = await mount({ subsystems: [sub()] });
      const same = answers.health;
      answers.health = new Error("down");
      fire(btn(el, "Refresh"), "click");
      await until(() => calls.length === 2);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      answers.health = same;
      el.querySelector("#sub-ingest").setAttribute("data-marker", "old");
      fire(btn(el, "Refresh"), "click");
      await until(() => calls.length === 3);
      await until(() => el.querySelector("#sub-ingest") && el.querySelector("#sub-ingest").getAttribute("data-marker") === null, "repainted");
    });
    test("overlapping refreshes read once", async () => {
      const el = await mount();
      let release;
      ctx.api.get = (p, q) => { calls.push([p, q]); return new Promise((r) => { release = r; }); };
      fire(btn(el, "Refresh"), "click");
      fire(btn(el, "Refresh"), "click");
      expect(calls).toHaveLength(2);
      release({ subsystems: [] });
    });
  });

  describe("live events", () => {
    test("a health event refreshes; a poll-mode tick refreshes; a live tick and other events do not", async () => {
      await mount();
      page.onEvent("herd", ctx);
      page.onEvent("tick", ctx);
      page.onEvent("", ctx);
      expect(calls).toHaveLength(1);
      page.onEvent("health", ctx);
      await until(() => calls.length === 2);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      ctx.api.mode = "poll";
      page.onEvent("tick", ctx);
      await until(() => calls.length === 3);
    });
    test("a tick without a context is ignored", async () => {
      await mount();
      page.onEvent("tick");
      expect(calls).toHaveLength(1);
    });
    test("events before the page exists are ignored", () => {
      page.onEvent("health", ctx);
      expect(calls).toHaveLength(0);
    });
    test("an event that brings identical data leaves the DOM untouched", async () => {
      const el = await mount({ subsystems: [sub()] });
      page.onEvent("health", ctx); // the first poll establishes the change key
      await until(() => calls.length === 2);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      const node = el.querySelector("#sub-ingest");
      node.setAttribute("data-marker", "kept");
      page.onEvent("health", ctx);
      await until(() => calls.length === 3);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      expect(el.querySelector("#sub-ingest").getAttribute("data-marker")).toBe("kept");
    });
    test("volatile clock fields do not count as a change", async () => {
      const el = await mount({ subsystems: [sub()] });
      page.onEvent("health", ctx);
      await until(() => calls.length === 2);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      el.querySelector("#sub-ingest").setAttribute("data-marker", "kept");
      answers.health = { ...answers.health, checked_at: ago(2) };
      page.onEvent("health", ctx);
      await until(() => calls.length === 3);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      expect(el.querySelector("#sub-ingest").getAttribute("data-marker")).toBe("kept");
    });
  });

  describe("more branches", () => {
    test("an event with changed data repaints without being forced", async () => {
      const el = await mount({ subsystems: [sub()] });
      page.onEvent("health", ctx);
      await until(() => calls.length === 2);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      answers.health = { subsystems: [sub(), sub({ id: "late", label: "Late" })], silent_failures: [], checked_at: ago(1) };
      page.onEvent("health", ctx);
      await until(() => el.querySelector("#sub-late"), "repainted by event");
    });
    test("an unparseable timestamp is shown as written", async () => {
      const el = await mount({ subsystems: [sub({ last_ok: "yesterday-ish" })] });
      expect(el.querySelector("#sub-ingest time").textContent).toBe("yesterday-ish");
    });
    test("failures without a count sort after those with one", async () => {
      const el = await mount({ silent_failures: [fail({ id: "none", count: undefined }), fail({ id: "one", count: 1 })] });
      expect([...card(el, "Silent failures").querySelectorAll("article")].map((a) => a.id)).toEqual(["one", "none"]);
      page.destroy();
      const el2 = await mount({ silent_failures: [fail({ id: "one", count: 1 }), fail({ id: "none", count: undefined }), fail({ id: "zero", count: 0 })] });
      expect([...card(el2, "Silent failures").querySelectorAll("article")].map((a) => a.id)).toEqual(["one", "none", "zero"]);
      page.destroy();
      const el3 = await mount({ silent_failures: [fail({ id: "none", count: undefined }), fail({ id: "zero", count: 0 }), fail({ id: "one", count: 1 })] });
      expect([...card(el3, "Silent failures").querySelectorAll("article")].map((a) => a.id)).toEqual(["one", "none", "zero"]);
    });
    test("an event arriving before the page was rendered does not raise", async () => {
      const errors = [];
      const onErr = (e) => errors.push(e);
      process.on("unhandledRejection", onErr);
      try {
        await page.load(ctx);
        page.onEvent("health", ctx);
        await until(() => calls.length === 2);
        await new Promise((r) => realTimers.setTimeout(r, 20));
        expect(errors).toEqual([]);
      } finally { process.off("unhandledRejection", onErr); }
    });
  });

  describe("destroy", () => {
    test("is safe twice and stops events", async () => {
      await mount();
      page.destroy();
      expect(() => page.destroy()).not.toThrow();
      page.onEvent("health", ctx);
      expect(calls).toHaveLength(1);
    });
    test("a read that finishes after destroy neither raises nor paints", async () => {
      const errors = [];
      const onErr = (e) => errors.push(e);
      process.on("unhandledRejection", onErr);
      try {
        const el = await mount({ subsystems: [sub()] });
        let release;
        ctx.api.get = () => new Promise((r) => { release = r; });
        fire(btn(el, "Refresh"), "click");
        page.destroy();
        release({ subsystems: [] });
        await new Promise((r) => realTimers.setTimeout(r, 20));
        expect(errors).toEqual([]);
        expect(el.querySelector("#sub-ingest")).not.toBeNull();
      } finally { process.off("unhandledRejection", onErr); }
    });
    test("loading again discards the previous page state", async () => {
      await mount({ subsystems: [sub()] });
      const el = await mount({ subsystems: [sub({ id: "z" })] });
      expect(el.querySelector("#sub-z")).not.toBeNull();
    });
  });

  describe("keeps open drawers across a repaint", () => {
    test("an evidence drawer the user opened stays open after new data arrives", async () => {
      const el = await mount({ subsystems: [sub({ evidence: ["e1"] })] });
      el.querySelector("details[data-keep=ev-ingest]").open = true;
      answers.health = { subsystems: [sub({ evidence: ["e1", "e2"] })], silent_failures: [], checked_at: ago(1) };
      fire(btn(el, "Refresh"), "click");
      await until(() => el.querySelector("details[data-keep=ev-ingest] summary").textContent === "Evidence (2)", "repainted");
      expect(el.querySelector("details[data-keep=ev-ingest]").open).toBe(true);
      expect(el.querySelector("details[data-keep=about-ingest]").open).toBe(false);
    });
  });
});
