import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "../rich-dom.js";
import { closeDrawer, hasOpenDrawer } from "../ui-overlays.js";

let dom, page, calls, answers, ctx, toasts, timeouts, seq = 0, savedNow, wrap;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const realNow = Date.now;
const NOW = Date.parse("2026-06-10T12:00:00Z");
const until = async (cond, what = "condition") => { const end = realNow() + 2000; while (!cond()) { if (realNow() > end) throw new Error("timed out: " + what); await new Promise((r) => realTimers.setTimeout(r, 1)); } };
const settle = () => new Promise((r) => realTimers.setTimeout(r, 10));
const ago = (s) => new Date(NOW - s * 1000).toISOString();

beforeEach(async () => {
  dom = installRichDom();
  page = (await import("./improve.js?n=" + ++seq)).default;
  calls = []; toasts = []; timeouts = [];
  answers = { improve: { findings: [] }, post: { ok: true }, put: {} };
  savedNow = Date.now;
  Date.now = () => NOW;
  // A Node-like handle: a timer of another test file (omp/proc.ts) can fire while this stub is installed and calls .unref() on what it gets.
  globalThis.setTimeout = (fn, ms) => { const t = { fn, ms, live: true }; timeouts.push(t); return { unref() { return this; }, ref() { return this; }, hasRef: () => true, t }; };
  globalThis.clearTimeout = (h) => { if (h && h.t) h.t.live = false; };
  wrap = document.createElement("div");
  dom.body.appendChild(wrap);
  const insp = document.createElement("div");
  insp.id = "inspector";
  wrap.appendChild(insp);
  ctx = {
    project: "all", params: {},
    api: {
      get: async (path, q) => { calls.push(["GET " + path, q]); if (answers.improve instanceof Error) throw answers.improve; return typeof answers.improve === "function" ? answers.improve(q) : answers.improve; },
      post: async (path, body) => { calls.push(["POST " + path, body]); if (answers.post instanceof Error) throw answers.post; return typeof answers.post === "function" ? answers.post(path, body) : answers.post; },
      put: async (path, body) => { calls.push(["PUT " + path, body]); if (answers.put instanceof Error) throw answers.put; return answers.put; },
    },
    toast: (m, o) => toasts.push([m, o]),
  };
});
afterEach(() => {
  page.destroy();
  closeDrawer();
  Date.now = savedNow;
  Object.assign(globalThis, realTimers);
  restoreRichDom();
});

