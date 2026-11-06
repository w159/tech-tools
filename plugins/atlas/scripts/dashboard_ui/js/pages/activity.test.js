import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "../rich-dom.js";
import { closeModal, closeDrawer, hasOpenModal, hasOpenDrawer } from "../ui-overlays.js";

let dom, page, calls, nav, answers, ctx, intervals, timeouts, toasts, seq = 0, savedNow, savedTimers, wrap;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
const realNow = Date.now;
const NOW = Date.parse("2026-06-10T12:00:00Z");
const until = async (cond, what = "condition") => { const end = realNow() + 2000; while (!cond()) { if (realNow() > end) throw new Error("timed out: " + what); await new Promise((r) => realTimers.setTimeout(r, 1)); } };
const settle = () => new Promise((r) => realTimers.setTimeout(r, 10));
const ago = (s) => new Date(NOW - s * 1000).toISOString();

beforeEach(async () => {
  dom = installRichDom();
  page = (await import("./activity.js?n=" + ++seq)).default;
  calls = []; nav = []; toasts = []; intervals = []; timeouts = [];
  answers = { activity: { groups: [] }, put: {}, transcript: { text: "", path: "/t" } };
  savedNow = Date.now;
  Date.now = () => NOW;
  globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms, live: true }); return intervals.length; };
  globalThis.clearInterval = (id) => { if (intervals[id - 1]) intervals[id - 1].live = false; };
  globalThis.setTimeout = (fn, ms) => { timeouts.push({ fn, ms, live: true }); return timeouts.length; };
  globalThis.clearTimeout = (id) => { if (timeouts[id - 1]) timeouts[id - 1].live = false; };
  wrap = document.createElement("div");
  dom.body.appendChild(wrap);
  const insp = document.createElement("div");
  insp.id = "inspector";
  wrap.appendChild(insp);
  ctx = {
    project: "all", params: {}, prefs: {},
    api: {
      get: async (path, q) => {
        calls.push([path, q]);
        if (path.startsWith("/api/sessions/")) { if (answers.transcript instanceof Error) throw answers.transcript; return answers.transcript; }
        if (answers.activity instanceof Error) throw answers.activity;
        return typeof answers.activity === "function" ? answers.activity(q) : answers.activity;
      },
      put: async (path, body) => { calls.push(["PUT " + path, body]); if (answers.put instanceof Error) throw answers.put; return answers.put; },
    },
    navigate: (t) => nav.push(t),
    toast: (m, o) => toasts.push([m, o]),
    store: { set(k, v) { (ctx.stored ||= {})[k] = v; } },
  };
});
afterEach(() => {
  page.destroy();
  closeModal(); closeDrawer();
  Date.now = savedNow;
  Object.assign(globalThis, realTimers);
  restoreRichDom();
});

const item = (id, over = {}) => ({ id, ts: ago(120), status: "ok", kind: "run", title: "Run " + id, agent: "omp", project: "/w/app", ...over });
const group = (key, items, over = {}) => ({ key, label: key, count: items.length, last: ago(60), items, ...over });
const mount = async (activity, over = {}) => {
  if (activity !== undefined) answers.activity = activity;
  Object.assign(ctx, over);
  const data = await page.load(ctx);
  const el = page.render(ctx, data);
  wrap.appendChild(el);
  return el;
};
const rows = (el) => [...el.querySelectorAll("tbody tr")];
const titles = (el) => [...el.querySelectorAll(".pg-evt-title")].map((t) => t.textContent);
const btn = (el, text) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);
const drawer = () => document.querySelector(".drawer");
const flushTimeouts = () => { for (const t of timeouts) if (t.live) { t.live = false; t.fn(); } };

