// fallow-ignore-file unused-file
// Boot: prefs, sidebar shell, router, live counts. Pages are loaded on demand from ./pages/<route>.js.
import { h, replace, baseName } from "./dom.js";
import { icon, brandMark } from "./icons.js";
import {
  IconButton,
  Select,
  StateDot,
  Empty,
  Button,
  toast,
} from "./ui.js";
import { startRouter, navigate, setParams, acceptRender } from "./router.js";
import { mergeAgents, countStates } from "./state.js";
import {
  get,
  prefs,
  project,
  live,
  topics,
  VERSION,
  startStream,
  primePrefs,
  primeTopics,
  savePrefs,
  describeError,
} from "./api.js";
import {
  applyTheme,
  applyDensity,
  cycleTheme,
  getTheme,
  watchSystemTheme,
  setCollapsed,
} from "./theme.js";
import { initShortcuts } from "./shortcuts.js";

const NAV = [
  ["overview", "Overview"],
  ["agents", "Agents"],
  ["board", "Board"],
  ["channels", "Channels"],
  ["activity", "Activity"],
  ["health", "Health"],
  ["improve", "Improve"],
  ["projects", "Projects"],
  ["settings", "Settings"],
];
const THEME_ICON = { dark: "moon", light: "sun", system: "sun" };
const LIVE_WORD = {
  live: ["ok", "Live"],
  connecting: ["unknown", "Connecting"],
  reconnecting: ["needs", "Reconnecting"],
  offline: ["fail", "Offline"],
};
const BASE_TITLE = "Atlas Command Center";

let cleanup = null;
let themeButton = null;

function paintTheme() {
  if (!themeButton) return;
  const t = getTheme();
  themeButton.replaceChildren(icon(THEME_ICON[t]));
  themeButton.title = `Theme: ${t}`;
  themeButton.setAttribute("aria-label", `Theme: ${t}`);
}
let currentRoute = "overview";

// --- Sidebar ---

function buildSidebar() {
  const navLinks = NAV.map(([route, label]) =>
    h(
      "a",
      { href: `#/${route}`, dataset: { route }, title: label },
      icon(route),
      h("span", { class: "nav-label" }, label),
      h("span", {
        class: "count-badge",
        dataset: { badge: route },
        hidden: true,
      }),
    ),
  );
  const projectSelect = Select({
    label: "Project",
    class: "project-select",
    options: [{ value: "all", label: "All projects" }],
    value: "all",
    onChange: (v) =>
      setParams({ project: v === "all" ? "" : v }, { push: false }),
  });
  const fleet = h("div", { class: "row", id: "fleet-line" });
  const liveEl = h("div", { class: "row", id: "live-line" });
  const themeBtn = IconButton({
    icon: THEME_ICON[getTheme()],
    label: "Theme: " + getTheme(),
  });
  themeButton = themeBtn;
  themeBtn.addEventListener("click", () => {
    const next = cycleTheme();
    paintTheme();
    // One source of truth: prefs win on boot, localStorage is only the pre-paint cache.
    savePrefs({ theme: next }).catch((e) => console.error("theme save failed", e));
  });
  const collapseBtn = IconButton({
    icon: "sidebar",
    label: "Collapse sidebar",
    class: "collapse-btn",
  });
  collapseBtn.addEventListener("click", () =>
    setCollapsed(
      document.documentElement.getAttribute("data-collapsed") !== "true",
    ),
  );
  const menuBtn = IconButton({
    icon: "menu",
    label: "Menu",
    class: "menu-btn",
  });
  menuBtn.addEventListener("click", () => {
    const open = document.documentElement.getAttribute("data-menu") === "open";
    if (open) document.documentElement.removeAttribute("data-menu");
    else document.documentElement.setAttribute("data-menu", "open");
  });
  const sidebar = h(
    "nav",
    { class: "sidebar", "aria-label": "Primary" },
    h(
      "a",
      {
        class: "brand",
        href: "#/overview",
        "aria-label": "Atlas Command Center, overview",
      },
      brandMark(),
      h(
        "span",
        { class: "brand-text" },
        h("span", { class: "brand-name" }, "Atlas"),
        h("span", { class: "brand-sub" }, "Command Center"),
      ),
    ),
    menuBtn,
    projectSelect,
    h("div", { class: "nav" }, navLinks),
    h(
      "div",
      { class: "sidebar-foot" },
      fleet,
      liveEl,
      h(
        "div",
        { class: "row" },
        h("div", { class: "tools" }, themeBtn, collapseBtn),
        h("span", { class: "ver" }, VERSION ? `v${VERSION}` : ""),
      ),
    ),
  );
  // Close the mobile menu after choosing a page.
  sidebar.addEventListener("click", (ev) => {
    if (ev.target.closest(".nav a"))
      document.documentElement.removeAttribute("data-menu");
  });
  return sidebar;
}

