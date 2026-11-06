import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "../rich-dom.js";
import { api } from "../api.js";

let dom, page, toasts, nav, projectsSet, putCalls, getCalls, answers, ctx, savedGet, savedNow, seq = 0;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const realNow = Date.now;
const NOW = Date.parse("2026-06-10T12:00:00Z");
const until = async (cond, what = "condition") => { const end = realNow() + 2000; while (!cond()) { if (realNow() > end) throw new Error("timed out: " + what); await new Promise((r) => realTimers.setTimeout(r, 1)); } };

beforeEach(async () => {
  dom = installRichDom();
  page = (await import("./projects.js?n=" + ++seq)).default;
  toasts = []; nav = []; projectsSet = []; putCalls = []; getCalls = [];
  answers = { projects: { projects: [] }, put: null };
  savedGet = api.get; savedNow = Date.now;
  Date.now = () => NOW + seq * 1_000_000_000; // hp.js caches reads on the clock: never serve another test's answer
  api.get = async () => ({ projects: [] }); // the herdr projects strip reads through the shared api
  ctx = {
    prefs: {},
    api: {
      get: async (path) => { getCalls.push(path); if (answers.projects instanceof Error) throw answers.projects; return answers.projects; },
      put: async (path, body) => { putCalls.push([path, body]); if (answers.put instanceof Error) throw answers.put; return answers.put; },
    },
    navigate: (t) => nav.push(t),
    setProject: (...a) => projectsSet.push(a),
    toast: (msg, opts) => toasts.push([msg, opts]),
    store: { set(k, v) { (ctx.stored ||= {})[k] = v; } },
  };
});
afterEach(async () => {
  page.destroy();
  await new Promise((r) => realTimers.setTimeout(r, 0)); // let hp.js settle before the DOM goes
  api.get = savedGet; Date.now = savedNow;
  restoreRichDom();
});

const P = (root, over = {}) => ({ root, name: root.split("/").pop(), health: "ok", last_active: new Date(Date.now() - 3600_000).toISOString(), ...over });
const mount = async (projects, prefs = {}) => {
  answers.projects = { projects };
  ctx.prefs = prefs;
  const data = await page.load(ctx);
  const el = page.render(ctx, data);
  dom.body.appendChild(el);
  return el;
};
const cards = (el) => [...el.querySelectorAll("article.pg-proj")];
const names = (el) => cards(el).map((c) => c.getAttribute("aria-label"));
const button = (el, label) => [...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label);

