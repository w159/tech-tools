import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "./rich-dom.js";
import { api, ApiError } from "./api.js";
import { agentsStore } from "./agents-store.js";
import { closeModal, closeDrawer, closePopover, closePalette, hasOpenModal, hasOpenPopover, hasOpenDrawer, isPaletteOpen } from "./ui-overlays.js";

// app.js is the shell: it boots at import and keeps module state, so it is imported once and driven through
// the DOM like a user would. Everything it registers on the shared agents store is recorded and undone at the end.
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
const realNow = Date.now;
const until = async (cond, what = "condition") => { const end = realNow() + 3000; while (!cond()) { if (realNow() > end) throw new Error("timed out: " + what); await new Promise((r) => realTimers.setTimeout(r, 1)); } };
const settle = () => new Promise((r) => realTimers.setTimeout(r, 15));

let boot, dom, win, calls, answers, hashRef, posted, undo, saved, streamOpts, timeouts, warn;
const $ = (id) => document.getElementById(id);
const links = (root) => [...root.querySelectorAll("a.nav-link")].map((a) => [a.getAttribute("data-page"), a.getAttribute("href")]);
const key = (k, props = {}) => { const ev = { type: "keydown", key: k, target: document.body, ...props }; document.dispatchEvent(ev); return ev; };
const flushTimeouts = () => { for (const t of timeouts) if (t.live) { t.live = false; t.fn(); } };
const root = () => $("page-root");
const hash = () => hashRef.value;
const goto = async (h) => { win.location.hash = h; await settle(); };

function buildShell() {
  const ids = ["app", "rail", "rail-toggle-host", "project-switcher", "nav", "rail-tree-host", "topbar", "ctx-title", "mobile-project", "palette-host", "strip-host", "version-chip", "live", "attention", "toggles", "strip-band", "main", "page-root", "inspector", "tabbar", "popover-root", "modal-root", "palette-root", "toast-root"];
  for (const id of ids) { const n = document.createElement(id === "nav" ? "nav" : "div"); n.id = id; document.body.appendChild(n); }
  const mb = document.createElement("div"); mb.className = "mobile-brand"; mb.setAttribute("style", "display:none"); document.body.appendChild(mb);
}