function setBadge(route, text, tone) {
  const el = document.querySelector(`[data-badge="${route}"]`);
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
  el.className = `count-badge ${tone || ""}`;
}

function paintAgents() {
  const rows = mergeAgents(topics.agents.get(), null);
  const c = countStates(rows);
  setBadge("agents", c.input || "", "alert");
  const fleet = document.getElementById("fleet-line");
  if (fleet) {
    replace(
      fleet,
      StateDot(c.working ? "working" : "ready", {
        word: `${c.working} working`,
      }),
      c.input ? h("span", { class: "txt" }, ` · ${c.input} need input`) : null,
    );
  }
  document.title = c.input ? `(${c.input}) ${BASE_TITLE}` : BASE_TITLE;
}

function paintTodos() {
  const t = topics.todos.get();
  const n = (t && t.counts && t.counts.blocked) || 0;
  setBadge("board", n || "", "alert");
}

function paintHealth() {
  const hl = topics.health.get();
  const bad = ((hl && hl.subsystems) || []).filter(
    (s) => s.status === "fail",
  ).length;
  setBadge("health", bad ? "!" : "", "fail");
}

function paintLive() {
  const el = document.getElementById("live-line");
  if (!el) return;
  const [tone, word] = LIVE_WORD[live.get()] || LIVE_WORD.offline;
  replace(
    el,
    h(
      "span",
      { class: "state" },
      h("span", { class: `dot s-${tone}`, "aria-hidden": "true" }),
      h("span", { class: "txt" }, word),
    ),
  );
}

function paintNav(route) {
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

async function loadProjects() {
  try {
    const res = await get("/api/v2/projects");
    const sel = document.querySelector(".project-select");
    const want = project.get();
    replace(
      sel,
      h("option", { value: "all" }, "All projects"),
      (res.projects || [])
        .filter((p) => p.root)
        .map((p) =>
          h(
            "option",
            { value: p.root, selected: p.root === want },
            p.name || baseName(p.root),
          ),
        ),
    );
    if (want === "all") sel.value = "all";
  } catch (e) {
    // The select stays on "All projects"; the Projects page reports the failure itself.
    console.error("projects load failed", e);
  }
}

// --- Routing ---

async function show({ route, params }) {
  const want = params.project || "all";
  if (project.get() !== want) {
    project.set(want);
    const sel = document.querySelector(".project-select");
    if (sel && [...sel.options].some((o) => o.value === want)) sel.value = want;
  }
  paintNav(route);
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  currentRoute = route;
  // Fresh root per navigation: a late paint from the previous page lands on a detached node.
  const old = document.getElementById("page-root");
  const root = old.cloneNode(false);
  old.replaceWith(root);
  try {
    const mod = await import(`./pages/${route}.js`);
    if (currentRoute !== route) return; // user navigated away while the module loaded
    const done =
      (await mod.render({
        root,
        route,
        params,
        project: want,
        navigate,
        setParams,
      })) || null;
    if (acceptRender(currentRoute, route, root)) cleanup = done;
    else if (typeof done === "function") done();
  } catch (e) {
    console.error(`page ${route} failed`, e);
    const d = describeError(e);
    replace(
      root,
      Empty({
        title: "This page failed to load.",
        body: d.message,
        action: Button({ onClick: () => show({ route, params }) }, "Retry"),
      }),
    );
  }
}

// --- Boot ---

function applyPrefs() {
  const p = prefs.get();
  applyDensity(p.density);
  if (p.theme && p.theme !== getTheme()) applyTheme(p.theme);
  paintTheme();
}

async function boot() {
  const app = document.getElementById("app");
  replace(
    app,
    buildSidebar(),
    h(
      "main",
      { class: "main" },
      h("div", { class: "page", id: "page-root", tabindex: "-1" }),
    ),
  );
  watchSystemTheme();
  initShortcuts();
  topics.agents.subscribe(paintAgents);
  topics.todos.subscribe(paintTodos);
  topics.health.subscribe(paintHealth);
  live.subscribe(paintLive);
  prefs.subscribe(applyPrefs);
  window.addEventListener("atlas:theme", paintTheme);
  paintLive();
  paintAgents();
  window.addEventListener("unhandledrejection", (ev) => {
    const d = describeError(ev.reason);
    toast(d.message, { kind: "error", detail: d.detail });
  });
  // Prefs first so the first page paints with the real theme and settings.
  await primePrefs();
  const projectsLoaded = loadProjects();
  startRouter(show);
  startStream();
  primeTopics();
  await projectsLoaded;
  const dp = prefs.get().default_project;
  if (!location.hash.includes("project=") && dp && dp !== "all")
    setParams({ project: dp });
}

boot();