describe("activity page", () => {
  test("identity", () => { expect([page.id, page.title, page.icon, page.group]).toEqual(["activity", "Activity", "activity", "Observe"]); });

  describe("load and params", () => {
    test("default read: grouped by project, limit 200, no project for all", async () => {
      await mount();
      expect(calls).toEqual([["/api/v2/activity", { group: "project", limit: 200 }]]);
    });
    test("route params become filters: project, kind, scratch, group, search", async () => {
      await mount(undefined, { project: "/w/app", params: { kind: "finding", scratch: "1", group: "agent", q: "boom" } });
      expect(calls[0][1]).toEqual({ group: "agent", limit: 200, project: "/w/app", kind: "finding", scratch: 1, q: "boom" });
    });
    test("scratch only for the string 1, unknown group falls back to project", async () => {
      await mount(undefined, { params: { scratch: "0", group: "nope" } });
      expect(calls[0][1]).toEqual({ group: "project", limit: 200 });
    });
    test("a failed read shows the error with its advice and Retry recovers", async () => {
      answers.activity = Object.assign(new Error("x"), { error: "Daemon down", why: "no socket", do: "start" });
      const data = await page.load(ctx);
      expect(data == null).toBe(true);
      const el = page.render(ctx, data);
      wrap.appendChild(el);
      expect(el.textContent).toContain("Daemon down");
      expect(el.textContent).toContain("no socket — start");
      answers.activity = { groups: [group("a", [item("1")])] };
      fire(btn(el, "Retry"), "click");
      await until(() => rows(el).length === 1, "recovered");
    });
    test("error wording: 404, bare failure, silent endpoint", async () => {
      answers.activity = Object.assign(new Error("x"), { status: 404 });
      let el = page.render(ctx, await page.load(ctx));
      expect(el.textContent).toContain("Activity API is not available yet");
      expect(el.textContent).toContain("The activity endpoint did not answer.");
      answers.activity = Object.assign(new Error("x"), {});
      el = page.render(ctx, await page.load(ctx));
      expect(el.textContent).toContain("Request failed");
    });
    test("render before any load shows the loading line", () => {
      const el = page.render(ctx);
      expect([...el.querySelectorAll("[role=status]")].map((n) => n.textContent)).toContain("Loading activity…");
      expect(el.querySelector(".pg-sub").textContent).toBe("Everything Atlas observed, grouped and de-duplicated.");
    });
  });

  describe("groups and rows", () => {
    test("one card per group with its count line and a row per item", async () => {
      const el = await mount({ groups: [group("alpha", [item("1"), item("2")], { count: 5 }), group("beta", [item("3")], { label: "Beta" })] });
      const secs = [...el.querySelectorAll("section.pg-group")];
      expect(secs.map((s) => s.getAttribute("aria-label"))).toEqual(["alpha (5 events)", "Beta (1 events)"]);
      expect(secs[0].querySelector(".pg-group-meta").textContent).toBe("5 events in 2 rows · last 1m ago");
      expect(rows(secs[0])).toHaveLength(2);
      expect(rows(secs[1])).toHaveLength(1);
    });
    test("a group without label or count uses its key and item count", async () => {
      const el = await mount({ groups: [{ key: "k", items: [item("1")] }, { items: [item("2")] }] });
      const secs = [...el.querySelectorAll("section.pg-group")];
      expect(secs[0].getAttribute("aria-label")).toBe("k (1 events)");
      expect(secs[0].querySelector(".pg-group-meta").textContent).toBe("1 events in 1 rows · last —");
      expect(secs[1].getAttribute("aria-label")).toBe("— (1 events)");
    });
    test("a row shows when, status, kind label, title, agent and project folder", async () => {
      const el = await mount({ groups: [group("a", [item("1", { ts: ago(7200), status: "warn", kind: "hook", agent: "claude" })])], kinds: { hook: { label: "Hook event", help: "what it means" } } });
      const cells = [...rows(el)[0].querySelectorAll("td")];
      expect(cells[0].textContent).toBe("2h ago");
      expect(cells[1].textContent).toBe("warn");
      expect(cells[1].querySelector("[data-status]").getAttribute("data-status")).toBe("warn");
      expect(cells[2].textContent).toBe("Hook event");
      expect(cells[2].querySelector("span").getAttribute("title")).toBe("what it means");
      expect(cells[3].textContent).toContain("Run 1");
      expect(cells[4].textContent).toBe("claude");
      expect(cells[5].textContent).toBe("app");
    });
    test("missing fields fall back: info status, raw kind, no title, dashes", async () => {
      const el = await mount({ groups: [group("a", [{ id: "1", kind: "weird" }])] });
      const cells = [...rows(el)[0].querySelectorAll("td")];
      expect(cells[0].textContent).toBe("—");
      expect(cells[0].querySelector("time").getAttribute("datetime")).toBe("");
      expect(cells[0].querySelector("time").getAttribute("title")).toBe("");
      expect(cells[1].textContent).toBe("info");
      expect(cells[1].querySelector("[data-status]").getAttribute("data-status")).toBe("info");
      expect(cells[2].textContent).toBe("weird");
      expect(cells[3].textContent).toContain("(no title)");
      expect(cells[4].textContent).toBe("—");
      expect(cells[5].textContent).toBe("—");
    });
    test("a collapsed row shows its count and the detail line", async () => {
      const el = await mount({ groups: [group("a", [item("1", { count: 4, detail: "stack trace" }), item("2", { count: 1 })])] });
      const evt = rows(el).map((r) => r.querySelector(".pg-evt"));
      expect(evt[0].querySelector(".pg-count").textContent).toBe("×4");
      expect(evt[0].querySelector(".pg-count").getAttribute("title")).toBe("4 identical events collapsed");
      expect(evt[0].querySelector(".pg-clip").textContent).toBe("stack trace");
      expect(evt[1].querySelector(".pg-count")).toBeNull();
      expect(evt[1].querySelector(".pg-clip")).toBeNull();
    });
    test("the summary line counts visible rows, the group, the span and truncation", async () => {
      const el = await mount({ groups: [group("a", [item("1"), item("2")])], since: "2026-06-03T00:00:00Z", as_of: ago(5), truncated: true });
      expect(el.querySelector(".pg-sub").textContent).toContain("2 rows shown, grouped by project, since 2026-06-03, as of 5s ago.");
      expect(el.querySelector(".pg-sub").textContent).toContain("Older rows were cut off; narrow the filters to see them.");
      const plain = await mount({ groups: [group("a", [item("1")])] });
      expect(plain.querySelector(".pg-sub").textContent).toContain("1 rows shown, grouped by project, .");
      expect(plain.querySelector(".pg-sub").textContent).not.toContain("cut off");
    });
    test("an empty answer explains and Clear filters resets kind and search", async () => {
      const el = await mount({ groups: [] }, { params: { kind: "finding", q: "zzz" } });
      expect(el.textContent).toContain("No activity matches");
      answers.activity = { groups: [group("a", [item("1")])] };
      fire(btn(el, "Clear filters"), "click");
      await until(() => rows(el).length === 1, "cleared");
      expect(calls[1][1]).toEqual({ group: "project", limit: 200 });
    });
  });

  describe("noise preferences", () => {
    const data = () => ({ groups: [group("a", [item("1", { kind: "noisy" }), item("2", { project: "/w/muted" }), item("3", { status: "info" }), item("4", { status: "warn" }), item("5", { status: "fail" }), item("6", { status: "weird" })]), group("empty", [item("7", { kind: "noisy" })])] });
    test("muted kinds and muted projects are hidden; a group left empty disappears", async () => {
      const el = await mount(data(), { prefs: { muted_kinds: ["noisy"], muted_projects: ["/w/muted"] } });
      expect(titles(el)).toEqual(["Run 3", "Run 4", "Run 5", "Run 6"]);
      expect(el.querySelectorAll("section.pg-group")).toHaveLength(1);
    });
    test("a minimum severity hides the quieter rows (unknown statuses count as info)", async () => {
      expect(titles(await mount(data(), { prefs: { noise: { min_severity: "warn" } } }))).toEqual(["Run 4", "Run 5"]);
      page.destroy();
      expect(titles(await mount(data(), { prefs: { noise: { min_severity: "fail" } } }))).toEqual(["Run 5"]);
      page.destroy();
      expect(titles(await mount(data(), { prefs: { noise: { min_severity: "info" } } })).length).toBe(7);
    });
    test("everything filtered out reads as no activity", async () => {
      expect((await mount(data(), { prefs: { noise: { min_severity: "fail" }, muted_kinds: ["run"] } })).textContent).toContain("No activity matches");
    });
    test("non-object prefs mean no filtering", async () => {
      expect(titles(await mount(data(), { prefs: "junk" })).length).toBe(7);
    });
  });

  describe("filters", () => {
    test("group and kind selectors list the options and reflect the state", async () => {
      const el = await mount({ groups: [group("a", [item("1", { kind: "b-kind" }), item("2", { kind: "a-kind" }), item("3", { kind: "" })])], kinds: { "a-kind": { label: "Alpha" } } }, { params: { kind: "z-kind" } });
      const opts = (id) => [...el.querySelector("#" + id).querySelectorAll("option")].map((o) => [o.value, o.textContent]);
      expect(opts("pg-act-group")).toEqual([["project", "Project"], ["kind", "Kind"], ["agent", "Agent"]]);
      expect(opts("pg-act-kind")).toEqual([["", "All kinds"], ["a-kind", "Alpha"], ["b-kind", "b-kind"], ["z-kind", "z-kind"]]);
      expect(el.querySelector('label[for="pg-act-group"]').textContent).toBe("Group by");
    });
    test("changing the group refetches with it", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      const sel = el.querySelector("#pg-act-group");
      sel.value = "agent";
      fire(sel, "change", { target: sel });
      await until(() => calls.length === 2);
      expect(calls[1][1].group).toBe("agent");
      await until(() => el.querySelector(".pg-sub").textContent.includes("grouped by agent"));
    });
    test("changing the kind refetches with it", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      const sel = el.querySelector("#pg-act-kind");
      sel.value = "run";
      fire(sel, "change", { target: sel });
      await until(() => calls.length === 2);
      expect(calls[1][1].kind).toBe("run");
    });
    test("the scratch checkbox refetches with scratch=1 and shows the hidden count", async () => {
      const el = await mount({ groups: [group("a", [item("1")])], scratch_hidden: 3 });
      expect(el.querySelector("label.pg-facet.pg-hint").textContent).toBe(" Show test / temp sessions (3 hidden)");
      const box = el.querySelector("#pg-act-scratch");
      box.checked = true;
      fire(box, "change", { target: box });
      await until(() => calls.length === 2);
      expect(calls[1][1].scratch).toBe(1);
      await until(() => el.querySelector("#pg-act-scratch").checked === true || el.querySelector("#pg-act-scratch").hasAttribute("checked"));
    });
    test("the scratch label has no count when nothing is hidden", async () => {
      expect((await mount({ groups: [] })).querySelector("label.pg-facet.pg-hint").textContent).toBe(" Show test / temp sessions");
    });
    test("search is debounced 400ms, trimmed, then refetches", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      const q = el.querySelector("#pg-act-q");
      q.value = "  boo";
      fire(q, "input", { target: q });
      q.value = "  boom  ";
      fire(q, "input", { target: q });
      const live = timeouts.filter((t) => t.live);
      expect(live).toHaveLength(1);
      expect(live[0].ms).toBe(400);
      expect(calls).toHaveLength(1);
      flushTimeouts();
      await until(() => calls.length === 2);
      expect(calls[1][1].q).toBe("boom");
    });
    test("the search box keeps focus and caret across the redraw", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      const q = el.querySelector("#pg-act-q");
      q.focus();
      q.selectionStart = 2; q.selectionEnd = 2;
      q.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b; };
      fire(btn(el, "Refresh"), "click");
      await until(() => calls.length === 2);
      await settle();
      expect(document.activeElement.id).toBe("pg-act-q");
    });
    test("Refresh re-reads and resets the new-row markers", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      fire(btn(el, "Refresh"), "click");
      await until(() => calls.length === 2);
    });
  });

  describe("live tail", () => {
    const liveOn = async (el) => { fire(btn(el, "○ Live tail"), "click"); await until(() => btn(el, "● Live")); };
    test("toggling live shows the flag, arms an 8s interval and flips the button state", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      const b = btn(el, "○ Live tail");
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(intervals).toHaveLength(0);
      await liveOn(el);
      expect(intervals).toHaveLength(1);
      expect(intervals[0].ms).toBe(8000);
      expect(btn(el, "● Live").getAttribute("aria-pressed")).toBe("true");
      expect(btn(el, "● Live").className).toContain("is-on");
      expect(el.querySelector(".pg-live-flag").textContent).toContain("Live — checking every 8s");
      fire(btn(el, "● Live"), "click");
      await until(() => btn(el, "○ Live tail"));
      expect(intervals[0].live).toBe(false);
      expect(el.querySelector(".pg-live-flag")).toBeNull();
    });
    test("a tick asks only for newer rows and merges them on top of the existing group, marking them new", async () => {
      const el = await mount({ groups: [group("a", [item("1", { ts: ago(100) })], { count: 1 })] });
      await liveOn(el);
      answers.activity = (q) => (q.since ? { groups: [group("a", [item("2", { ts: ago(10) }), item("1", { ts: ago(100) })], { last: ago(10) })] } : { groups: [] });
      intervals[0].fn();
      await until(() => titles(el).length === 2, "merged");
      expect(calls[1][1].since).toBe(ago(100));
      expect(titles(el)).toEqual(["Run 2", "Run 1"]);
      expect(el.querySelectorAll(".pg-new")).toHaveLength(1);
      expect(el.querySelector(".pg-evt-title.is-new").textContent).toBe("Run 2");
      expect(el.querySelector("section.pg-group .pg-group-meta").textContent).toBe("2 events in 2 rows · last 10s ago");
    });
    test("rows for a group not yet shown add a new group on top", async () => {
      const el = await mount({ groups: [group("a", [item("1", { ts: ago(100) })])] });
      await liveOn(el);
      answers.activity = (q) => (q.since ? { groups: [group("b", [item("9", { ts: ago(5) })])] } : { groups: [] });
      intervals[0].fn();
      await until(() => el.querySelectorAll("section.pg-group").length === 2, "new group");
      expect([...el.querySelectorAll("section.pg-group")].map((s) => s.getAttribute("aria-label"))).toEqual(["b (1 events)", "a (1 events)"]);
    });
    test("a tick with nothing new changes nothing and allows the next tick", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      await liveOn(el);
      answers.activity = { groups: [group("a", [item("1")])] };
      intervals[0].fn();
      await until(() => calls.length === 2);
      await settle();
      intervals[0].fn();
      await until(() => calls.length === 3, "second tick not blocked");
      expect(el.querySelectorAll(".pg-new")).toHaveLength(0);
    });
    test("a failing tick keeps the page and the next tick still runs", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      await liveOn(el);
      answers.activity = new Error("down");
      intervals[0].fn();
      await until(() => calls.length === 2);
      await settle();
      answers.activity = { groups: [group("a", [item("5", { ts: ago(1) }), item("1")])] };
      intervals[0].fn();
      await until(() => titles(el).includes("Run 5"), "recovered");
    });
    test("a hidden tab skips the interval tick", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      await liveOn(el);
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      try { intervals[0].fn(); await settle(); expect(calls).toHaveLength(1); } finally { delete document.hidden; }
    });
    test("returning to the tab catches up once", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      await liveOn(el);
      answers.activity = { groups: [group("a", [item("1")])] };
      document.dispatchEvent({ type: "visibilitychange" });
      await until(() => calls.length === 2);
      expect(document.listenerCount("visibilitychange")).toBe(1);
    });
    test("turning live off removes the visibility handler", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      await liveOn(el);
      fire(btn(el, "● Live"), "click");
      await until(() => btn(el, "○ Live tail"));
      expect(document.listenerCount("visibilitychange")).toBe(0);
    });
    test("tick events from the shell tail only while live", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      page.onEvent("tick");
      page.onEvent("other");
      page.onEvent(null);
      await settle();
      expect(calls).toHaveLength(1);
      await liveOn(el);
      answers.activity = { groups: [group("a", [item("1")])] };
      page.onEvent("herd");
      await settle();
      expect(calls).toHaveLength(1);
      page.onEvent("tick");
      await until(() => calls.length === 2);
      await settle();
      page.onEvent({ type: "tick" });
      await until(() => calls.length === 3);
    });
    test("a tick before data exists does nothing", async () => {
      answers.activity = new Error("x");
      const el = page.render(ctx, await page.load(ctx));
      wrap.appendChild(el);
      page.onEvent("tick");
      await settle();
      expect(calls).toHaveLength(1);
    });
  });

  describe("detail drawer", () => {
    const open = async (it, extra = {}) => {
      const el = await mount({ groups: [group("a", [it])], ...extra });
      fire(btn(el, "Details"), "click");
      await until(() => drawer(), "drawer");
      return el;
    };
    test("Details opens a drawer with badges, title, help, detail, facts", async () => {
      await open(item("1", { status: "warn", kind: "hook", detail: "the body", count: 3, scratch: true, class: "env", session: "abcdef123456", transcript: true }), { kinds: { hook: { label: "Hook event", help: "explains" } } });
      const d = drawer();
      expect(d.getAttribute("aria-label")).toBe("Run 1");
      const badges = [...d.querySelectorAll(".pg-detail-head .badge")].map((b) => b.textContent);
      expect(badges).toEqual(["warn", "Hook event", "test / temp session", "×3 identical events collapsed"]);
      expect(d.querySelector(".pg-detail-title").textContent).toBe("Run 1");
      expect(d.textContent).toContain("explains");
      expect(d.querySelector("pre").textContent).toBe("the body");
      const facts = Object.fromEntries([...d.querySelectorAll(".pg-kv")].map((k) => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]));
      expect(facts).toEqual({ Latest: ago(120), Project: "app (/w/app)", "Agent / source": "omp", "Cause class": "env" });
    });
    test("a single event says When, and a bare item has dashes and the not-tied note", async () => {
      await open({ id: "x", kind: "run" });
      const d = drawer();
      expect(d.getAttribute("aria-label")).toBe("Activity detail");
      expect(d.querySelector(".pg-detail-title").textContent).toBe("(no title)");
      const facts = Object.fromEntries([...d.querySelectorAll(".pg-kv")].map((k) => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]));
      expect(facts).toEqual({ When: "—", Project: "—", "Agent / source": "—" });
      expect(d.textContent).toContain("This event is not tied to a session, so there is no transcript.");
      expect(d.querySelector("pre")).toBeNull();
      expect([...d.querySelectorAll(".pg-detail-head .badge")].map((b) => b.textContent)).toEqual(["info"]);
    });
    test("a session without a transcript explains why; a finding gets Open in Improve and no note", async () => {
      await open(item("1", { session: "abcdef123456" }));
      expect(drawer().textContent).toContain("No transcript to open: this session was never ingested into the database, or its file is gone.");
      expect([...drawer().querySelectorAll("button")].some((b) => b.textContent === "Open session transcript")).toBe(false);
      closeDrawer(); page.destroy();
      await open(item("2", { kind: "finding" }));
      const d = drawer();
      expect(d.textContent).not.toContain("not tied to a session");
      fire([...d.querySelectorAll("button")].find((b) => b.textContent === "Open in Improve"), "click");
      expect(nav).toEqual(["improve"]);
      expect(hasOpenDrawer()).toBe(false);
    });
    test("clicking the row itself also opens the detail", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      fire(rows(el)[0], "click");
      await until(() => drawer(), "drawer via row");
    });
    test("the transcript button loads readable lines into a second drawer", async () => {
      answers.transcript = { text: JSON.stringify({ message: { role: "user", content: "hello there" } }) + "\n" + JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }), path: "/s/x.jsonl", truncated: true };
      await open(item("1", { session: "abcdef123456", transcript: true }));
      fire([...drawer().querySelectorAll("button")].find((b) => b.textContent === "Open session transcript"), "click");
      await until(() => drawer().getAttribute("aria-label") === "Transcript: session abcdef12", "transcript drawer");
      await until(() => drawer().querySelector("ul"), "lines");
      expect(calls.at(-1)[0]).toBe("/api/sessions/abcdef123456/transcript");
      expect(drawer().querySelector(".pg-hint").textContent).toBe("Last 2 messages (older part of the file not loaded). File: /s/x.jsonl");
      expect([...drawer().querySelectorAll("li")].map((l) => l.textContent)).toEqual(["user: hello there", "assistant: hi"]);
    });
    test("only the last 40 messages are shown", async () => {
      answers.transcript = { text: Array.from({ length: 45 }, (_, i) => JSON.stringify({ message: { role: "user", content: "m" + i } })).join("\n"), path: "/p" };
      await open(item("1", { session: "abcdef123456", transcript: true }));
      fire([...drawer().querySelectorAll("button")].find((b) => b.textContent === "Open session transcript"), "click");
      await until(() => drawer().querySelector("ul"), "lines");
      expect(drawer().querySelectorAll("li")).toHaveLength(40);
      expect(drawer().querySelector("li").textContent).toBe("user: m5");
      expect(drawer().querySelector(".pg-hint").textContent).toStartWith("Last 40 messages.");
    });
    test("an empty transcript and a complete one are worded differently", async () => {
      answers.transcript = { text: "", path: "/p" };
      await open(item("1", { session: "abcdef123456", transcript: true }));
      fire([...drawer().querySelectorAll("button")].find((b) => b.textContent === "Open session transcript"), "click");
      await until(() => drawer().textContent.includes("The transcript has no readable messages yet."), "empty");
      expect(drawer().querySelector(".pg-hint").textContent).toBe("Last 0 messages. File: /p");
    });
    test("a gone transcript and other failures are explained", async () => {
      answers.transcript = Object.assign(new Error("x"), { status: 404 });
      await open(item("1", { session: "abcdef123456", transcript: true }));
      fire([...drawer().querySelectorAll("button")].find((b) => b.textContent === "Open session transcript"), "click");
      await until(() => drawer().textContent.includes("The transcript file is gone"), "gone");
      closeDrawer(); page.destroy();
      answers.transcript = Object.assign(new Error("x"), { error: "Boom", why: "disk", do: "retry" });
      await open(item("1", { session: "abcdef123456", transcript: true }));
      fire([...drawer().querySelectorAll("button")].find((b) => b.textContent === "Open session transcript"), "click");
      await until(() => drawer().textContent.includes("Boom — disk — retry"), "other");
    });
  });

  describe("saved views", () => {
    const view = (id, name, params = {}, pageName = "activity") => ({ id, name, page: pageName, params });
    test("only this page's views are listed, with delete buttons", async () => {
      const el = await mount({ groups: [] }, { prefs: { saved_views: [view("1", "Mine"), view("2", "Other", {}, "health"), null] } });
      const grp = el.querySelector(".pg-views");
      expect(grp.getAttribute("aria-label")).toBe("Saved views");
      expect([...grp.querySelectorAll(".pg-chip")].map((c) => c.textContent)).toEqual(["Mine"]);
      expect(grp.querySelector(".pg-chip-x").getAttribute("aria-label")).toBe("Delete view Mine");
    });
    test("no saved views means no row", async () => {
      expect((await mount({ groups: [] })).querySelector(".pg-views")).toBeNull();
    });
    test("applying a view sets kind, group and search and refetches", async () => {
      const el = await mount({ groups: [] }, { prefs: { saved_views: [view("1", "Mine", { kind: "hook", group: "agent", q: "x" }), view("2", "Bad", { group: "zzz" })] } });
      fire(btn(el, "Mine"), "click");
      await until(() => calls.length === 2);
      expect(calls[1][1]).toEqual({ group: "agent", limit: 200, kind: "hook", q: "x" });
      await settle();
      fire(btn(el, "Bad"), "click");
      await until(() => calls.length === 3);
      expect(calls[2][1]).toEqual({ group: "project", limit: 200 });
    });
    test("Save view opens a modal that describes the filters", async () => {
      const el = await mount({ groups: [] }, { params: { kind: "hook", q: "boom", group: "agent" } });
      fire(btn(el, "Save view"), "click");
      expect(hasOpenModal()).toBe(true);
      const m = document.querySelector(".modal");
      expect(m.getAttribute("aria-label")).toBe("Save current filters as a view");
      expect(m.textContent).toContain("Saves group by agent, kind hook, search “boom”.");
      expect(timeouts.some((t) => t.live && t.ms === 0)).toBe(true);
    });
    test("the description omits unset filters", async () => {
      const el = await mount({ groups: [] });
      fire(btn(el, "Save view"), "click");
      expect(document.querySelector(".modal .pg-hint").textContent).toBe("Saves group by project.");
    });
    test("saving needs a name", async () => {
      const el = await mount({ groups: [] });
      fire(btn(el, "Save view"), "click");
      const m = document.querySelector(".modal");
      fire([...m.querySelectorAll("button")].find((b) => b.textContent === "Save view"), "click");
      await settle();
      expect(m.querySelector(".pg-field-error").textContent).toBe("Give the view a name.");
      expect(hasOpenModal()).toBe(true);
      expect(calls.some((c) => String(c[0]).startsWith("PUT"))).toBe(false);
    });
    test("saving puts the new view after the existing ones, closes the modal and toasts", async () => {
      const el = await mount({ groups: [] }, { prefs: { saved_views: [view("old", "Old")] }, params: { kind: "hook", q: "boom" } });
      answers.put = { state: { saved_views: [view("old", "Old"), view("n", "New")] } };
      fire(btn(el, "Save view"), "click");
      const m = document.querySelector(".modal");
      m.querySelector("#pg-view-name").value = "  New one  ";
      fire([...m.querySelectorAll("button")].find((b) => b.textContent === "Save view"), "click");
      await until(() => !hasOpenModal(), "modal closed");
      const put = calls.find((c) => c[0] === "PUT /api/v2/prefs");
      expect(put[1].saved_views).toHaveLength(2);
      expect(put[1].saved_views[0]).toEqual(view("old", "Old"));
      expect(put[1].saved_views[1]).toMatchObject({ name: "New one", page: "activity", params: { group: "project", kind: "hook", q: "boom" } });
      expect(put[1].saved_views[1].id).toMatch(/^v[0-9a-z]+$/);
      expect(ctx.stored.prefs).toEqual({ saved_views: [view("old", "Old"), view("n", "New")] });
      expect(toasts).toEqual([["Saved view “New one”", { kind: "ok" }]]);
    });
    test("Enter in the name box saves", async () => {
      const el = await mount({ groups: [] });
      fire(btn(el, "Save view"), "click");
      const input = document.querySelector("#pg-view-name");
      input.value = "Quick";
      const ev = fire(input, "keydown", { key: "Enter" });
      expect(ev.defaultPrevented).toBe(true);
      await until(() => calls.some((c) => c[0] === "PUT /api/v2/prefs"));
    });
    test("other keys do not save", async () => {
      const el = await mount({ groups: [] });
      fire(btn(el, "Save view"), "click");
      const input = document.querySelector("#pg-view-name");
      input.value = "Quick";
      fire(input, "keydown", { key: "a" });
      await settle();
      expect(calls.some((c) => String(c[0]).startsWith("PUT"))).toBe(false);
    });
    test("a failed save keeps the modal and shows the reason", async () => {
      const el = await mount({ groups: [] });
      answers.put = Object.assign(new Error("x"), { error: "Denied", why: "read only", do: "unlock" });
      fire(btn(el, "Save view"), "click");
      const m = document.querySelector(".modal");
      m.querySelector("#pg-view-name").value = "N";
      fire([...m.querySelectorAll("button")].find((b) => b.textContent === "Save view"), "click");
      await until(() => m.querySelector(".pg-field-error").textContent !== "");
      expect(m.querySelector(".pg-field-error").textContent).toBe("read only — unlock");
      expect(hasOpenModal()).toBe(true);
      answers.put = Object.assign(new Error("x"), { error: "Denied" });
      fire([...m.querySelectorAll("button")].find((b) => b.textContent === "Save view"), "click");
      await until(() => m.querySelector(".pg-field-error").textContent === "Denied");
    });
    test("Cancel closes the modal", async () => {
      const el = await mount({ groups: [] });
      fire(btn(el, "Save view"), "click");
      fire([...document.querySelector(".modal").querySelectorAll("button")].find((b) => b.textContent === "Cancel"), "click");
      expect(hasOpenModal()).toBe(false);
    });
    test("deleting asks first; yes removes only that view and toasts", async () => {
      const el = await mount({ groups: [] }, { prefs: { saved_views: [view("1", "Mine"), view("2", "Keep")] } });
      answers.put = { saved_views: [view("2", "Keep")] };
      fire(el.querySelector('[aria-label="Delete view Mine"]'), "click");
      const m = document.querySelector(".modal");
      expect(m.getAttribute("aria-label")).toBe("Delete view “Mine”?");
      expect(m.textContent).toContain("Only the saved filter set is removed.");
      fire([...m.querySelectorAll("button")].find((b) => b.textContent === "Confirm"), "click");
      await until(() => toasts.length === 1);
      expect(calls.find((c) => c[0] === "PUT /api/v2/prefs")[1]).toEqual({ saved_views: [view("2", "Keep")] });
      expect(toasts[0]).toEqual(["View deleted", { kind: "ok" }]);
    });
    test("declining the delete changes nothing", async () => {
      const el = await mount({ groups: [] }, { prefs: { saved_views: [view("1", "Mine")] } });
      fire(el.querySelector('[aria-label="Delete view Mine"]'), "click");
      fire([...document.querySelector(".modal").querySelectorAll("button")].find((b) => b.textContent === "Cancel"), "click");
      await settle();
      expect(calls.some((c) => String(c[0]).startsWith("PUT"))).toBe(false);
      expect(toasts).toEqual([]);
    });
    test("a failed delete toasts the title as a failure", async () => {
      const el = await mount({ groups: [] }, { prefs: { saved_views: [view("1", "Mine")] } });
      answers.put = Object.assign(new Error("x"), { error: "Nope" });
      fire(el.querySelector('[aria-label="Delete view Mine"]'), "click");
      fire([...document.querySelector(".modal").querySelectorAll("button")].find((b) => b.textContent === "Confirm"), "click");
      await until(() => toasts.length === 1);
      expect(toasts[0]).toEqual(["Nope", { kind: "fail" }]);
    });
  });

  describe("destroy", () => {
    test("stops the live timer, the visibility handler and a pending search; safe twice", async () => {
      const el = await mount({ groups: [group("a", [item("1")])] });
      fire(btn(el, "○ Live tail"), "click");
      await until(() => btn(el, "● Live"));
      const q = el.querySelector("#pg-act-q");
      q.value = "zzz";
      fire(q, "input", { target: q });
      page.destroy();
      expect(() => page.destroy()).not.toThrow();
      expect(intervals[0].live).toBe(false);
      expect(timeouts.filter((t) => t.live && t.ms === 400)).toHaveLength(0);
      expect(document.listenerCount("visibilitychange")).toBe(0);
      page.onEvent("tick");
      await settle();
      expect(calls).toHaveLength(1);
    });
    test("a read that finishes after destroy neither raises nor paints", async () => {
      const errors = [];
      const onErr = (e) => errors.push(e);
      process.on("unhandledRejection", onErr);
      try {
        const el = await mount({ groups: [group("a", [item("1")])] });
        let release;
        ctx.api.get = () => new Promise((r) => { release = r; });
        fire(btn(el, "Refresh"), "click");
        page.destroy();
        release({ groups: [] });
        await settle();
        expect(errors).toEqual([]);
        expect(rows(el)).toHaveLength(1);
      } finally { process.off("unhandledRejection", onErr); }
    });
    test("a tail that finishes after destroy neither raises nor paints", async () => {
      const errors = [];
      const onErr = (e) => errors.push(e);
      process.on("unhandledRejection", onErr);
      try {
        const el = await mount({ groups: [group("a", [item("1")])] });
        fire(btn(el, "○ Live tail"), "click");
        await until(() => btn(el, "● Live"));
        let release;
        ctx.api.get = () => new Promise((r) => { release = r; });
        intervals[0].fn();
        page.destroy();
        release({ groups: [group("a", [item("2")])] });
        await settle();
        expect(errors).toEqual([]);
        expect(titles(el)).toEqual(["Run 1"]);
      } finally { process.off("unhandledRejection", onErr); }
    });
    test("loading again resets filters from the new params", async () => {
      await mount({ groups: [] }, { params: { kind: "a" } });
      calls.length = 0;
      await mount({ groups: [] }, { params: {} });
      expect(calls[0][1]).toEqual({ group: "project", limit: 200 });
    });
  });
});