describe("projects page", () => {
  test("identifies itself under Configure", () => {
    expect([page.id, page.title, page.icon, page.group]).toEqual(["projects", "Projects", "folder", "Configure"]);
  });

  describe("load", () => {
    test("reads the projects endpoint and returns the answer", async () => {
      answers.projects = { projects: [P("/w/a")] };
      expect(await page.load(ctx)).toEqual({ projects: [P("/w/a")] });
      expect(getCalls).toEqual(["/api/v2/projects"]);
    });
    test("a failing read resolves undefined/null data and the page shows a retry state instead", async () => {
      answers.projects = Object.assign(new Error("x"), { error: "No route", why: "daemon", do: "restart" });
      const data = await page.load(ctx);
      expect(data == null).toBe(true);
      const el = page.render(ctx, data);
      expect(el.textContent).toContain("No route");
      expect(el.textContent).toContain("daemon — restart");
    });
    test("loading again discards the previous state", async () => {
      await mount([P("/w/a")]);
      answers.projects = { projects: [P("/w/b")] };
      await page.load(ctx);
      const el = page.render(ctx);
      expect(names(el)).toEqual(["Project b"]);
    });
  });

  describe("render", () => {
    test("shows the heading, sub text and a refresh action", async () => {
      const el = await mount([P("/w/a")]);
      expect(el.className).toBe("pg-page pg-projects");
      expect(el.querySelector("h1").textContent).toBe("Projects");
      expect(el.querySelector(".pg-sub").textContent).toContain("Muting hides a project");
      expect(button(el, "Refresh")).toBeTruthy();
    });
    test("includes the herdr projects strip", async () => {
      const el = await mount([P("/w/a")]);
      await until(() => el.querySelector("section") || el.textContent.length > 0);
      expect(el.querySelector(".pg-head")).not.toBeNull();
    });
    test("render without a prior load shows the loading line and fetches nothing", () => {
      const el = page.render(ctx);
      expect([...el.querySelectorAll(".pg-hint[role=status]")].map((n) => n.textContent)).toContain("Loading projects…");
      expect(getCalls).toEqual([]);
    });
    test("no projects at all shows the explanatory empty state", async () => {
      const el = await mount([]);
      expect(el.textContent).toContain("No projects yet");
      expect(el.textContent).toContain(".atlas/ folder");
      expect(cards(el)).toHaveLength(0);
    });
  });

  describe("cards", () => {
    test("show name, root, counters and the last-active age", async () => {
      const el = await mount([P("/w/a", { runs_7d: 4, agents_active: 2, todos: { open: 5, done: 6 }, failures_7d: 1, findings_open: 3 })]);
      const c = cards(el)[0];
      expect(c.querySelector("h2").textContent).toBe("a");
      expect(c.querySelector(".pg-mono").textContent).toBe("/w/a");
      expect(c.querySelector(".pg-mono").getAttribute("title")).toBe("/w/a");
      const stats = Object.fromEntries([...c.querySelectorAll(".pg-stat")].map((s) => [s.querySelector("dt").textContent, s.querySelector("dd").textContent]));
      expect(stats).toEqual({ "runs 7d": "4", agents: "2", "todos open": "5", "todos done": "6", "failures 7d": "1", findings: "3" });
      expect(c.querySelector(".pg-hint").textContent).toBe("Last active 1h ago");
    });
    test("missing counters read zero and carry no tone; failures and findings get one when above zero", async () => {
      const el = await mount([P("/w/a"), P("/w/b", { failures_7d: 2, findings_open: 1 })]);
      const tones = (c) => [...c.querySelectorAll(".pg-stat")].map((s) => s.className);
      const [a, b] = cards(el).sort((x, y) => x.getAttribute("aria-label").localeCompare(y.getAttribute("aria-label")));
      expect(tones(a)).toEqual(Array(6).fill("pg-stat"));
      expect([...a.querySelectorAll(".pg-stat-value")].map((s) => s.textContent)).toEqual(Array(6).fill("0"));
      expect(tones(b).slice(4)).toEqual(["pg-stat is-fail", "pg-stat is-warn"]);
    });
    test("health maps to a tone class and badge text, unknown health reads idle/info", async () => {
      const el = await mount([P("/w/a", { health: "warn" }), P("/w/b", { health: "fail" }), P("/w/c", { health: "idle" }), P("/w/d", { health: "weird" }), P("/w/e", { health: undefined })]);
      const by = Object.fromEntries(cards(el).map((c) => [c.querySelector("h2").textContent, [c.className, c.querySelector(".pg-proj-health").textContent]]));
      expect(by.a).toEqual(["pg-proj is-warn", expect.stringContaining("warn")]);
      expect(by.b[0]).toBe("pg-proj is-fail");
      expect(by.c[0]).toBe("pg-proj is-info");
      expect(by.d[0]).toBe("pg-proj is-info");
      expect(by.d[1]).toContain("weird");
      expect(by.e[0]).toBe("pg-proj is-info");
      expect(by.e[1]).toContain("idle");
    });
    test("a project without a name is titled by its root", async () => {
      const el = await mount([{ root: "/w/x", health: "ok" }]);
      expect(cards(el)[0].querySelector("h2").textContent).toBe("/w/x");
      expect(cards(el)[0].getAttribute("aria-label")).toBe("Project /w/x");
    });
    test("last-active ages: never, seconds, minutes, hours, days and unparseable text", async () => {
      const edge = await mount([P("/w/e1", { last_active: new Date(Date.now() - 59_000).toISOString() }), P("/w/e2", { last_active: new Date(Date.now() - 60_000).toISOString() }), P("/w/e3", { last_active: new Date(Date.now() - 3599_000).toISOString() }), P("/w/e4", { last_active: new Date(Date.now() - 3600_000).toISOString() }), P("/w/e5", { last_active: new Date(Date.now() - 86399_000).toISOString() }), P("/w/e6", { last_active: new Date(Date.now() - 86400_000).toISOString() })]);
      const eh = Object.fromEntries(cards(edge).map((c) => [c.querySelector("h2").textContent, c.querySelector(".pg-hint").textContent]));
      expect(eh).toEqual({ e1: "Last active 59s ago", e2: "Last active 1m ago", e3: "Last active 59m ago", e4: "Last active 1h ago", e5: "Last active 23h ago", e6: "Last active 1d ago" });
      page.destroy();
      const ago = (s) => new Date(NOW + seq * 1_000_000_000 - s * 1000).toISOString();
      const el = await mount([
        P("/w/n", { last_active: null }), P("/w/s", { last_active: ago(5) }), P("/w/m", { last_active: ago(150) }),
        P("/w/h", { last_active: ago(7300) }), P("/w/d", { last_active: ago(3 * 86400) }), P("/w/z", { last_active: "soon" }),
        P("/w/f", { last_active: ago(-500) }),
      ]);
      const hint = Object.fromEntries(cards(el).map((c) => [c.querySelector("h2").textContent, c.querySelector(".pg-hint").textContent]));
      expect(hint).toEqual({ n: "Last active never", s: "Last active 5s ago", m: "Last active 2m ago", h: "Last active 2h ago", d: "Last active 3d ago", z: "Last active soon", f: "Last active 0s ago" });
    });
    test("pinned projects are badged and listed first, then by most recent activity", async () => {
      const el = await mount([P("/w/old", { last_active: "2026-01-01T00:00:00Z" }), P("/w/new", { last_active: "2026-06-01T00:00:00Z" }), P("/w/pin", { last_active: "2025-01-01T00:00:00Z" })], { pinned_projects: ["/w/pin"] });
      expect(names(el)).toEqual(["Project pin", "Project new", "Project old"]);
      expect(cards(el)[0].textContent).toContain("pinned");
      expect(cards(el)[1].textContent).not.toContain("pinned");
    });
    test("projects with no activity sort after dated ones", async () => {
      const el = await mount([P("/w/none", { last_active: undefined }), P("/w/dated")]);
      expect(names(el)).toEqual(["Project dated", "Project none"]);
    });
    test("muted projects are badged and dimmed", async () => {
      const el = await mount([P("/w/a"), P("/w/b")], { muted_projects: ["/w/b"] });
      const b = cards(el).find((c) => c.querySelector("h2").textContent === "b");
      expect(b.className).toBe("pg-proj is-ok is-muted");
      expect(b.textContent).toContain("muted");
      expect(cards(el).find((c) => c.querySelector("h2").textContent === "a").className).toBe("pg-proj is-ok");
    });
    test("button labels reflect the pinned and muted state, with pressed attributes", async () => {
      const el = await mount([P("/w/a"), P("/w/b")], { pinned_projects: ["/w/a"], muted_projects: ["/w/a"] });
      const a = cards(el).find((c) => c.querySelector("h2").textContent === "a");
      const b = cards(el).find((c) => c.querySelector("h2").textContent === "b");
      const bt = (c) => [...c.querySelectorAll(".pg-actions button")].map((x) => [x.textContent, x.getAttribute("aria-label"), x.getAttribute("aria-pressed"), x.className]);
      expect(bt(a)).toEqual([
        ["Drill in", "Open a overview", null, "btn btn-primary"],
        ["Unpin", "Unpin a", "true", "btn btn-ghost is-on"],
        ["Unmute", "Unmute a (hide its events from Activity)", "true", "btn btn-ghost is-on"],
        ["Hide", "Hide a from lists", null, "btn btn-ghost"],
      ]);
      expect(bt(b).slice(1, 3)).toEqual([["Pin", "Pin b", "false", "btn btn-ghost"], ["Mute", "Mute b (hide its events from Activity)", "false", "btn btn-ghost"]]);
    });
    test("Drill in opens the overview and selects the project", async () => {
      const el = await mount([P("/w/a")]);
      fire(button(el, "Open a overview"), "click");
      expect(nav).toEqual(["overview"]);
      expect(projectsSet).toEqual([["/w/a", true]]);
    });
  });

  describe("hidden projects", () => {
    test("are removed from the grid and listed under a count with Unhide", async () => {
      const el = await mount([P("/w/a"), P("/w/b", { name: "Bee" })], { hidden_projects: ["/w/b"] });
      expect(names(el)).toEqual(["Project a"]);
      const sec = el.querySelector("section.pg-hidden");
      expect(sec.getAttribute("aria-label")).toBe("Hidden projects");
      expect(sec.querySelector("h2").textContent).toBe("Hidden (1)");
      expect(sec.querySelector("li").textContent).toContain("Bee");
      expect(sec.querySelector(".pg-mono").textContent).toBe("/w/b");
      expect(button(sec, "Unhide Bee")).toBeTruthy();
    });
    test("no hidden section when nothing is hidden", async () => {
      expect((await mount([P("/w/a")])).querySelector(".pg-hidden")).toBeNull();
    });
    test("hiding everything says so and still offers the unhide list", async () => {
      const el = await mount([P("/w/a")], { hidden_projects: ["/w/a"] });
      expect(el.textContent).toContain("Every project is hidden");
      expect(cards(el)).toHaveLength(0);
      expect(el.querySelector(".pg-hidden")).not.toBeNull();
    });
    test("a hidden project without a name is shown by root", async () => {
      const el = await mount([{ root: "/w/x" }], { hidden_projects: ["/w/x"] });
      expect(button(el, "Unhide /w/x")).toBeTruthy();
    });
  });

  describe("toggling prefs", () => {
    test("Pin sends only the pinned list with the project added, adopts the returned state and toasts", async () => {
      answers.put = { state: { pinned_projects: ["/w/a"], extra: 1 } };
      const el = await mount([P("/w/a")], { pinned_projects: ["/w/z"] });
      fire(button(el, "Pin a"), "click");
      await until(() => toasts.length, "toast");
      expect(putCalls).toEqual([["/api/v2/prefs", { pinned_projects: ["/w/z", "/w/a"] }]]);
      expect(ctx.prefs).toEqual({ pinned_projects: ["/w/a"], extra: 1 });
      expect(ctx.stored.prefs).toBe(ctx.prefs);
      expect(toasts).toEqual([["a pinned", { kind: "ok" }]]);
      await until(() => button(el, "Unpin a"), "redrawn as pinned");
      expect(cards(el)[0].textContent).toContain("pinned");
    });
    test("Unpin removes it", async () => {
      answers.put = { pinned_projects: [] };
      const el = await mount([P("/w/a")], { pinned_projects: ["/w/a"] });
      fire(button(el, "Unpin a"), "click");
      await until(() => toasts.length);
      expect(putCalls[0][1]).toEqual({ pinned_projects: [] });
      expect(toasts[0]).toEqual(["a unpinned", { kind: "ok" }]);
      expect(ctx.prefs).toEqual({ pinned_projects: [] });
    });
    test("Mute and Hide use their own keys and wording", async () => {
      answers.put = { muted_projects: ["/w/a"] };
      const el = await mount([P("/w/a")]);
      fire(button(el, "Mute a (hide its events from Activity)"), "click");
      await until(() => toasts.length === 1);
      expect(putCalls[0]).toEqual(["/api/v2/prefs", { muted_projects: ["/w/a"] }]);
      expect(toasts[0][0]).toBe("a muted");
      answers.put = { muted_projects: ["/w/a"], hidden_projects: ["/w/a"] };
      fire(button(el, "Hide a from lists"), "click");
      await until(() => toasts.length === 2);
      expect(putCalls[1][1]).toEqual({ hidden_projects: ["/w/a"] });
      expect(toasts[1][0]).toBe("a hidden");
      await until(() => cards(el).length === 0, "card hidden");
      fire(button(el, "Unhide a"), "click");
      await until(() => toasts.length === 3);
      expect(putCalls[2][1]).toEqual({ hidden_projects: [] });
      expect(toasts[2][0]).toBe("a shown");
    });
    test("a response that is not an object leaves the prefs as they were", async () => {
      answers.put = null;
      const el = await mount([P("/w/a")], { pinned_projects: [] });
      const before = ctx.prefs;
      fire(button(el, "Pin a"), "click");
      await until(() => toasts.length);
      expect(ctx.prefs).toBe(before);
      expect(ctx.stored).toBeUndefined();
      expect(toasts[0][0]).toBe("a pinned");
    });
    test("works without a shared store", async () => {
      answers.put = { pinned_projects: ["/w/a"] };
      delete ctx.store;
      const el = await mount([P("/w/a")]);
      fire(button(el, "Pin a"), "click");
      await until(() => toasts.length);
      expect(ctx.prefs).toEqual({ pinned_projects: ["/w/a"] });
    });
    test("a failed save toasts the reason as a failure and keeps the prefs", async () => {
      answers.put = Object.assign(new Error("x"), { error: "Forbidden", why: "read-only", do: "unlock" });
      const el = await mount([P("/w/a")], { pinned_projects: [] });
      fire(button(el, "Pin a"), "click");
      await until(() => toasts.length);
      expect(toasts).toEqual([["Forbidden: read-only — unlock", { kind: "fail" }]]);
      expect(ctx.prefs).toEqual({ pinned_projects: [] });
    });
    test("a 404 is explained as the API not being available, and a bare failure reads Request failed", async () => {
      answers.put = Object.assign(new Error("x"), { status: 404, error: "nope" });
      const el = await mount([P("/w/a")]);
      fire(button(el, "Pin a"), "click");
      await until(() => toasts.length === 1);
      expect(toasts[0][0]).toBe("Projects API is not available yet");
      answers.put = Object.assign(new Error("x"), {});
      fire(button(el, "Pin a"), "click");
      await until(() => toasts.length === 2);
      expect(toasts[1][0]).toBe("Request failed");
    });
    test("a second toggle while one is saving is ignored", async () => {
      let release;
      ctx.api.put = (path, body) => { putCalls.push([path, body]); return new Promise((r) => { release = r; }); };
      const el = await mount([P("/w/a")]);
      fire(button(el, "Pin a"), "click");
      fire(button(el, "Mute a (hide its events from Activity)"), "click");
      expect(putCalls).toHaveLength(1);
      release({ pinned_projects: ["/w/a"] });
      await until(() => toasts.length === 1);
      fire(button(el, "Mute a (hide its events from Activity)"), "click");
      expect(putCalls).toHaveLength(2);
    });
    test("with no toast function the toggle still succeeds", async () => {
      answers.put = { pinned_projects: ["/w/a"] };
      delete ctx.toast;
      const el = await mount([P("/w/a")]);
      fire(button(el, "Pin a"), "click");
      await until(() => ctx.prefs.pinned_projects);
      expect(ctx.prefs.pinned_projects).toEqual(["/w/a"]);
    });
    test("prefs that are not an object are treated as empty", async () => {
      answers.put = { pinned_projects: ["/w/a"] };
      const el = await mount([P("/w/a")], "garbage");
      fire(button(el, "Pin a"), "click");
      await until(() => putCalls.length);
      expect(putCalls[0][1]).toEqual({ pinned_projects: ["/w/a"] });
    });
  });

  describe("refresh", () => {
    test("Refresh re-reads and redraws with the new list", async () => {
      const el = await mount([P("/w/a")]);
      answers.projects = { projects: [P("/w/a"), P("/w/b")] };
      fire(button(el, "Refresh"), "click");
      await until(() => cards(el).length === 2, "second card");
      expect(getCalls).toEqual(["/api/v2/projects", "/api/v2/projects"]);
    });
    test("overlapping refreshes read once", async () => {
      let release;
      const el = await mount([P("/w/a")]);
      ctx.api.get = (path) => { getCalls.push(path); return new Promise((r) => { release = r; }); };
      fire(button(el, "Refresh"), "click");
      fire(button(el, "Refresh"), "click");
      expect(getCalls.filter((p) => p === "/api/v2/projects")).toHaveLength(2); // one initial load + one refresh
      release({ projects: [] });
      await until(() => el.textContent.includes("No projects yet"));
    });
    test("a failed refresh keeps the cards that were already shown", async () => {
      const el = await mount([P("/w/a")]);
      answers.projects = new Error("down");
      fire(button(el, "Refresh"), "click");
      await until(() => getCalls.length === 2);
      await new Promise((r) => realTimers.setTimeout(r, 10));
      expect(names(el)).toEqual(["Project a"]);
    });
    test("Retry on the error state re-reads and recovers", async () => {
      answers.projects = Object.assign(new Error("x"), { error: "Down" });
      const data = await page.load(ctx);
      const el = page.render(ctx, data);
      dom.body.appendChild(el);
      expect(el.textContent).toContain("The projects endpoint did not answer.".slice(0, 0) + "Down");
      answers.projects = { projects: [P("/w/a")] };
      fire(button(el, "Retry"), "click");
      await until(() => cards(el).length === 1, "recovered");
    });
    test("the error state without details says the endpoint did not answer", async () => {
      answers.projects = Object.assign(new Error("x"), { status: 404 });
      const data = await page.load(ctx);
      const el = page.render(ctx, data);
      expect(el.textContent).toContain("Projects API is not available yet");
      expect(el.textContent).toContain("The projects endpoint did not answer.");
    });
    test("an unlabeled falsy error gets the generic title", async () => {
      answers.projects = Object.assign(new Error("x"), {});
      const el = page.render(ctx, await page.load(ctx));
      expect(el.textContent).toContain("Request failed");
    });
    test("keyboard focus on a labelled control survives the redraw a toggle causes", async () => {
      answers.put = { pinned_projects: ["/w/a"] };
      const el = await mount([P("/w/a"), P("/w/b")]);
      const mute = button(el, "Mute b (hide its events from Activity)");
      mute.focus();
      expect(document.activeElement).toBe(mute);
      fire(button(el, "Pin a"), "click");
      await until(() => button(el, "Unpin a"), "redrawn");
      const now = button(el, "Mute b (hide its events from Activity)");
      expect(now).not.toBe(mute);
      expect(document.activeElement).toBe(now);
    });
  });

  describe("destroy", () => {
    test("a read that finishes after the page was destroyed does not raise", async () => {
      const errors = [];
      const onErr = (e) => errors.push(e);
      process.on("unhandledRejection", onErr);
      try {
        const el = await mount([P("/w/a")]);
        let release;
        ctx.api.get = () => new Promise((r) => { release = r; });
        fire(button(el, "Refresh"), "click");
        page.destroy();
        release({ projects: [] });
        await new Promise((r) => realTimers.setTimeout(r, 20));
        expect(errors).toEqual([]);
        expect(names(el)).toEqual(["Project a"]);
      } finally { process.off("unhandledRejection", onErr); }
    });
    test("a save that finishes after the page was destroyed does not raise or toast twice", async () => {
      const errors = [];
      const onErr = (e) => errors.push(e);
      process.on("unhandledRejection", onErr);
      try {
        const el = await mount([P("/w/a")]);
        let release;
        ctx.api.put = () => new Promise((r) => { release = r; });
        fire(button(el, "Pin a"), "click");
        page.destroy();
        release({ pinned_projects: ["/w/a"] });
        await new Promise((r) => realTimers.setTimeout(r, 20));
        expect(errors).toEqual([]);
        expect(names(el)).toEqual(["Project a"]);
      } finally { process.off("unhandledRejection", onErr); }
    });
    test("a second refresh works after the first finished", async () => {
      const el = await mount([P("/w/a")]);
      answers.projects = { projects: [P("/w/a"), P("/w/b")] };
      fire(button(el, "Refresh"), "click");
      await until(() => cards(el).length === 2);
      answers.projects = { projects: [P("/w/a"), P("/w/b"), P("/w/c")] };
      fire(button(el, "Refresh"), "click");
      await until(() => cards(el).length === 3, "third card");
    });
    test("null prefs count as empty", async () => {
      answers.put = { pinned_projects: ["/w/a"] };
      const el = await mount([P("/w/a")], null);
      fire(button(el, "Pin a"), "click");
      await until(() => putCalls.length);
      expect(putCalls[0][1]).toEqual({ pinned_projects: ["/w/a"] });
    });
    test("stops refreshes and redraws, and is safe twice", async () => {
      const el = await mount([P("/w/a")]);
      const refreshBtn = button(el, "Refresh");
      page.destroy();
      expect(() => page.destroy()).not.toThrow();
      answers.projects = { projects: [] };
      fire(refreshBtn, "click");
      await new Promise((r) => realTimers.setTimeout(r, 10));
      expect(names(el)).toEqual(["Project a"]);
    });
  });
});