const F = (id, over = {}) => ({ id, title: "Finding " + id, status: "open", severity: "warn", actionable: true, rule: "r-" + id, project: "/w/app", last: ago(300), ...over });
const mount = async (improve, over = {}) => {
  if (improve !== undefined) answers.improve = { findings: [], ...improve };
  Object.assign(ctx, over);
  const data = await page.load(ctx);
  const el = page.render(ctx, data);
  wrap.appendChild(el);
  return el;
};
const card = (el, start) => [...el.querySelectorAll("section.card")].find((c) => c.querySelector(".card-head h2").textContent.startsWith(start));
const btn = (el, text) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);
const byLabel = (el, label) => [...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
const aria = (el, label) => el.querySelector(`[aria-label="${label}"]`);
const frows = (el) => [...card(el, "Findings").querySelectorAll("tbody tr")];
const drawer = () => document.querySelector(".drawer");
const getsOf = () => calls.filter((c) => c[0] === "GET /api/v2/improve");

test("the stubbed setTimeout hands back a Node-like handle, so a foreign timer firing mid-test cannot throw on .unref()", () => {
  const handle = globalThis.setTimeout(() => {}, 5);
  expect(() => handle.unref()).not.toThrow();
  globalThis.clearTimeout(handle);
  expect(timeouts[0].live).toBe(false);
});

describe("improve page", () => {
  test("identity", () => { expect([page.id, page.title, page.icon, page.group]).toEqual(["improve", "Self-improvement", "trending-up", "Improve"]); });

  describe("load", () => {
    test("reads the improve endpoint; a project is sent, all is not", async () => {
      await mount();
      expect(calls[0]).toEqual(["GET /api/v2/improve", {}]);
      page.destroy(); calls.length = 0;
      await mount(undefined, { project: "/w/app" });
      expect(calls[0][1]).toEqual({ project: "/w/app" });
    });
    test("a failed read shows the error and Retry recovers", async () => {
      answers.improve = Object.assign(new Error("x"), { error: "Down", why: "w", do: "d" });
      const data = await page.load(ctx);
      expect(data == null).toBe(true);
      const el = page.render(ctx, data);
      wrap.appendChild(el);
      expect(el.textContent).toContain("Down");
      expect(el.textContent).toContain("w — d");
      answers.improve = { findings: [F("1")] };
      fire(btn(el, "Retry"), "click");
      await until(() => card(el, "Findings") && frows(el).length === 1, "recovered");
    });
    test("error wording: 404, bare failure, silent endpoint", async () => {
      answers.improve = Object.assign(new Error("x"), { status: 404 });
      let el = page.render(ctx, await page.load(ctx));
      expect(el.textContent).toContain("Self-improvement API is not available yet");
      expect(el.textContent).toContain("The improve endpoint did not answer.");
      answers.improve = Object.assign(new Error("x"), {});
      el = page.render(ctx, await page.load(ctx));
      expect(el.textContent).toContain("Request failed");
    });
    test("render before load shows the loading line", () => {
      expect(page.render(ctx).textContent).toContain("Loading findings…");
    });
  });

  describe("stage strip", () => {
    test("shows the five stages in order with their count, status and hint", async () => {
      const el = await mount({ loop: { stages: [{ id: "mine", label: "Mine", count: 4, status: "ok", hint: "mined 4" }, { id: "observe", label: "Observe", count: 9, status: "warn" }] } });
      const lis = [...el.querySelectorAll("ol.pg-loop li")];
      expect(lis).toHaveLength(5);
      expect(lis.map((l) => l.querySelector(".pg-stage-step").textContent)).toEqual(["1", "2", "3", "4", "5"]);
      expect(lis[0].className).toBe("pg-stage is-warn");
      expect(lis[0].querySelector(".pg-stage-label").textContent).toBe("Observe");
      expect(lis[0].querySelector(".pg-stage-count").textContent).toBe("9");
      expect(lis[1].className).toBe("pg-stage is-ok");
      expect(lis[1].getAttribute("title")).toBe("mined 4");
      expect(lis[1].querySelector(".pg-hint").textContent).toBe("mined 4");
      expect(lis[1].querySelector(".badge").textContent).toBe("ok");
    });
    test("missing stages default to their id, count zero and idle/info", async () => {
      const lis = [...(await mount()).querySelectorAll("ol.pg-loop li")];
      expect(lis.map((l) => l.querySelector(".pg-stage-label").textContent)).toEqual(["observe", "mine", "propose", "apply", "remeasure"]);
      expect(lis[0].className).toBe("pg-stage is-info");
      expect(lis[0].querySelector(".pg-stage-count").textContent).toBe("0");
      expect(lis[0].querySelector(".badge").textContent).toBe("info");
      expect(lis[0].querySelector(".pg-hint")).toBeNull();
    });
    test("a stage with no status word reads idle and a zero count stays 0", async () => {
      const lis = [...(await mount({ loop: { stages: [{ id: "observe", label: "O", count: 0 }] } })).querySelectorAll("ol.pg-loop li")];
      expect(lis[0].querySelector(".badge").textContent).toBe("idle");
      expect(lis[0].querySelector(".pg-stage-count").textContent).toBe("0");
    });
  });

  describe("findings table", () => {
    test("rows show status, title, severity, rule, project and age", async () => {
      const el = await mount({ findings: [F("a", { severity: "critical", status: "partial", fix_state: "running" })] });
      const cells = [...frows(el)[0].querySelectorAll("td")];
      expect(cells[0].textContent).toContain("partially verified");
      expect(cells[0].textContent).toContain("fix: running");
      expect(cells[1].querySelector(".pg-evt-title").textContent).toBe("Finding a");
      expect(cells[1].querySelector("[data-status]").getAttribute("data-status")).toBe("fail");
      expect(cells[2].querySelector(".pg-mono").textContent).toBe("r-a");
      expect(cells[2].querySelector(".pg-group-meta").textContent).toBe("app");
      expect(cells[3].textContent).toBe("5m ago");
    });
    test("fix state none or absent is not badged; unknown fix states are info", async () => {
      const el = await mount({ findings: [F("a", { fix_state: "none" }), F("b"), F("c", { fix_state: "weird" })] });
      const status = (i) => frows(el)[i].querySelector(".pg-statuscell").textContent;
      expect(status(0)).not.toContain("fix:");
      expect(status(1)).not.toContain("fix:");
      expect(status(2)).toContain("fix: weird");
    });
    test("severity words map to tones, unknown to info", async () => {
      const sev = ["high", "major", "medium", "low", "bogus", undefined];
      const el = await mount({ findings: sev.map((s, i) => F("s" + i, { severity: s })) });
      const tones = frows(el).map((r) => r.querySelector(".pg-finding-title .badge").getAttribute("data-status"));
      expect(tones).toEqual(["fail", "fail", "warn", "info", "info", "info"]);
      expect(frows(el)[5].querySelector(".pg-finding-title .badge").textContent).toBe("info");
    });
    test("baseline to now delta with a trend, rounded floats, now-only, or nothing", async () => {
      const el = await mount({ findings: [
        F("a", { baseline: 1.23456, current: 0.5, trend: "improved" }),
        F("b", { current: 7 }),
        F("c"),
        F("d", { baseline: 0, current: 0, trend: "regressed" }),
        F("e", { baseline: 3, current: 4, trend: "flat" }),
      ] });
      const t = (i) => frows(el)[i].querySelector(".pg-finding-title");
      expect(t(0).querySelector(".pg-delta .pg-mono").textContent).toBe("1.235 → 0.5");
      expect(t(0).querySelector(".pg-delta .badge").textContent).toBe("▲ better");
      expect(t(1).querySelector(".pg-delta").textContent).toBe("now (no baseline)7");
      expect(t(2).querySelector(".pg-delta")).toBeNull();
      expect(t(3).querySelector(".pg-delta .pg-mono").textContent).toBe("0 → 0");
      expect(t(3).querySelector(".pg-delta .badge").textContent).toBe("▼ worse");
      expect(t(4).querySelector(".pg-delta .badge").textContent).toBe("■ unchanged");
    });
    test("a delta without a trend shows no trend badge", async () => {
      const el = await mount({ findings: [F("a", { baseline: 1, current: 2 })] });
      expect(frows(el)[0].querySelector(".pg-delta .badge")).toBeNull();
    });
    test("the suggestion shows only for actionable findings", async () => {
      const el = await mount({ findings: [F("a", { proposed_action: "do x" }), F("b", { proposed_action: "hidden", actionable: false })] });
      expect(frows(el)[0].textContent).toContain("Suggested: do x");
      expect(frows(el)[1].textContent).not.toContain("Suggested");
    });
    test("a finding without a title shows its id; without a rule a dash and no project line", async () => {
      const el = await mount({ findings: [{ id: "bare", actionable: true }] });
      const cells = [...frows(el)[0].querySelectorAll("td")];
      expect(cells[1].querySelector(".pg-evt-title").textContent).toBe("bare");
      expect(cells[2].querySelector(".pg-mono").textContent).toBe("—");
      expect(cells[2].querySelector(".pg-group-meta")).toBeNull();
      expect(cells[3].textContent).toBe("—");
    });
    test("an empty list says no findings yet with the doctor command", async () => {
      const el = await mount({ findings: [] });
      expect(card(el, "Findings (0)").textContent).toContain("No findings yet");
      expect(card(el, "Findings (0)").textContent).toContain("python3 plugins/atlas/scripts/atlas_doctor.py");
    });
  });

  describe("row actions", () => {
    test("the actions depend on the status", async () => {
      const el = await mount({ findings: [F("o"), F("a", { status: "accepted" }), F("f", { status: "fixed" }), F("d", { status: "dismissed" }), F("w", { status: "wontfix" })] });
      const labels = (i) => [...frows(el)[i].querySelectorAll(".pg-actions button")].map((b) => b.textContent);
      expect(labels(0)).toEqual(["Accept", "Mark resolved (manual)", "Dismiss", "Won't fix", "Remeasure"]);
      expect(labels(1)).toEqual(["Mark resolved (manual)", "Dismiss", "Won't fix", "Remeasure"]);
      expect(labels(2)).toEqual(["Reopen", "Remeasure"]);
      expect(labels(3)).toEqual(["Reopen", "Remeasure"]);
      expect(labels(4)).toEqual(["Reopen", "Remeasure"]);
    });
    test("a finding with no status counts as open", async () => {
      const el = await mount({ findings: [F("n", { status: undefined })] });
      expect([...frows(el)[0].querySelectorAll(".pg-actions button")][0].textContent).toBe("Accept");
    });
    test("ledger rows are read-only", async () => {
      const el = await mount({ findings: [F("l", { actionable: false })] });
      expect(frows(el)[0].querySelector(".pg-actions")).toBeNull();
      expect(frows(el)[0].textContent).toContain("read-only");
    });
    test("buttons carry a descriptive label and the hint", async () => {
      const el = await mount({ findings: [F("o")] });
      const b = byLabel(el, "Accept: Finding o");
      expect(b.getAttribute("title")).toBe("Agree this finding is real and keep it in the queue to fix.");
      expect(byLabel(el, "Remeasure: Finding o")).toBeTruthy();
    });
    test("Accept posts the id and status, swaps in the returned state and toasts with the next hint", async () => {
      const el = await mount({ findings: [F("o")] });
      answers.post = { ok: true, state: { findings: [F("o", { status: "accepted" })] }, next: "Now fix it" };
      fire(byLabel(el, "Accept: Finding o"), "click");
      await until(() => toasts.length === 1, "toast");
      expect(calls.find((c) => c[0] === "POST /api/v2/improve/finding")[1]).toEqual({ id: "o", status: "accepted" });
      expect(toasts[0]).toEqual(["“Finding o” marked accepted. Now fix it", { kind: "ok" }]);
      await until(() => byLabel(el, "Dismiss: Finding o") && !byLabel(el, "Accept: Finding o"), "redrawn");
      expect(getsOf()).toHaveLength(1);
    });
    test("each action sends its own target status", async () => {
      const el = await mount({ findings: [F("o")] });
      answers.post = (path, body) => ({ ok: true, state: { findings: [F("o", { status: body.status === "accepted" ? "accepted" : "open" })] } });
      for (const [label, to] of [["Mark resolved (manual)", "fixed"], ["Dismiss", "dismissed"], ["Won't fix", "wontfix"]]) {
        calls.length = 0;
        fire(byLabel(el, `${label}: Finding o`), "click");
        await until(() => calls.some((c) => c[0] === "POST /api/v2/improve/finding"));
        expect(calls[0][1]).toEqual({ id: "o", status: to });
        await settle();
      }
    });
    test("without a returned state the page re-reads", async () => {
      const el = await mount({ findings: [F("o")] });
      answers.post = { ok: true };
      answers.improve = { findings: [F("o", { status: "accepted" })] };
      fire(byLabel(el, "Accept: Finding o"), "click");
      await until(() => getsOf().length === 2, "re-read");
      await until(() => byLabel(el, "Dismiss: Finding o") && !byLabel(el, "Accept: Finding o"));
      expect(toasts[0]).toEqual(["“Finding o” marked accepted", { kind: "ok" }]);
    });
    test("a refusal in the body toasts the reason as a failure and keeps the row", async () => {
      const el = await mount({ findings: [F("o")] });
      answers.post = { ok: false, error: "Not allowed", why: "ledger", do: "none" };
      fire(byLabel(el, "Accept: Finding o"), "click");
      await until(() => toasts.length === 1);
      expect(toasts[0]).toEqual(["Not allowed: ledger — none", { kind: "fail" }]);
      expect(byLabel(el, "Accept: Finding o").disabled).toBeFalsy();
    });
    test("a thrown error is reported the same way", async () => {
      const el = await mount({ findings: [F("o")] });
      answers.post = Object.assign(new Error("x"), { status: 404 });
      fire(byLabel(el, "Accept: Finding o"), "click");
      await until(() => toasts.length === 1);
      expect(toasts[0]).toEqual(["Self-improvement API is not available yet", { kind: "fail" }]);
    });
    test("while a change is in flight the buttons are disabled and a second click is ignored", async () => {
      const el = await mount({ findings: [F("o")] });
      let release;
      ctx.api.post = (path, body) => { calls.push(["POST " + path, body]); return new Promise((r) => { release = r; }); };
      fire(byLabel(el, "Accept: Finding o"), "click");
      await until(() => byLabel(el, "Accept: Finding o").disabled, "disabled");
      fire(byLabel(el, "Accept: Finding o"), "click");
      expect(calls.filter((c) => c[0].startsWith("POST"))).toHaveLength(1);
      expect(byLabel(el, "Dismiss: Finding o").disabled).toBe(true);
      expect(byLabel(el, "Remeasure: Finding o").disabled).toBeFalsy();
      release({ ok: true, state: { findings: [F("o", { status: "accepted" })] } });
      await until(() => !byLabel(el, "Accept: Finding o"));
    });
    test("Remeasure posts the id, shows Measuring… meanwhile, and toasts", async () => {
      const el = await mount({ findings: [F("o")] });
      let release;
      ctx.api.post = (path, body) => { calls.push(["POST " + path, body]); return new Promise((r) => { release = r; }); };
      fire(byLabel(el, "Remeasure: Finding o"), "click");
      await until(() => btn(el, "Measuring…"), "measuring");
      expect(btn(el, "Measuring…").disabled).toBe(true);
      expect(calls.at(-1)).toEqual(["POST /api/v2/improve/remeasure", { id: "o" }]);
      release({ ok: true, state: { findings: [F("o")] } });
      await until(() => toasts.length === 1);
      expect(toasts[0][0]).toBe("Remeasure “Finding o”");
      await until(() => btn(el, "Remeasure"));
    });
    test("clicking an action does not also open the detail drawer", async () => {
      const el = await mount({ findings: [F("o")] });
      answers.post = { ok: true, state: { findings: [F("o")] } };
      fire(byLabel(el, "Accept: Finding o"), "click");
      await until(() => toasts.length === 1);
      expect(hasOpenDrawer()).toBe(false);
    });
    test("without a toast function the action still works", async () => {
      const el = await mount({ findings: [F("o")] });
      delete ctx.toast;
      answers.post = { ok: true, state: { findings: [F("o", { status: "accepted" })] } };
      fire(byLabel(el, "Accept: Finding o"), "click");
      await until(() => !byLabel(el, "Accept: Finding o"));
    });
  });

  describe("detail drawer", () => {
    test("a row click opens the finding with badges, evidence, proposal and facts", async () => {
      const el = await mount({ findings: [F("o", { severity: "high", trend: "regressed", evidence: "line 1", detail: { a: 1 }, proposed_action: "fix it", source: "doctor", metric: "m", baseline: 1, current: 2, target: 0, verdict: "worse", verifier: "bot", first: ago(900), time_source: "file" })] });
      fire(frows(el)[0], "click");
      await until(() => drawer(), "drawer");
      const d = drawer();
      expect(d.getAttribute("aria-label")).toBe("Finding o");
      expect([...d.querySelectorAll(".pg-detail-head .badge")].map((b) => b.textContent)).toEqual(["open", "high", "▼ worse"]);
      expect(d.querySelector(".pg-detail-title").textContent).toBe("Finding o");
      expect([...d.querySelectorAll("pre")].map((p) => p.textContent)).toEqual(["line 1", '{"a":1}']);
      expect(d.textContent).toContain("Proposed: fix it");
      const facts = Object.fromEntries([...d.querySelectorAll(".pg-kv")].map((k) => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]));
      expect(facts).toEqual({ Rule: "r-o", Source: "doctor", Project: "/w/app", Metric: "m", Baseline: "1", Current: "2", Target: "0", Verdict: "worse", "Verified by": "bot", "Ledger file updated": ago(900), "Last seen": ago(300), ID: "o" });
    });
    test("a sparse finding shows dashes, the id as title and a default drawer title", async () => {
      const el = await mount({ findings: [{ id: "z", actionable: true }] });
      fire(frows(el)[0], "click");
      await until(() => drawer());
      const d = drawer();
      expect(d.getAttribute("aria-label")).toBe("Finding");
      expect(d.querySelector(".pg-detail-title").textContent).toBe("z");
      expect([...d.querySelectorAll(".pg-detail-head .badge")].map((b) => b.textContent)).toEqual(["open", "info"]);
      expect(d.querySelector("pre")).toBeNull();
      const facts = Object.fromEntries([...d.querySelectorAll(".pg-kv")].map((k) => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]));
      expect(facts.Rule).toBe("—");
      expect(facts["First seen"]).toBe("—");
      expect(facts.ID).toBe("z");
    });
    test("?finding= opens that finding on arrival, accepting the doctor: prefix", async () => {
      await mount({ findings: [F("doctor:abc"), F("other")] }, { params: { finding: "abc" } });
      const t = timeouts.find((x) => x.live && x.ms === 0);
      expect(t).toBeTruthy();
      t.fn();
      await until(() => drawer());
      expect(drawer().getAttribute("aria-label")).toBe("Finding doctor:abc");
    });
    test("?finding= also matches the exact id", async () => {
      await mount({ findings: [F("exact")] }, { params: { finding: "exact" } });
      timeouts.find((x) => x.live && x.ms === 0).fn();
      await until(() => drawer());
    });
    test("an unknown ?finding= opens nothing", async () => {
      await mount({ findings: [F("a")] }, { params: { finding: "nope" } });
      expect(timeouts.some((x) => x.live && x.ms === 0)).toBe(false);
    });
  });

  describe("status filters", () => {
    const set = () => [F("o1"), F("o2"), F("a1", { status: "accepted" }), F("f1", { status: "fixed" }), F("x1", { status: undefined })];
    test("tabs show counts from the findings; empty ones are hidden except the always-on set", async () => {
      const el = await mount({ findings: set() });
      const tabs = [...card(el, "Findings").querySelectorAll(".pg-seg")].map((b) => b.textContent);
      expect(tabs).toEqual(["all 5", "open 3", "accepted 1", "fixed 1", "wontfix 0"]);
    });
    test("counts from the server cover the whole store and total all", async () => {
      const el = await mount({ findings: [F("o1")], counts: { open: 7, partial: 2, refuted: 1 } });
      expect([...card(el, "Findings").querySelectorAll(".pg-seg")].map((b) => b.textContent)).toEqual(["all 10", "open 7", "accepted 0", "wontfix 0", "partially verified 2", "refuted 1"]);
      expect(card(el, "Findings (10)")).toBeTruthy();
    });
    test("choosing a tab filters rows and marks it active", async () => {
      const el = await mount({ findings: set() });
      fire(btn(el, "fixed 1"), "click");
      await until(() => frows(el).length === 1, "filtered");
      expect(frows(el)[0].textContent).toContain("Finding f1");
      expect(btn(el, "fixed 1").getAttribute("aria-pressed")).toBe("true");
      expect(btn(el, "all 5").getAttribute("aria-pressed")).toBe("false");
      expect(btn(el, "fixed 1").className).toBe("pg-seg is-active");
    });
    test("a status with no rows says so and keeps its tab even at zero", async () => {
      const el = await mount({ findings: set() });
      fire(btn(el, "wontfix 0"), "click");
      await until(() => card(el, "Findings").textContent.includes("No wontfix findings"));
      expect(card(el, "Findings").textContent).toContain("Pick another status filter.");
    });
    test("no status counts as open for the open tab", async () => {
      const el = await mount({ findings: set() });
      fire(btn(el, "open 3"), "click");
      await until(() => frows(el).length === 3);
      expect(frows(el).map((r) => r.querySelector(".pg-evt-title").textContent)).toEqual(["Finding o1", "Finding o2", "Finding x1"]);
    });
    test("the explanatory paragraph is shown", async () => {
      expect((await mount({ findings: set() })).textContent).toContain("Rows marked read-only come from the verification ledger");
    });
  });

  describe("partial lists", () => {
    const partial = () => ({ findings: [F("o1"), F("o2")], counts: { open: 5 } });
    test("a page shorter than the store says so and offers Show all", async () => {
      const el = await mount(partial());
      expect(el.textContent).toContain("Showing the first 2 of 5; doctor findings waiting for you come first.");
      fire(btn(el, "Show all 5"), "click");
      await until(() => getsOf().length === 2, "all read");
      expect(getsOf()[1][1]).toEqual({ limit: "all" });
    });
    test("after loading all, the cap is noted and the button is gone", async () => {
      const el = await mount(partial());
      answers.improve = { findings: [F("o1"), F("o2")], counts: { open: 5 } };
      fire(btn(el, "Show all 5"), "click");
      await until(() => el.textContent.includes("The list is capped at 500 rows."), "capped note");
      expect(btn(el, "Show all 5")).toBeUndefined();
    });
    test("picking a non-all tab on a partial list loads everything first", async () => {
      const el = await mount(partial());
      fire(btn(el, "accepted 0"), "click");
      await until(() => getsOf().length === 2);
      expect(getsOf()[1][1]).toEqual({ limit: "all" });
    });
    test("picking all on a partial list only redraws", async () => {
      const el = await mount(partial());
      fire(btn(el, "open 5"), "click");
      await until(() => getsOf().length === 2);
      await settle();
      calls.length = 0;
      fire(btn(el, "all 5"), "click");
      await settle();
      expect(getsOf()).toHaveLength(0);
    });
    test("a complete list shows no notice", async () => {
      expect((await mount({ findings: [F("o1")] })).textContent).not.toContain("Showing the first");
    });
  });

  describe("by rule", () => {
    test("sorted by open then count, with baseline deltas, tooltips and 'no baseline'", async () => {
      const el = await mount({ by_rule: [
        { rule: "low", count: 1, open: 0 },
        { rule: "many", count: 9, open: 0, doctor: 4, ledger: 5, baseline: 2.5555, current: 1, trend: "improved" },
        { rule: "open2", count: 2, open: 2 },
        {},
      ] });
      const c = card(el, "By rule, across projects (4)");
      const rows = [...c.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((x) => x.textContent));
      expect(rows.map((r) => r[0])).toEqual(["open2", "many", "low", "—"]);
      expect(rows[1]).toEqual(["many", "×9", "0", "2.556 → 1▲ better"]);
      expect(rows[0][3]).toBe("no baseline");
      expect(c.querySelectorAll("tbody tr")[1].querySelector(".pg-count").getAttribute("title")).toBe("4 doctor, 5 ledger");
      expect(rows[3].slice(1, 3)).toEqual(["×0", "0"]);
    });
    test("empty says nothing recurred", async () => {
      expect(card(await mount(), "By rule, across projects (0)").textContent).toContain("No rule has recurred across projects.");
    });
    test("only the top 12 show until expanded", async () => {
      const by_rule = Array.from({ length: 14 }, (_, i) => ({ rule: "r" + i, count: 100 - i, open: 0 }));
      const el = await mount({ by_rule });
      const c = () => card(el, "By rule");
      expect(c().querySelectorAll("tbody tr")).toHaveLength(12);
      fire(btn(el, "Show all 14"), "click");
      await until(() => c().querySelectorAll("tbody tr").length === 14);
      expect(btn(el, "Top 12 only").getAttribute("aria-pressed")).toBe("true");
      fire(btn(el, "Top 12 only"), "click");
      await until(() => c().querySelectorAll("tbody tr").length === 12);
    });
    test("exactly 12 rules offer no toggle", async () => {
      const el = await mount({ by_rule: Array.from({ length: 12 }, (_, i) => ({ rule: "r" + i, count: 1 })) });
      expect(card(el, "By rule").querySelector(".card-actions button")).toBeNull();
    });
  });

  describe("improvements", () => {
    test("verdict chips, pending last, capped at 15", async () => {
      const items = [{ title: "pend", verdict: "pending", metric: "m", baseline: 1, current: 1 }, { title: "good", verdict: "improved", metric: "m2", baseline: 1.5555, current: 2 }, { title: "same", verdict: "no_change" }, { title: "none" }];
      const el = await mount({ improvements: { verdicts: { improved: 3, no_change: 1 }, items } });
      const c = card(el, "Remeasured improvements (4)");
      expect([...c.querySelectorAll(".pg-verdict")].map((v) => v.textContent)).toEqual(["improved3", "no change1", "regressed0", "pending0"]);
      const rows = [...c.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((x) => x.textContent));
      expect(rows.map((r) => r[0])).toEqual(["good", "same", "none", "pend"]);
      expect(rows[0]).toEqual(["good", "m2", "1.556 → 2", "improved"]);
      expect(rows.at(-1)[0]).toBe("pend");
      expect(rows.find((r) => r[0] === "none")).toEqual(["none", "—", "— → —", "pending"]);
      expect(rows.find((r) => r[0] === "same")[3]).toBe("no change");
      const tone = (title) => [...c.querySelectorAll("tbody tr")].find((r) => r.querySelector("td").textContent === title).querySelector("[data-status]").getAttribute("data-status");
      expect([tone("good"), tone("same"), tone("pend")]).toEqual(["ok", "info", "info"]);
    });
    test("more than 15 items show only 15", async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ title: "t" + i, verdict: "improved" }));
      expect(card(await mount({ improvements: { items } }), "Remeasured improvements (20)").querySelectorAll("tbody tr")).toHaveLength(15);
    });
    test("none shows the empty line", async () => {
      expect(card(await mount(), "Remeasured improvements (0)").textContent).toContain("No improvement baselines recorded yet.");
    });
  });

  describe("asset verdicts", () => {
    test("rows per kind with breakdown and applied/restored; header totals", async () => {
      const el = await mount({ asset_verdicts: { total: 5, applied: 3, restored: 1, by_kind: [{ kind: "skill", count: 5, verdicts: { good: 3, bad: 2 }, applied: 3, restored: 1 }] } });
      const c = card(el, "Asset verdicts (5)");
      expect(c.querySelector(".pg-group-meta").textContent).toBe("3 applied · 1 restored");
      expect([...c.querySelectorAll("tbody tr td")].map((x) => x.textContent)).toEqual(["skill", "×5", "good 3 · bad 2", "3 / 1"]);
    });
    test("empty and default header", async () => {
      const c = card(await mount(), "Asset verdicts (0)");
      expect(c.textContent).toContain("No asset verdicts recorded for this scope.");
      expect(c.querySelector(".pg-group-meta").textContent).toBe("0 applied · 0 restored");
    });
  });

  describe("enforcement", () => {
    test("rules table, counts line and project breakdown", async () => {
      const el = await mount({ enforcement: { total: 4, counts: { gate_deny: 3, gate_block: 1 }, top_rules: [{ rule: "no-rm", kind: "deny", count: 3, hint: "use trash" }, {}], projects: [{ name: "alpha", count: 3 }, { project: "/w/beta", count: 1 }] } });
      const c = card(el, "Policy adherence (4 enforced, 7d)");
      expect(c.textContent).toContain("3 denied calls, 1 gate blocks.");
      const rows = [...c.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((x) => x.textContent));
      expect(rows).toEqual([["no-rm", "deny", "×3", "use trash"], ["—", "enforced", "×0", "—"]]);
      expect(c.textContent).toContain("By project: alpha ×3, beta ×1");
    });
    test("empty and no-projects variants", async () => {
      expect(card(await mount(), "Policy adherence (0 enforced, 7d)").textContent).toContain("No denies or gate blocks in the last 7 days.");
      page.destroy();
      expect(card(await mount({ enforcement: { total: 1, top_rules: [], projects: [] } }), "Policy adherence").textContent).not.toContain("By project");
    });
  });

  describe("ledger", () => {
    test("newest first, undated file entries say so, severity tag, status tones", async () => {
      const ledger = [
        { id: "old", title: "Old", status: "fixed", verdict: "ok", time: ago(86400), detail: "d1" },
        { id: "mid", status: "refuted", time_source: "file", time: ago(3600), severity: "high" },
        { id: "new", title: "New", status: "open", severity: "info", detail: "x" },
      ];
      const el = await mount({ ledger });
      const c = card(el, "Verification ledger (3)");
      const items = [...c.querySelectorAll("li.tl-item")];
      expect(items.map((i) => i.querySelector(".tl-title").textContent)).toEqual(["New", "mid", "Old"]);
      expect(items[0].querySelector(".tl-detail").textContent).toBe("open — x");
      expect(items[0].querySelector(".tag")).toBeNull();
      expect(items[1].querySelector(".tl-detail").textContent).toBe("refuted — undated entry (ledger file updated 1h ago)");
      expect(items[1].querySelector(".tl-time")).toBeNull();
      expect(items[1].querySelector(".tag").textContent).toBe("high");
      expect(items[2].querySelector(".tl-time").textContent).toBe(ago(86400));
      expect(items[2].querySelector(".tl-detail").textContent).toBe("fixed — ok — d1");
      expect(items.map((i) => i.querySelector("[data-status]").getAttribute("data-status"))).toEqual(["warn", "fail", "ok"]);
    });
    test("empty shows the hint; only the latest 40 show until expanded", async () => {
      expect(card(await mount(), "Verification ledger (0)").textContent).toContain("No verdicts recorded in .atlas/.run/findings.json yet.");
      page.destroy();
      const ledger = Array.from({ length: 45 }, (_, i) => ({ id: "e" + i, title: "E" + i, status: "open" }));
      const el = await mount({ ledger });
      const c = () => card(el, "Verification ledger");
      expect(c().querySelectorAll("li.tl-item")).toHaveLength(40);
      expect(c().querySelector(".tl-title").textContent).toBe("E44");
      fire(btn(el, "Show all 45"), "click");
      await until(() => c().querySelectorAll("li.tl-item").length === 45);
      fire(btn(el, "Latest 40 only"), "click");
      await until(() => c().querySelectorAll("li.tl-item").length === 40);
    });
    test("exactly 40 offer no toggle", async () => {
      const el = await mount({ ledger: Array.from({ length: 40 }, (_, i) => ({ id: "e" + i, status: "open" })) });
      expect(card(el, "Verification ledger").querySelector(".card-actions button")).toBeNull();
    });
  });

  describe("nudges and lessons", () => {
    test("nudge facts and recent list", async () => {
      const el = await mount({ nudges: { last: ago(3600), sessions_nudged: 4, throttle_min: 30, source: "hook", recent: [{ ts: "2026-06-10T11:00:00Z", session: "s1", emitted: 2 }, { time: "t2", session: "s2", emitted: 1 }, { ts: "t3", session: "s3" }, "plain"] } });
      const c = card(el, "Nudges");
      const facts = Object.fromEntries([...c.querySelectorAll(".pg-kv")].map((k) => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]));
      expect(facts).toEqual({ "Last nudge": "1h ago", "Sessions nudged": "4", Throttle: "30 min", Source: "hook" });
      expect([...c.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["2026-06-10T11:00:00Z session s1: 2 reminders shown", "t2 session s2: 1 reminder shown", "t3 session s3: checked, nothing to say", " plain"]);
    });
    test("defaults when nothing was nudged", async () => {
      const c = card(await mount(), "Nudges");
      const facts = Object.fromEntries([...c.querySelectorAll(".pg-kv")].map((k) => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]));
      expect(facts).toEqual({ "Last nudge": "never", "Sessions nudged": "—", Throttle: "—", Source: "—" });
      expect(c.textContent).toContain("No nudges sent recently.");
    });
    test("only 12 recent nudges are listed", async () => {
      const recent = Array.from({ length: 15 }, (_, i) => ({ ts: "t" + i, session: "s" }));
      expect(card(await mount({ nudges: { recent } }), "Nudges").querySelectorAll("li")).toHaveLength(12);
    });
    test("lessons list (titles, objects and strings), project names when unscoped, capped at 20", async () => {
      const lessons = [{ title: "A", project_name: "p1" }, { lesson: "B" }, { name: "C" }, "plain", ...Array.from({ length: 20 }, (_, i) => ({ title: "L" + i }))];
      const el = await mount({ lessons });
      const c = card(el, "Lessons (24)");
      expect(c.querySelector(".pg-group-meta").textContent).toBe("All projects");
      const items = [...c.querySelectorAll("li")];
      expect(items).toHaveLength(20);
      expect(items.slice(0, 4).map((l) => l.textContent)).toEqual(["A · p1", "B", "C", "plain"]);
    });
    test("scoped lessons name the project and hide per-lesson project names", async () => {
      const el = await mount({ lessons: [{ title: "A", project_name: "p1" }] }, { project: "/w/app" });
      const c = card(el, "Lessons (1)");
      expect(c.querySelector(".pg-group-meta").textContent).toBe("Project: app");
      expect(c.querySelector("li").textContent).toBe("A");
    });
    test("empty lessons wording differs by scope", async () => {
      expect(card(await mount(), "Lessons (0)").textContent).toContain("No lessons recorded in docs/lessons/.");
      page.destroy();
      expect(card(await mount(undefined, { project: "/w/app" }), "Lessons (0)").textContent).toContain("No lessons recorded in this project’s docs/lessons/.");
    });
  });

  describe("score trends", () => {
    test("one chart per judgment with its direction, trend, range and samples", async () => {
      const scores = { labels: ["d1", "d2", "d3"], series: [{ name: "reply_chars", direction: "down", trend: "improved", values: [10, null, 5], first: 10, latest: 5, min: 5, max: 10, samples: 2 }, { name: "pass_rate", direction: "up", values: [0.5, 0.75, 0.9], first: 0.5, latest: 0.9, min: 0.5, max: 0.9, samples: 3 }] };
      const el = await mount({ scores });
      const [a, b] = [...card(el, "Score trends (14d)").querySelectorAll(".pg-score")];
      expect(a.getAttribute("aria-label")).toBe("reply_chars: lower is better");
      expect(a.querySelector(".pg-group-meta").textContent).toBe("▼ lower is better");
      expect(a.querySelector(".badge").textContent).toBe("▲ better");
      expect(a.querySelector("svg")).not.toBeNull();
      expect(a.querySelector("svg.chart").getAttribute("viewBox")).toBe("0 0 640 110");
      expect(a.querySelector("p.pg-group-meta").textContent).toBe("10 → 5 · range 5–10 · n=2");
      expect(b.getAttribute("aria-label")).toBe("pass_rate: higher is better");
      expect(b.querySelector(".pg-group-meta").getAttribute("title")).toBe("Higher is better");
      expect(b.querySelector("p.pg-group-meta").textContent).toBe("0.5 → 0.9 · range 0.5–0.9 · n=3");
    });
    test("fewer than two real points asks for more data", async () => {
      const scores = { labels: ["d1", "d2"], series: [{ name: "x", direction: "up", values: [1, null], samples: 1 }] };
      const c = card(await mount({ scores }), "Score trends");
      expect(c.textContent).toContain("Needs two days of data.");
      expect(c.querySelector("svg")).toBeNull();
    });
    test("no scores explains when they appear", async () => {
      expect(card(await mount(), "Score trends").textContent).toContain("Scores appear after at least two doctor runs.");
      page.destroy();
      expect(card(await mount({ scores: { labels: [], series: [{}] } }), "Score trends").textContent).toContain("Scores appear");
      page.destroy();
      expect(card(await mount({ scores: { labels: ["a"], series: [] } }), "Score trends").textContent).toContain("Scores appear");
    });
  });

  describe("self-fix", () => {
    const sfData = (over = {}) => ({ selffix: { enabled: true, interval_min: 60, last_tick: Math.floor(NOW / 1000) - 120, ...over } });
    test("header text: last pass age, or no pass yet, or the unavailable reason", async () => {
      expect(card(await mount(sfData()), "Self-fix").textContent).toContain("last pass 2m ago. Each fix runs in its own terminal pane on its own git worktree; nothing is pushed.");
      page.destroy();
      expect(card(await mount(sfData({ last_tick: 0 })), "Self-fix").textContent).toContain("no pass yet.");
      page.destroy();
      expect(card(await mount(sfData({ error: "no git" })), "Self-fix").textContent).toContain("Unavailable: no git");
    });
    test("empty state when nothing is in flight", async () => {
      expect(card(await mount(sfData()), "Self-fix").textContent).toContain("No fixes in flight.");
    });
    test("controls reflect the settings", async () => {
      const el = await mount(sfData({ enabled: true, interval_min: 30 }));
      const box = aria(el, "Enable autonomous self-fix");
      expect(box.checked || box.hasAttribute("checked")).toBeTruthy();
      const opts = [...el.querySelector('[aria-label="Self-fix interval in minutes"]').querySelectorAll("option")];
      expect(opts.map((o) => o.value)).toEqual(["15", "30", "60", "120", "360"]);
      expect(opts.map((o) => o.textContent)).toEqual(["15 min", "30 min", "60 min", "120 min", "360 min"]);
      expect(opts.map((o) => o.selected || o.hasAttribute("selected"))).toEqual([false, true, false, false, false]);
    });
    test("toggling autonomy saves the preference, toasts and re-reads", async () => {
      const el = await mount(sfData({ enabled: false }));
      const box = aria(el, "Enable autonomous self-fix");
      box.checked = true;
      fire(box, "change", { target: box });
      await until(() => getsOf().length === 2, "re-read");
      expect(calls.find((c) => c[0] === "PUT /api/v2/prefs")[1]).toEqual({ selffix: { enabled: true } });
      expect(toasts[0]).toEqual(["Self-fix settings saved", { kind: "ok" }]);
    });
    test("choosing an interval saves it as a number", async () => {
      const el = await mount(sfData());
      const sel = el.querySelector('[aria-label="Self-fix interval in minutes"]');
      sel.value = "120";
      fire(sel, "change", { target: sel });
      await until(() => calls.some((c) => c[0] === "PUT /api/v2/prefs"));
      expect(calls.find((c) => c[0] === "PUT /api/v2/prefs")[1]).toEqual({ selffix: { interval_min: 120 } });
    });
    test("a failed preference save toasts the reason and still re-reads", async () => {
      const el = await mount(sfData({ enabled: false }));
      answers.put = Object.assign(new Error("x"), { error: "Denied", why: "locked" });
      const box = aria(el, "Enable autonomous self-fix");
      fire(box, "change", { target: box });
      await until(() => toasts.length === 1);
      expect(toasts[0]).toEqual(["Denied: locked", { kind: "fail" }]);
      await until(() => getsOf().length === 2);
    });
    test("Run now starts a pass with the busy label, toasts and re-reads", async () => {
      const el = await mount(sfData());
      let release;
      ctx.api.post = (path, body) => { calls.push(["POST " + path, body]); return new Promise((r) => { release = r; }); };
      fire(byLabel(el, "Run self-fix now"), "click");
      await until(() => btn(el, "Starting…"), "busy label");
      expect(btn(el, "Starting…").disabled).toBe(true);
      expect(calls.at(-1)).toEqual(["POST /api/v2/improve/selffix", { op: "run_now", id: "" }]);
      fire(btn(el, "Starting…"), "click");
      expect(calls.filter((c) => c[0].startsWith("POST"))).toHaveLength(1);
      release({ ok: true });
      await until(() => toasts.length === 1);
      expect(toasts[0]).toEqual(["Self-fix pass started in the background", { kind: "ok" }]);
      await until(() => getsOf().length === 2);
      await until(() => btn(el, "Run now"));
    });
    test("a refused self-fix op toasts the reason", async () => {
      const el = await mount(sfData());
      answers.post = { ok: false, error: "Busy", why: "one at a time" };
      fire(byLabel(el, "Run self-fix now"), "click");
      await until(() => toasts.length === 1);
      expect(toasts[0]).toEqual(["Busy: one at a time", { kind: "fail" }]);
    });
    test("running, ready and failed lists with their buttons", async () => {
      const el = await mount(sfData({
        running: [{ id: "r1", title: "Run one", fix_state: "running", attempts: 2, target: "pane 3", attach: "herdr attach", branch: "fix/r1" }, { id: "r2", fix_state: "queued" }],
        ready: [{ id: "g1", title: "Ready one", fix_state: "ready", branch: "fix/g1", diffstat: "1 file changed" }, { id: "g2", title: "No stat", fix_state: "ready" }],
        failed: [{ id: "x1", title: "Failed one", fix_state: "failed", log: "boom" }, { id: "x2", title: "No log", fix_state: "failed" }],
      }));
      const c = card(el, "Self-fix");
      expect(c.textContent).not.toContain("No fixes in flight");
      expect([...c.querySelectorAll("h3.pg-sub")].map((x) => x.textContent)).toEqual(["Running (2)", "Ready to merge (2)", "Failed (2)"]);
      const rows = [...c.querySelectorAll("li.pg-selffix-row")];
      expect(rows[0].textContent).toContain("attempt 2");
      expect(rows[0].textContent).toContain("pane 3 — herdr attach");
      expect(rows[0].textContent).toContain("branch fix/r1");
      expect(rows[0].querySelector(".badge").textContent).toBe("running");
      expect(rows[1].querySelector(".pg-evt-title").textContent).toBe("r2");
      expect(rows[1].textContent).not.toContain("attempt");
      expect(rows[2].querySelector("pre").textContent).toBe("1 file changed");
      expect(rows[3].querySelector("pre").textContent).toBe("(no diff stat)");
      expect(rows[4].querySelector("pre").textContent).toBe("boom");
      expect(rows[5].querySelector("pre").textContent).toBe("(no log)");
      expect(byLabel(el, "Merge: Ready one").className).toBe("btn btn-primary");
      expect(byLabel(el, "Discard: Ready one").className).toBe("btn btn-ghost");
      expect(byLabel(el, "Retry: Failed one")).toBeTruthy();
      expect(rows[2].querySelector(".badge").getAttribute("data-status")).toBe("ok");
      expect(rows[4].querySelector(".badge").getAttribute("data-status")).toBe("fail");
    });
    test("Merge, Discard and Retry post their op with the id and toast their wording", async () => {
      const el = await mount(sfData({ ready: [{ id: "g1", title: "Ready one", fix_state: "ready", branch: "fix/g1" }], failed: [{ id: "x1", title: "Failed one", fix_state: "failed" }] }));
      const cases = [["Merge: Ready one", "merge", "g1", "Merged fix/g1 locally"], ["Discard: Ready one", "discard", "g1", "Fix discarded"], ["Retry: Failed one", "retry", "x1", "Queued for another attempt"]];
      for (const [label, op, id, msg] of cases) {
        calls.length = 0; toasts.length = 0;
        fire(byLabel(el, label), "click");
        await until(() => toasts.length === 1);
        expect(calls.find((c) => c[0] === "POST /api/v2/improve/selffix")[1]).toEqual({ op, id });
        expect(toasts[0]).toEqual([msg, { kind: "ok" }]);
        await until(() => getsOf().length === 1);
        await settle();
      }
    });
    test("a fix button shows its busy label while the request is in flight", async () => {
      const el = await mount(sfData({ ready: [{ id: "g1", title: "Ready one", fix_state: "ready", branch: "b" }] }));
      ctx.api.post = () => new Promise(() => {});
      fire(byLabel(el, "Merge: Ready one"), "click");
      await until(() => btn(el, "Merge…"));
      expect(btn(el, "Merge…").disabled).toBe(true);
    });
  });

  describe("live events", () => {
    test("an improve event with findings replaces the data and repaints", async () => {
      const el = await mount({ findings: [F("1")] });
      page.onEvent("improve", ctx, { findings: [F("1"), F("2")] });
      await until(() => frows(el).length === 2);
    });
    test("an improve event without a findings list is ignored", async () => {
      const el = await mount({ findings: [F("1")] });
      page.onEvent("improve", ctx, {});
      page.onEvent("improve", ctx, null);
      page.onEvent("improve", ctx, { findings: "no" });
      await settle();
      expect(frows(el)).toHaveLength(1);
    });
    test("when the full list is loaded an improve event re-reads instead of taking the paged body", async () => {
      const el = await mount({ findings: [F("1")], counts: { open: 3 } });
      answers.improve = { findings: [F("1")], counts: { open: 3 } };
      fire(btn(el, "Show all 3"), "click");
      await until(() => getsOf().length === 2);
      await settle();
      page.onEvent("improve", ctx, { findings: [F("only")] });
      await until(() => getsOf().length === 3, "re-read");
      expect(frows(el)[0].textContent).toContain("Finding 1");
    });
    test("a polled tick re-reads; an unpolled tick and other events do not", async () => {
      await mount({ findings: [F("1")] });
      page.onEvent("tick", ctx, { polled: false });
      page.onEvent("tick", ctx, null);
      page.onEvent("herd", ctx, { polled: true });
      await settle();
      expect(getsOf()).toHaveLength(1);
      page.onEvent("tick", ctx, { polled: true });
      await until(() => getsOf().length === 2);
    });
    test("events are ignored while a change is in flight", async () => {
      const el = await mount({ findings: [F("1")] });
      ctx.api.post = () => new Promise(() => {});
      fire(byLabel(el, "Accept: Finding 1"), "click");
      await until(() => byLabel(el, "Accept: Finding 1").disabled);
      page.onEvent("improve", ctx, { findings: [F("1"), F("2")] });
      page.onEvent("tick", ctx, { polled: true });
      await settle();
      expect(frows(el)).toHaveLength(1);
      expect(getsOf()).toHaveLength(1);
    });
    test("events before the page exists or after destroy are ignored", async () => {
      page.onEvent("improve", ctx, { findings: [] });
      await mount({ findings: [F("1")] });
      page.destroy();
      page.onEvent("tick", ctx, { polled: true });
      await settle();
      expect(getsOf()).toHaveLength(1);
    });
  });

  describe("destroy", () => {
    test("is safe twice", async () => {
      await mount();
      page.destroy();
      expect(() => page.destroy()).not.toThrow();
    });
    const lateTest = (name, start, release) => test(name, async () => {
      const errors = [];
      const onErr = (e) => errors.push(e);
      process.on("unhandledRejection", onErr);
      try {
        const el = await mount({ findings: [F("1")], selffix: { ready: [{ id: "g1", title: "G", fix_state: "ready", branch: "b" }] } });
        let done;
        ctx.api.get = () => new Promise((r) => { done = r; });
        ctx.api.post = () => new Promise((r) => { done = r; });
        ctx.api.put = () => new Promise((r) => { done = r; });
        start(el);
        await settle();
        page.destroy();
        done(release);
        await settle();
        expect(errors).toEqual([]);
        expect(toasts).toEqual([]);
        expect(frows(el)).toHaveLength(1);
      } finally { process.off("unhandledRejection", onErr); }
    });
    lateTest("a read that finishes after destroy neither raises nor paints", (el) => fire(btn(el, "Refresh"), "click"), { findings: [] });
    lateTest("a status change that finishes after destroy neither raises nor toasts", (el) => fire(byLabel(el, "Accept: Finding 1"), "click"), { ok: true, state: { findings: [] } });
    lateTest("a self-fix op that finishes after destroy neither raises nor toasts", (el) => fire(byLabel(el, "Merge: G"), "click"), { ok: true });
    lateTest("a preference save that finishes after destroy neither raises nor toasts", (el) => { const b = aria(el, "Enable autonomous self-fix"); fire(b, "change", { target: b }); }, {});
    lateTest("a failing change after destroy is silent too", (el) => fire(byLabel(el, "Accept: Finding 1"), "click"), { ok: false, error: "late" });
  });

  describe("focus", () => {
    test("a labelled control keeps focus across the redraw a change causes", async () => {
      const el = await mount({ findings: [F("1"), F("2")] });
      const b = byLabel(el, "Remeasure: Finding 2");
      b.focus();
      answers.post = { ok: true, state: { findings: [F("1", { status: "accepted" }), F("2")] } };
      fire(byLabel(el, "Accept: Finding 1"), "click");
      await until(() => !byLabel(el, "Accept: Finding 1"));
      expect(document.activeElement).toBe(byLabel(el, "Remeasure: Finding 2"));
    });
  });
});