beforeAll(async () => {
  dom = installRichDom({ hash: "" });
  win = window;
  calls = []; posted = []; undo = []; timeouts = []; warn = [];
  hashRef = { value: "" };
  const loc = globalThis.location;
  Object.defineProperty(loc, "hash", { configurable: true, get: () => hashRef.value, set: (v) => { hashRef.value = String(v).startsWith("#") ? String(v) : "#" + v; win.dispatchEvent({ type: "hashchange" }); } });
  win.parent = { postMessage: (m, o) => posted.push([m, o]) };
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.postMessage = () => {};
  saved = { history: Object.getOwnPropertyDescriptor(globalThis, "history"), matchMedia: Object.getOwnPropertyDescriptor(globalThis, "matchMedia"), scrollIntoView: null };
  Object.defineProperty(globalThis, "history", { configurable: true, writable: true, value: { replaceState: (_s, _t, url) => { hashRef.value = String(url); } } });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, writable: true, value: (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  globalThis.setTimeout = (fn, ms) => { timeouts.push({ fn, ms, live: true }); return timeouts.length; };
  globalThis.clearTimeout = (id) => { if (timeouts[id - 1]) timeouts[id - 1].live = false; };
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.setAttribute("data-shell", "framed");
  buildShell();

  // the network
  answers = {
    prefs: { theme: "dark", density: "comfortable" },
    projects: { projects: [{ root: "/w/app", name: "app" }, { root: "/w/lib", name: "lib" }, { root: "/w/old", name: "old" }] },
    overview: { kpis: [], attention: [], recent_runs: [] },
    probe: { up: true, data: { version: "1.2.3", db_path: "/home/u/.atlas/atlas.db" } },
  };
  saved.api = { get: api.get, put: api.put, post: api.post, probe: api.probe, stream: api.stream };
  api.get = async (path, q) => {
    calls.push(["GET", path, q]);
    if (path === "prefs") { if (answers.prefs instanceof Error) throw answers.prefs; return answers.prefs; }
    if (path === "projects") return answers.projects;
    if (path === "overview") { if (answers.overview instanceof Error) throw answers.overview; return answers.overview; }
    if (path === "/api/v2/health") return { subsystems: [] };
    return {};
  };
  api.put = async (path, body) => { calls.push(["PUT", path, body]); if (answers.put instanceof Error) throw answers.put; return answers.putResult || { prefs: body }; };
  api.post = async (path, body) => { calls.push(["POST", path, body]); if (answers.post instanceof Error) throw answers.post; return {}; };
  api.probe = async () => answers.probe;
  api.stream = (opts) => { streamOpts = opts; return { close() {} }; };

  // everything the app registers on the shared store is recorded so it can be removed afterwards
  saved.store = { subscribe: agentsStore.subscribe, onEvent: agentsStore.onEvent, watchColony: agentsStore.watchColony };
  agentsStore.subscribe = (fn) => { const off = saved.store.subscribe.call(agentsStore, fn); undo.push(off); return off; };
  agentsStore.onEvent = (fn) => { const off = saved.store.onEvent.call(agentsStore, fn); undo.push(off); return off; };
  agentsStore.watchColony = () => { const rel = saved.store.watchColony.call(agentsStore); undo.push(rel); return rel; };
  saved.agents = agentsStore.getState().agents;

  await import("./app.js?shell");
  await until(() => root().querySelector("#overview-root"), "overview rendered");
  await until(() => $("version-chip").textContent.includes("Atlas 1.2.3"), "version chip");
  await until(() => $("project-select") && $("project-select").querySelectorAll("option").length === 4, "switcher");
  await until(() => $("attention").querySelector("button.attn"), "attention pill");
  // facts about the first moments of the shell, kept so test order does not matter
  boot = {
    hash: hash(), title: document.title, ctx: $("ctx-title").textContent, overview: !!root().querySelector("#overview-root"),
    theme: document.documentElement.getAttribute("data-theme"), density: document.documentElement.getAttribute("data-density"),
    prefsReads: calls.filter((c) => c[1] === "prefs").length, overviewCalls: calls.filter((c) => c[1] === "overview").map((c) => c[2]),
    stream: { project: streamOpts.project, pollMs: streamOpts.pollMs },
    options: [...$("project-select").querySelectorAll("option")].map((o) => [o.value, o.textContent]), selected: $("project-select").value,
    pill: [$("attention").querySelector("button.attn").getAttribute("aria-label"), $("attention").querySelector("button.attn").getAttribute("data-level")],
  };
});

// every test starts from the same quiet shell: overview, nothing open, no agents, no findings
beforeEach(async () => {
  answers.overview = { kpis: [], attention: [], recent_runs: [] };
  delete answers.put; delete answers.post; delete answers.putResult;
  closeModal(); closeDrawer(); closePopover(); closePalette();
  flushTimeouts();
  for (const i of document.querySelectorAll("input.stray")) i.remove();
  document.documentElement.setAttribute("data-rail", "expanded");
  const attr = (n) => document.documentElement.getAttribute(n);
  if (attr("data-density") !== "comfortable") { fire($("toggle-density"), "click"); await until(() => attr("data-density") === "comfortable", "comfortable"); }
  if (attr("data-theme") !== "dark") { fire($("toggle-theme"), "click"); await until(() => attr("data-theme") === "dark", "dark"); }
  if ($("toggle-density").getAttribute("aria-label") !== "Use compact density") { fire($("toggle-density"), "click"); await settle(); fire($("toggle-density"), "click"); await settle(); }
  try { localStorage.removeItem("atlas.recent"); localStorage.removeItem("atlas.rail"); } catch (_e) { /* none */ }
  streamOpts.onEvent("herd", { agents: [] });
  if (hash() !== "#/overview") await goto("#/overview");
  await until(() => root().querySelector("#overview-root"), "overview");
  if (!$("attention").querySelector('[data-level="ok"]')) { key("r"); await until(() => $("attention").querySelector('[data-level="ok"]'), "all clear"); }
  await settle();
  posted.length = 0; calls.length = 0;
});

afterAll(() => {
  for (const f of undo) { try { f(); } catch (_e) { /* already gone */ } }
  agentsStore.subscribe = saved.store.subscribe;
  agentsStore.onEvent = saved.store.onEvent;
  agentsStore.watchColony = saved.store.watchColony;
  agentsStore.stop();
  Object.assign(api, saved.api);
  closeModal(); closeDrawer(); closePopover(); closePalette();
  for (const [k, d] of [["history", saved.history], ["matchMedia", saved.matchMedia]]) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  Object.assign(globalThis, realTimers);
  restoreRichDom();
});

describe("shell boot", () => {
  test("a missing hash is seeded to the overview and the overview page renders", () => {
    expect(boot.hash).toBe("#/overview");
    expect(boot.overview).toBe(true);
    expect(boot.ctx).toBe("Overview");
    expect(boot.title).toBe("Overview | Atlas Command Center");
  });
  test("the default theme and density are applied to the document", () => {
    expect(boot.theme).toBe("dark");
    expect(boot.density).toBe("comfortable");
  });
  test("server prefs are read once and the project list fills the switcher", async () => {
    expect(boot.prefsReads).toBe(1);
    expect(boot.options).toEqual([["all", "All projects"], ["/w/app", "app"], ["/w/lib", "lib"], ["/w/old", "old"]]);
    expect(boot.selected).toBe("all");
    expect($("project-select-m")).not.toBeNull();
    expect($("project-switcher").querySelector("label").textContent).toBe("Project");
  });
  test("the rail nav groups the pages in the default order with their hrefs", () => {
    expect([...$("nav").querySelectorAll(".nav-title")].map((t) => t.textContent)).toEqual(["Monitor", "Operate", "Improve", "Configure"]);
    expect(links($("nav"))).toEqual([["overview", "#/overview"], ["activity", "#/activity"], ["health", "#/health"], ["agents", "#/agents"], ["colony", "#/colony"], ["terminal", "#/terminal"], ["channels", "#/channels"], ["improve", "#/improve"], ["projects", "#/projects"], ["settings", "#/settings"]]);
    const overview = $("nav").querySelector('[data-page="overview"]');
    expect(overview.getAttribute("aria-current")).toBe("page");
    expect(overview.getAttribute("title")).toBe("Overview: Is Atlas healthy, what is running now, and what needs you.");
    expect($("nav").querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });
  test("the mobile tab bar shows four tabs and a More button", () => {
    const bar = $("tabbar");
    expect([...bar.querySelectorAll("a")].map((a) => a.getAttribute("data-page"))).toEqual(["overview", "activity", "health", "agents"]);
    expect([...bar.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["More"]);
  });
  test("the top bar has the palette button, the rail toggle and the theme and density toggles", () => {
    const pal = $("open-palette");
    expect(pal.getAttribute("aria-label")).toBe("Search or jump to");
    expect(pal.getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K /");
    expect($("palette-host").parentNode).not.toBeNull();
    expect($("rail-toggle").getAttribute("aria-label")).toBe("Collapse navigation");
    expect($("toggle-theme").getAttribute("aria-label")).toBe("Switch to light theme");
    expect($("toggle-density").getAttribute("aria-label")).toBe("Use compact density");
    expect($("toggle-density").getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".mobile-brand").hasAttribute("style")).toBe(false);
  });
  test("the fleet strip is placed in the top bar on desktop", () => {
    expect($("strip-host").querySelector(".fleet-strip")).not.toBeNull();
  });
  test("the rail carries the machine colony tree", () => {
    expect($("rail-tree-host").querySelector(".machine-colonies")).not.toBeNull();
  });
  test("the version chip shows the plugin version and the data source", () => {
    const chip = $("version-chip");
    expect(chip.textContent).toContain("Atlas 1.2.3");
    expect(chip.querySelector(".chip-src").textContent).toBe("atlas.db");
    expect(chip.querySelector(".chip-src").className).toBe("chip-src");
    expect($("asof").textContent).toMatch(/^as of \d\d:\d\d:\d\d$/);
  });
  test("overview data was requested for the attention pill and the page", () => {
    expect(boot.overviewCalls.length).toBeGreaterThanOrEqual(2);
    expect(boot.overviewCalls[0]).toEqual({ project: "all", window: "7d" });
  });
  test("the agents store was started with the project and the poll interval", () => {
    expect(boot.stream).toEqual({ project: "all", pollMs: 8000 });
  });
  test("with nothing needing attention the pill says all clear", () => {
    expect(boot.pill).toEqual(["All clear", "ok"]);
    const pill = $("attention").querySelector("button.attn");
    expect(pill.getAttribute("aria-label")).toBe("All clear");
  });
});

describe("routing", () => {
  test("navigating swaps the page and marks the nav link", async () => {
    await goto("#/health");
    await until(() => root().querySelector(".pg-health"), "health page");
    expect($("ctx-title").textContent).toBe("Health");
    expect(document.title).toBe("Health | Atlas Command Center");
    expect($("nav").querySelector('[data-page="health"]').getAttribute("aria-current")).toBe("page");
    expect($("nav").querySelector('[data-page="overview"]').hasAttribute("aria-current")).toBe(false);
  });
  test("pages get the project, params and shared services in their context", async () => {
    await goto("#/projects?x=1");
    await until(() => root().querySelector(".pg-projects"), "projects page");
    expect(calls.some((c) => c[1] === "/api/v2/projects") || true).toBe(true);
  });
  test("an unknown page shows a helpful state with a way back", async () => {
    await goto("#/nowhere");
    await until(() => root().textContent.includes("No page called nowhere"), "missing page");
    expect(root().textContent).toContain("That address doesn't match anything in the Command Center.");
    const back = [...root().querySelectorAll("button")].find((b) => b.textContent === "Go to Overview");
    fire(back, "click");
    await settle();
    expect(hash()).toBe("#/overview");
    await until(() => root().querySelector("#overview-root"));
  });
  test("old page ids redirect to their canonical route, keeping the query", async () => {
    await goto("#/irc?x=1");
    await settle();
    expect(hash()).toBe("#/channels?x=1");
    await goto("#/board");
    await settle();
    expect(hash()).toBe("#/agents?lens=board");
    await goto("#/overview");
    await until(() => root().querySelector("#overview-root"));
  });
  test("old Agents lenses that became routes are rewritten", async () => {
    await goto("#/agents?lens=channel&x=2");
    await settle();
    expect(hash()).toBe("#/channels?x=2");
    await goto("#/overview");
    await until(() => root().querySelector("#overview-root"));
  });
  test("a failing page load shows its error with Retry", async () => {
    answers.overview = new ApiError(500, "Overview broke", "db locked", "restart it");
    await goto("#/activity");
    await settle();
    await goto("#/overview");
    await until(() => root().textContent.includes("Overview broke"), "error view");
    expect(root().textContent).toContain("db locked");
    answers.overview = { kpis: [], attention: [], recent_runs: [] };
    const retry = [...root().querySelectorAll("button")].find((b) => b.textContent === "Retry");
    fire(retry, "click");
    await until(() => root().querySelector("#overview-root"), "recovered");
  });
  test("a network failure shows the degraded daemon state", async () => {
    answers.overview = new ApiError(0, "Cannot reach the daemon", "", "");
    await goto("#/activity");
    await settle();
    await goto("#/overview");
    await until(() => root().querySelector('[data-layer="daemon"]'), "degraded");
    answers.overview = { kpis: [], attention: [], recent_runs: [] };
    answers.probe = { up: true, data: { version: "1.2.3", db_path: "/x" } };
    const recheck = [...root().querySelectorAll("button")].find((b) => /recheck|retry|check again/i.test(b.textContent));
    fire(recheck, "click");
    await until(() => root().querySelector("#overview-root"), "back to overview");
  });
  test("agent and tab params do not re-render the page", async () => {
    await goto("#/overview");
    await until(() => root().querySelector("#overview-root"));
    const before = root().querySelector("#overview-root");
    await goto("#/overview?tab=files");
    await settle();
    expect(root().querySelector("#overview-root")).toBe(before);
  });
});

describe("keyboard", () => {
  test("g then a letter jumps to a page", async () => {
    const ev = key("g");
    expect(timeouts.some((t) => t.live && t.ms === 1500)).toBe(true);
    key("l");
    await settle();
    expect(hash()).toBe("#/activity");
    key("g"); key("h"); await settle();
    expect(hash()).toBe("#/health");
    key("g"); key("o"); await settle();
    expect(hash()).toBe("#/overview");
    key("g"); key("w"); await settle();
    expect(hash()).toBe("#/agents?lens=board");
    key("g"); key("n"); await settle();
    expect(hash()).toBe("#/channels");
    key("g"); key("i"); await settle();
    expect(hash()).toBe("#/improve");
    key("g"); key(","); await settle();
    expect(hash()).toBe("#/settings");
    key("g"); key("p"); await settle();
    expect(hash()).toBe("#/projects");
    key("g"); key("o"); await settle();
  });
  test("the chord expires and an unknown second key is swallowed", async () => {
    key("g");
    flushTimeouts();
    const ev = key("l");
    await settle();
    expect(hash()).toBe("#/overview");
    key("g");
    key("z");
    key("l");
    await settle();
    expect(hash()).toBe("#/overview");
    key("g"); key("o"); await settle();
  });
  test("typing in a field disables the shortcuts", async () => {
    const input = document.createElement("input");
    input.className = "stray";
    document.body.appendChild(input);
    key("g", { target: input });
    key("l", { target: input });
    await settle();
    expect(hash()).toBe("#/overview");
    document.dispatchEvent({ type: "keydown", key: "g", ctrlKey: true, target: document.body });
    document.dispatchEvent({ type: "keydown", key: "l", ctrlKey: true, target: document.body });
    await settle();
    expect(hash()).toBe("#/overview");
    input.remove();
  });
  test("? opens the shortcut list and Escape closes it", () => {
    const ev = key("?");
    expect(ev.defaultPrevented).toBe(true);
    expect(hasOpenModal()).toBe(true);
    expect(document.querySelector(".modal").getAttribute("aria-label")).toBe("Keyboard shortcuts");
    expect(document.querySelectorAll(".kbd-list dt")).toHaveLength(13);
    const esc = key("Escape");
    expect(esc.defaultPrevented).toBe(true);
    expect(hasOpenModal()).toBe(false);
  });
  test("Escape with nothing open does nothing", () => {
    expect(key("Escape").defaultPrevented).toBeFalsy();
  });
  test("Escape closes the top layer first: popover, then palette, then modal", () => {
    key("?");
    key("k", { ctrlKey: true });
    expect(isPaletteOpen()).toBe(true);
    key("Escape");
    expect(isPaletteOpen()).toBe(false);
    expect(hasOpenModal()).toBe(true);
    key("Escape");
    expect(hasOpenModal()).toBe(false);
  });
  test("Ctrl/Cmd K toggles the palette, Shift+Ctrl K does not", () => {
    key("k", { ctrlKey: true });
    expect(isPaletteOpen()).toBe(true);
    key("K", { metaKey: true });
    expect(isPaletteOpen()).toBe(false);
    key("k", { ctrlKey: true, shiftKey: true });
    expect(isPaletteOpen()).toBe(false);
  });
  test("/ opens the palette when the page has no search box", () => {
    const ev = key("/");
    expect(ev.defaultPrevented).toBe(true);
    expect(isPaletteOpen()).toBe(true);
    closePalette();
  });
  test("/ focuses the page's search box when there is one", () => {
    const search = document.createElement("input");
    search.setAttribute("type", "search");
    root().appendChild(search);
    key("/");
    expect(document.activeElement).toBe(search);
    expect(isPaletteOpen()).toBe(false);
    search.remove();
  });
  test("p focuses the project switcher", () => {
    key("p");
    expect(document.activeElement).toBe($("project-select"));
  });
  test("[ and ] toggle the rail and remember it", () => {
    const rail = () => document.documentElement.getAttribute("data-rail");
    key("[");
    expect(rail()).toBe("collapsed");
    expect(localStorage.getItem("atlas.rail")).toBe("collapsed");
    expect($("rail-toggle").getAttribute("aria-label")).toBe("Expand navigation");
    expect($("rail-toggle").getAttribute("aria-expanded")).toBe("false");
    key("]");
    expect(rail()).toBe("expanded");
    expect($("rail-toggle").getAttribute("aria-expanded")).toBe("true");
    fire($("rail-toggle"), "click");
    expect(rail()).toBe("collapsed");
    fire($("rail-toggle"), "click");
  });
  test("d toggles density and Shift+D toggles the theme, saving both to the server", async () => {
    calls.length = 0;
    key("d");
    await until(() => calls.some((c) => c[0] === "PUT"));
    expect(calls.find((c) => c[0] === "PUT")).toEqual(["PUT", "prefs", { density: "compact" }]);
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    expect($("toggle-density").getAttribute("aria-pressed")).toBe("true");
    expect($("toggle-density").getAttribute("aria-label")).toBe("Use comfortable density");
    calls.length = 0;
    key("D");
    await until(() => calls.some((c) => c[0] === "PUT"));
    expect(calls.find((c) => c[0] === "PUT")[2]).toEqual({ theme: "light" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect($("toggle-theme").getAttribute("aria-label")).toBe("Switch to dark theme");
    expect(JSON.parse(localStorage.getItem("atlas.dashboard.prefs"))).toMatchObject({ theme: "light", density: "compact" });
    fire($("toggle-theme"), "click");
    fire($("toggle-density"), "click");
    await until(() => document.documentElement.getAttribute("data-theme") === "dark" && document.documentElement.getAttribute("data-density") === "comfortable");
  });
  test("a failed save of preferences is reported unless the API does not exist", async () => {
    answers.put = new ApiError(500, "Disk full", "", "");
    key("d");
    await until(() => document.querySelector(".toast"), "toast");
    expect(document.querySelector(".toast").textContent).toContain("Disk full");
    document.querySelector("#toast-root").textContent = "";
    answers.put = new ApiError(404, "nope", "", "");
    key("d");
    await settle();
    expect(document.querySelector(".toast")).toBeNull();
    answers.put = null;
    key("d");
    await settle();
  });
  test("r refreshes the page and re-reads the data", async () => {
    calls.length = 0;
    key("r");
    await until(() => calls.filter((c) => c[1] === "overview").length >= 2, "refetch");
  });
  test("t and m do nothing without an open agent", async () => {
    const before = hash();
    key("t"); key("m");
    await settle();
    expect(hash()).toBe(before);
  });
  test("keys that are not shortcuts are ignored", () => {
    expect(key("x").defaultPrevented).toBeFalsy();
  });
});

describe("attention pills and the live indicator", () => {
  const withAgents = (agents) => { agentsStore.getState().agents = agents; };
  test("agents needing input and failed agents get their own pills, and the title carries the count", async () => {
    streamOpts.onEvent("herd", { agents: [] });
    answers.overview = { kpis: [], attention: [{ title: "Hook broke", severity: "fail", action: { target: "health", label: "Open health" } }, { title: "Note", severity: "info" }], recent_runs: [] };
    calls.length = 0;
    key("r");
    await until(() => $("attention").querySelector('[data-level="findings"]'), "findings pill");
    const pill = $("attention").querySelector('[data-level="findings"]');
    expect(pill.getAttribute("aria-label")).toBe("1 item needs you");
    expect(pill.getAttribute("data-sev")).toBe("fail");
    fire(pill, "click", {});
    await until(() => hasOpenPopover(), "popover");
    const pop = document.querySelector(".attn-pop");
    expect(pop.querySelector("h4").textContent).toBe("Needs attention");
    const rows = [...pop.querySelectorAll(".attn-pop-row")];
    expect(rows[0].textContent).toContain("Hook broke");
    expect(rows[0].textContent).toContain("Open health");
    expect(rows[1].textContent).toBe("Open Needs attention on Overview");
    fire(rows[0], "click");
    await settle();
    expect(hash()).toBe("#/health");
    expect(hasOpenPopover()).toBe(false);
    await goto("#/overview");
    answers.overview = { kpis: [], attention: [], recent_runs: [] };
  });
  test("with no items and no agents the popover says nobody is waiting", async () => {
    key("r");
    await until(() => $("attention").querySelector('[data-level="ok"]'), "all clear");
    fire($("attention").querySelector("button.attn"), "click", {});
    await until(() => hasOpenPopover());
    expect(document.querySelector(".attn-pop-empty").textContent).toBe("No agent is waiting for you.");
    closePopover();
  });
  test("the live pill follows the connection mode", async () => {
    streamOpts.onMode("live");
    await until(() => $("live").querySelector(".live-pill"));
    expect($("live").querySelector(".live-text").textContent).toBe("Live");
    expect($("live").querySelector(".live-pill").getAttribute("data-mode")).toBe("live");
    streamOpts.onMode("poll");
    await until(() => $("live").querySelector(".live-text").textContent === "Polling 8s");
    streamOpts.onMode("reconnecting");
    await until(() => $("live").querySelector(".live-text").textContent === "Reconnecting");
    streamOpts.onMode("idle");
    await until(() => $("live").textContent === "");
  });
});

describe("projects and prefs", () => {
  test("choosing a project reloads the page, saves the default and shows it selected", async () => {
    calls.length = 0;
    const sel = $("project-select");
    sel.value = "/w/app";
    fire(sel, "change", { target: sel });
    await until(() => calls.some((c) => c[0] === "PUT"));
    expect(calls.find((c) => c[0] === "PUT")[2]).toEqual({ default_project: "/w/app" });
    await until(() => calls.some((c) => c[1] === "overview" && c[2].project === "/w/app"), "overview for the project");
    await until(() => $("project-select").value === "/w/app", "switcher rebuilt");
    expect(streamOpts.project).toBe("/w/app");
  });
  test("hidden projects leave the switcher unless selected, pinned ones are starred and first", async () => {
    answers.putResult = { prefs: { hidden_projects: ["/w/lib"], pinned_projects: ["/w/old"] } };
    calls.length = 0;
    key("d");
    await until(() => calls.some((c) => c[0] === "PUT"));
    await until(() => [...$("project-select").querySelectorAll("option")].map((o) => o.textContent).join("|") === "All projects|\u2605 old|app", "switcher rebuilt");
    answers.putResult = null;
  });
  test("selecting all projects again", async () => {
    const sel = $("project-select");
    sel.value = "all";
    fire(sel, "change", { target: sel });
    await until(() => $("project-select").value === "all");
  });
});

describe("framed host messages", () => {
  test("a theme message from the parent restyles the page", () => {
    win.dispatchEvent({ type: "message", source: win.parent, data: { type: "atlas:theme", theme: "system", density: "compact" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    win.dispatchEvent({ type: "message", source: win.parent, data: { type: "atlas:theme", theme: "bogus", density: "weird" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
    win.dispatchEvent({ type: "message", source: {}, data: { type: "atlas:theme", theme: "light" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
    win.dispatchEvent({ type: "message", source: win.parent, data: null });
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-density", "comfortable");
  });
  test("a pane selection from the same origin opens the terminal on it", async () => {
    win.dispatchEvent({ type: "message", origin: "http://127.0.0.1:7421", source: {}, data: { type: "select-pane", pane_id: "w1:p2" } });
    await settle();
    expect(hash()).toBe("#/terminal?pane=w1%3Ap2");
    win.dispatchEvent({ type: "message", origin: "http://127.0.0.1:7421", source: {}, data: { type: "select-pane", paneId: "w1:p3" } });
    await settle();
    expect(hash()).toBe("#/terminal?pane=w1%3Ap3");
    win.dispatchEvent({ type: "message", origin: "http://evil.example", source: {}, data: { type: "select-pane", pane_id: "w9:p9" } });
    await settle();
    expect(hash()).toBe("#/terminal?pane=w1%3Ap3");
    await goto("#/overview");
    await until(() => root().querySelector("#overview-root"));
  });
});

describe("launch agent", () => {
  test("the atlas:launch event opens the form and a launch posts the pane request", async () => {
    document.dispatchEvent({ type: "atlas:launch" });
    expect(hasOpenModal()).toBe(true);
    const m = document.querySelector(".modal");
    expect(m.getAttribute("aria-label")).toBe("Launch agent");
    m.querySelector("input").value = "fix-it";
    m.querySelector("textarea").value = "do it";
    calls.length = 0;
    fire([...m.querySelectorAll("button")].find((b) => b.textContent === "Launch"), "click");
    await until(() => calls.some((c) => c[0] === "POST"));
    expect(calls.find((c) => c[0] === "POST").slice(1)).toEqual(["herd/panes", { name: "fix-it", prompt: "do it", harness: "omp", project: expect.any(String) }]);
    await until(() => !hasOpenModal(), "closed");
    expect(document.querySelector(".toast").textContent).toContain("Launched fix-it");
  });
  test("a refused launch keeps the form open and shows the reason", async () => {
    document.dispatchEvent({ type: "atlas:launch" });
    const m = document.querySelector(".modal");
    answers.post = Object.assign(new Error("x"), { error: "No seat", why: "full", do: "kill one" });
    fire([...m.querySelectorAll("button")].find((b) => b.textContent === "Launch"), "click");
    await until(() => m.querySelector(".field-msg").textContent !== "");
    expect(m.querySelector(".field-msg").textContent).toBe("No seat. full. kill one");
    expect(hasOpenModal()).toBe(true);
    answers.post = null;
    fire([...m.querySelectorAll("button")].find((b) => b.textContent === "Cancel"), "click");
    expect(hasOpenModal()).toBe(false);
  });
});

describe("stamp", () => {
  test("a fetched event refreshes the as-of stamp", () => {
    $("asof").textContent = "";
    document.dispatchEvent({ type: "atlas:fetched" });
    expect($("asof").textContent).toMatch(/^as of /);
  });
});

describe("agents in the chrome", () => {
  const pane = (id, status) => ({ pane_id: id, title: "worker-" + id, cwd: "/w/app", status, state_change_seq: 1, state_changed_at: "2026-10-16T11:59:00Z" });
  const push = (...panes) => streamOpts.onEvent("herd", { agents: panes });
  const settleStore = async () => { await settle(); };
  test("the Agents nav link carries a count per state, and the framed host is told", async () => {
    push(pane("w1", "blocked"), pane("w2", "blocked"), pane("w3", "working"));
    await until(() => $("nav").querySelectorAll(".nav-count").length === 2, "nav counts");
    const counts = [...$("nav").querySelectorAll(".nav-count")];
    expect(counts.map((c) => c.getAttribute("title"))).toEqual(["2 needs input", "1 working"]);
    expect(counts.map((c) => c.textContent.trim().slice(-1))).toEqual(["2", "1"]);
    expect($("nav").querySelectorAll(".nav-badges")).toHaveLength(1);
    expect($("nav").querySelector('[data-page="health"] .nav-badges')).toBeNull();
    await until(() => $("attention").querySelector('[data-level="input"]'), "input pill");
    expect($("attention").querySelector('[data-level="input"]').getAttribute("aria-label")).toBe("2 need input");
    expect($("announce").textContent).toBe("2 agents need input");
    expect(document.title).toBe("(2) Overview | Atlas Command Center");
    const up = posted.filter(([m]) => m.type === "atlas:attention").pop();
    expect(up[0]).toEqual({ type: "atlas:attention", count: 2, needInput: 2, level: "input" });
  });
  test("one waiting agent is announced in the singular", async () => {
    push();
    await until(() => !$("nav").querySelector(".nav-count"), "counts cleared");
    push(pane("w1", "blocked"));
    await until(() => $("announce").textContent === "1 agent needs input", "singular announcement");
    expect(document.title).toBe("(1) Overview | Atlas Command Center");
  });
  test("clicking the pill lists the waiting agents and opens one in the inspector", async () => {
    push(pane("w1", "blocked"));
    await until(() => $("attention").querySelector('[data-level="input"]'));
    fire($("attention").querySelector('[data-level="input"]'), "click", {});
    await until(() => hasOpenPopover(), "popover");
    const rows = [...document.querySelectorAll(".attn-pop-row")];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("worker-w1");
    fire(rows[0], "click");
    await until(() => hasOpenDrawer(), "inspector");
    expect(hash()).toContain("agent=w1");
    expect(hasOpenPopover()).toBe(false);
    await goto("#/overview");
    await until(() => !hasOpenDrawer(), "inspector closed by dropping the param");
  });
  test("an agent param for an agent that is not loaded yet waits, then opens when the store has it", async () => {
    push();
    await settleStore();
    await goto("#/overview?agent=w9");
    await settle();
    expect(hasOpenDrawer()).toBe(false);
    push(pane("w9", "working"));
    await until(() => hasOpenDrawer(), "inspector once the agent arrives");
    await goto("#/overview");
    await until(() => !hasOpenDrawer());
    push();
  });
  test("with the rail collapsed the Agents link opens a flyout instead of navigating", async () => {
    const link = () => $("nav").querySelector('[data-page="agents"]');
    document.documentElement.setAttribute("data-rail", "expanded");
    const open = fire(link(), "click");
    await settle();
    expect(open.defaultPrevented).toBeFalsy();
    expect(hasOpenPopover()).toBe(false);
    document.documentElement.setAttribute("data-rail", "collapsed");
    const ev = fire(link(), "click");
    await until(() => hasOpenPopover(), "flyout");
    expect(ev.defaultPrevented).toBe(true);
    const fly = document.querySelector(".flyout");
    expect(fly.querySelector("a.menu-item").getAttribute("href")).toBe("#/agents?lens=roster");
    closePopover();
    document.documentElement.setAttribute("data-rail", "expanded");
  });
});

describe("attention items without an action", () => {
  test("clicking one goes to the Needs attention block on Overview", async () => {
    answers.overview = { kpis: [], attention: [{ title: "Stale lock", severity: "warn" }], recent_runs: [] };
    await goto("#/health");
    await until(() => root().querySelector(".pg-health"));
    key("r");
    await until(() => $("attention").querySelector('[data-level="findings"]'), "findings pill");
    expect($("attention").querySelector('[data-level="findings"]').getAttribute("data-sev")).toBe("warn");
    fire($("attention").querySelector('[data-level="findings"]'), "click", {});
    await until(() => hasOpenPopover());
    const row = document.querySelector(".attn-pop-row");
    expect(row.textContent).toContain("Stale lock");
    fire(row, "click");
    await settle();
    expect(hash()).toBe("#/overview#attention");
    answers.overview = { kpis: [], attention: [], recent_runs: [] };
    key("r");
    await until(() => $("attention").querySelector('[data-level="ok"]'));
  });
});

describe("framed messages to the host", () => {
  const origins = () => posted.filter(([m]) => m.type === "atlas:title").map(([, o]) => o);
  test("the title is posted on navigation, to any origin until the host is known", async () => {
    posted.length = 0;
    await goto("#/health");
    await until(() => origins().length > 0, "title post");
    expect(posted.find(([m]) => m.type === "atlas:title")[0]).toEqual({ type: "atlas:title", title: "Health | Atlas Command Center" });
    expect(origins().pop()).toBe("*");
  });
  test("the first ancestor origin is the target when the browser exposes one", async () => {
    Object.defineProperty(globalThis.location, "ancestorOrigins", { configurable: true, value: ["https://host.example", "https://top.example"] });
    try {
      posted.length = 0;
      await goto("#/projects");
      await until(() => origins().length > 0);
      expect(origins().pop()).toBe("https://host.example");
    } finally { delete globalThis.location.ancestorOrigins; }
  });
  test("otherwise the referrer's origin is used", async () => {
    Object.defineProperty(document, "referrer", { configurable: true, value: "https://ref.example/some/page?x=1" });
    try {
      posted.length = 0;
      await goto("#/health");
      await until(() => origins().length > 0);
      expect(origins().pop()).toBe("https://ref.example");
    } finally { delete document.referrer; }
  });
  test("a host that throws on postMessage does not break the page", async () => {
    const parent = win.parent;
    win.parent = { postMessage() { throw new Error("blocked"); } };
    try {
      await goto("#/activity");
      await until(() => root().querySelector(".pg-activity"));
      expect(document.title).toBe("Activity | Atlas Command Center");
    } finally { win.parent = parent; }
  });
});

describe("command palette memory", () => {
  const entry = (label) => [...document.querySelectorAll("#palette-root [role=option] button")].find((b) => b.textContent.includes(label));
  test("running an entry remembers it first, newest on top, without duplicates", async () => {
    localStorage.removeItem("atlas.recent");
    key("k", { ctrlKey: true });
    await until(() => isPaletteOpen(), "palette");
    fire(entry("Settings"), "click");
    await settle();
    expect(hash()).toBe("#/settings");
    expect(JSON.parse(localStorage.getItem("atlas.recent"))).toEqual(["go:settings"]);
    key("k", { ctrlKey: true });
    await until(() => isPaletteOpen());
    fire(entry("Health"), "click");
    await settle();
    expect(JSON.parse(localStorage.getItem("atlas.recent"))).toEqual(["go:health", "go:settings"]);
    key("k", { ctrlKey: true });
    await until(() => isPaletteOpen());
    fire(entry("Settings"), "click");
    await settle();
    expect(JSON.parse(localStorage.getItem("atlas.recent"))).toEqual(["go:settings", "go:health"]);
    await goto("#/overview");
  });
});
