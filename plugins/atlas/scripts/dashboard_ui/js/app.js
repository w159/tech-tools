// Atlas Workboard boot: store, router, SSE, sidebar, project switcher, attention badge,
// theme/density toggles, command palette and keyboard navigation.

import { h, icon, clear, debounce } from "./dom.js";
import { api, ApiError } from "./api.js";
import { toast, toastError, Modal, openModal, closeModal, hasOpenModal, openDrawer, closeDrawer, hasOpenDrawer, StatusDot } from "./components.js";
import overview from "./pages/overview.js";
import colony from "./pages/colony.js";
import work from "./pages/work.js";
import irc from "./pages/irc.js";

// ---- store ----------------------------------------------------------------

function createStore(initial) {
  const data = new Map(Object.entries(initial || {}));
  const subs = new Map();
  return {
    get: (k) => data.get(k),
    set(k, v) {
      data.set(k, v);
      for (const fn of subs.get(k) || []) fn(v);
    },
    subscribe(k, fn) {
      if (!subs.has(k)) subs.set(k, new Set());
      subs.get(k).add(fn);
      return () => subs.get(k).delete(fn);
    },
  };
}

const store = createStore({ project: "all", prefs: {}, projects: [], attention: [], conn: "idle" });

// ---- pages ----------------------------------------------------------------

const GROUPS = [
  { id: "observe", label: "Observe", pages: ["overview", "activity", "health"] },
  { id: "operate", label: "Operate", pages: ["colony", "work", "irc"] },
  { id: "improve", label: "Improve", pages: ["improve"] },
  { id: "configure", label: "Configure", pages: ["projects", "settings"] },
];

const LABELS = { overview: "Overview", activity: "Activity", health: "Health", colony: "Colony", work: "Work", irc: "IRC", improve: "Self-improvement", projects: "Projects", settings: "Settings" };
const ICON_FOR = { overview: "overview", activity: "activity", health: "health", colony: "colony", work: "work", irc: "irc", improve: "improve", projects: "projects", settings: "settings" };
const CHORDS = { o: "overview", a: "activity", h: "health", c: "colony", w: "work", i: "irc", s: "improve", p: "projects", ",": "settings" };

const pages = new Map();
for (const p of [overview, colony, work, irc]) pages.set(p.id, p);

async function loadExternalPage(id) {
  try {
    const mod = await import("./pages/" + id + ".js");
    if (mod && mod.default) pages.set(id, mod.default);
  } catch {
    // module not installed yet: handled by the pending placeholder at route time
  }
}

async function loadExternalPages() {
  const ids = ["activity", "health", "improve", "projects", "settings"];
  await Promise.all(ids.map((id) => loadExternalPage(id)));
}

function pendingPage(id) {
  return {
    id,
    title: LABELS[id] || id,
    icon: ICON_FOR[id] || "help",
    group: "",
    async load() {
      return null;
    },
    render() {
      return h("div", { class: "page" }, h("h1", null, LABELS[id] || id), h("p", { class: "dim" }, "This page is not available in this build."));
    },
  };
}

// ---- routing --------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const [pageId, anchor] = (pathPart || "").split("#");
  const params = {};
  new URLSearchParams(queryPart || "").forEach((v, k) => {
    params[k] = v;
  });
  return { id: pageId || "overview", anchor: anchor || "", params };
}

export function navigate(target, params) {
  let id = target;
  let anchor = "";
  if (String(target).includes("#")) [id, anchor] = String(target).split("#");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const text = qs.toString();
  location.hash = "#/" + id + (anchor ? "#" + anchor : "") + (text ? "?" + text : "");
}

let current = null; // { page, ctx, node }
let navToken = 0;

function makeCtx(params) {
  return {
    api,
    store,
    navigate,
    toast,
    openDrawer,
    closeDrawer,
    project: store.get("project"),
    prefs: store.get("prefs"),
    params: params || {},
  };
}

async function route() {
  const { id, anchor, params } = parseHash();
  const page = pages.get(id) || pendingPage(id);
  const token = ++navToken;
  if (current && current.page.destroy) {
    try {
      current.page.destroy();
    } catch (_err) {
      // page cleanup must never block navigation
    }
  }
  closeDrawer();
  const rootEl = document.getElementById("page-root");
  const ctx = makeCtx(params);
  current = { page, ctx, node: null };
  markNav(page.id);
  document.title = (page.title || id) + " | Atlas";
  clear(rootEl);
  rootEl.appendChild(h("p", { class: "dim", role: "status" }, "Loading " + (page.title || id).toLowerCase() + "..."));
  let data = null;
  try {
    data = await page.load(ctx);
  } catch (err) {
    if (token !== navToken) return;
    clear(rootEl);
    rootEl.appendChild(errorView(page, err, route));
    return;
  }
  if (token !== navToken) return;
  try {
    const node = page.render(ctx, data);
    clear(rootEl);
    rootEl.appendChild(node);
    current.node = node;
    if (anchor) {
      const target = document.getElementById(anchor);
      if (target) target.scrollIntoView({ block: "start" });
    }
  } catch (err) {
    clear(rootEl);
    rootEl.appendChild(errorView(page, err, route));
  }
  const main = document.getElementById("main");
  if (main && !anchor) main.scrollTop = 0;
}

function errorView(page, err, retry) {
  const e = err instanceof ApiError ? err : { error: (err && err.message) || "Something went wrong", why: "", do: "Reload the page." };
  return h(
    "div",
    { class: "page" },
    h("h1", null, page.title || page.id),
    h(
      "div",
      { class: "field-error", role: "alert" },
      h("div", null, e.error),
      e.why ? h("div", { class: "why" }, e.why) : null,
      e.do ? h("div", { class: "do" }, e.do) : null
    ),
    h("div", null, h("button", { class: "btn", type: "button", onClick: () => retry() }, "Retry"))
  );
}

// ---- chrome ---------------------------------------------------------------

function markNav(activeId) {
  document.querySelectorAll("#nav .nav-link").forEach((a) => {
    if (a.dataset.page === activeId) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function buildNav() {
  const nav = clear(document.getElementById("nav"));
  for (const group of GROUPS) {
    nav.appendChild(
      h(
        "div",
        { class: "nav-group", role: "group", "aria-labelledby": "nav-" + group.id },
        h("div", { class: "nav-title", id: "nav-" + group.id }, group.label),
        group.pages.map((id) => h("a", { class: "nav-link", href: "#/" + id, "data-page": id }, icon(ICON_FOR[id]), LABELS[id]))
      )
    );
  }
}

function buildSwitcher() {
  const host = clear(document.getElementById("project-switcher"));
  const projects = store.get("projects") || [];
  const select = h(
    "select",
    {
      class: "select",
      id: "project-select",
      "aria-label": "Project",
      style: { width: "100%" },
      onChange: (e) => setProject(e.target.value, true),
    },
    h("option", { value: "all" }, "All projects"),
    projects.map((p) => h("option", { value: p.root }, p.name || p.root))
  );
  select.value = store.get("project");
  if (select.value !== store.get("project")) select.value = "all";
  host.appendChild(h("div", { class: "field" }, h("label", { for: "project-select" }, "Project"), select));
}

function setProject(project, persist) {
  store.set("project", project || "all");
  if (persist) savePrefs({ default_project: store.get("project") });
  restartStream();
  route();
  refreshAttention();
}

function buildAttention() {
  const host = clear(document.getElementById("attention"));
  const items = store.get("attention") || [];
  const fails = items.filter((i) => i.severity === "fail").length;
  const warns = items.filter((i) => i.severity === "warn").length;
  const level = fails ? "fail" : warns ? "warn" : "ok";
  const label = items.length ? items.length + " need attention" : "All clear";
  host.appendChild(
    h(
      "button",
      { class: "attn", type: "button", "data-level": level, "aria-label": label, onClick: () => navigate("overview#attention") },
      StatusDot({ status: level }),
      h("span", null, label)
    )
  );
}

async function refreshAttention() {
  try {
    const data = await api.get("overview", { project: store.get("project"), window: "7d" });
    store.set("attention", Array.isArray(data.attention) ? data.attention : []);
  } catch (_err) {
    // the overview page shows the error; the badge simply keeps its last value
  }
}

function applyTheme() {
  const prefs = store.get("prefs") || {};
  document.documentElement.setAttribute("data-theme", prefs.theme || "dark");
  document.documentElement.setAttribute("data-density", prefs.density || "comfortable");
  buildToggles();
}

function effectiveTheme() {
  const t = (store.get("prefs") || {}).theme || "dark";
  if (t === "system") return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return t;
}

function buildToggles() {
  const host = clear(document.getElementById("toggles"));
  const theme = effectiveTheme();
  const density = (store.get("prefs") || {}).density || "comfortable";
  host.appendChild(
    h("button", { class: "btn btn-icon", type: "button", id: "toggle-theme", "aria-label": "Switch to " + (theme === "dark" ? "light" : "dark") + " theme", title: "Theme", onClick: toggleTheme }, icon(theme === "dark" ? "sun" : "moon"))
  );
  host.appendChild(
    h("button", { class: "btn btn-icon", type: "button", id: "toggle-density", "aria-label": "Use " + (density === "compact" ? "comfortable" : "compact") + " density", "aria-pressed": density === "compact" ? "true" : "false", title: "Density", onClick: toggleDensity }, icon("density"))
  );
}

function toggleTheme() {
  savePrefs({ theme: effectiveTheme() === "dark" ? "light" : "dark" });
}

function toggleDensity() {
  const d = (store.get("prefs") || {}).density === "compact" ? "comfortable" : "compact";
  savePrefs({ density: d });
}

const LOCAL_KEY = "atlas.dashboard.prefs";

function loadLocalPrefs() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}") || {};
  } catch (_err) {
    return {};
  }
}

async function savePrefs(patch) {
  const next = Object.assign({}, store.get("prefs"), patch);
  store.set("prefs", next);
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ theme: next.theme, density: next.density, default_project: next.default_project }));
  } catch (_err) {
    // private mode: server prefs still apply
  }
  applyTheme();
  try {
    const saved = await api.put("prefs", patch);
    store.set("prefs", Object.assign({}, next, saved));
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) toastError(err, "Could not save preferences");
  }
}

// ---- command palette ------------------------------------------------------

function paletteEntries() {
  const entries = [];
  for (const group of GROUPS) {
    for (const id of group.pages) entries.push({ label: "Go to " + LABELS[id], hint: "g " + Object.keys(CHORDS).find((k) => CHORDS[k] === id), run: () => navigate(id) });
  }
  entries.push({ label: "Toggle light and dark theme", hint: "", run: toggleTheme });
  entries.push({ label: "Toggle compact density", hint: "", run: toggleDensity });
  entries.push({ label: "Keyboard shortcuts", hint: "?", run: showShortcuts });
  entries.push({ label: "Show all projects", hint: "", run: () => setProject("all", true) });
  for (const p of store.get("projects") || []) entries.push({ label: "Switch to project " + (p.name || p.root), hint: "", run: () => setProject(p.root, true) });
  return entries;
}

let paletteOpen = false;

function closePalette() {
  const host = document.getElementById("palette-root");
  clear(host);
  paletteOpen = false;
}

function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  const returnTo = document.activeElement;
  const host = document.getElementById("palette-root");
  const entries = paletteEntries();
  let shown = entries;
  let sel = 0;
  const list = h("ul", { role: "listbox", id: "palette-list", "aria-label": "Commands" });
  const input = h("input", { type: "text", role: "combobox", "aria-expanded": "true", "aria-controls": "palette-list", "aria-label": "Search commands", placeholder: "Type a command or page", autocomplete: "off", spellcheck: "false" });
  const draw = () => {
    clear(list);
    if (!shown.length) list.appendChild(h("li", { class: "dim", style: { padding: "var(--s-3)" } }, "No matches"));
    shown.forEach((e, i) => {
      const li = h("li", { role: "option", id: "pal-" + i, "aria-selected": i === sel ? "true" : "false" }, h("button", { type: "button", tabindex: "-1", onClick: () => pick(i) }, e.label, e.hint ? h("span", { class: "hint" }, e.hint) : null));
      list.appendChild(li);
    });
    input.setAttribute("aria-activedescendant", shown.length ? "pal-" + sel : "");
  };
  const done = () => {
    closePalette();
    if (returnTo && returnTo.isConnected && typeof returnTo.focus === "function") returnTo.focus();
  };
  const pick = (i) => {
    const e = shown[i];
    done();
    if (e) e.run();
  };
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    shown = q ? entries.filter((e) => e.label.toLowerCase().includes(q)) : entries;
    sel = 0;
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      sel = Math.min(shown.length - 1, sel + 1);
      draw();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, sel - 1);
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(sel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      done();
    }
  });
  const scrim = h("div", { class: "scrim", style: { zIndex: 69 }, onClick: done });
  host.appendChild(scrim);
  host.appendChild(h("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" }, input, list));
  draw();
  input.focus();
}

function showShortcuts() {
  const rows = [
    ["Ctrl or Cmd + K", "Command palette"],
    ["/", "Focus search"],
    ["g then o", "Overview"],
    ["g then a", "Activity"],
    ["g then h", "Health"],
    ["g then c", "Colony"],
    ["g then w", "Work"],
    ["g then i", "IRC"],
    ["g then s", "Self-improvement"],
    ["g then p", "Projects"],
    ["g then ,", "Settings"],
    ["Esc", "Close panel, dialog or palette"],
    ["?", "This list"],
  ];
  const close = h("button", { class: "btn btn-primary", type: "button", onClick: () => closeModal() }, "Close");
  openModal(Modal({ title: "Keyboard shortcuts", children: [h("dl", { class: "kbd-list" }, rows.map(([k, d]) => [h("dt", null, h("kbd", null, k)), h("dd", null, d)]))], actions: [close] }));
}

// ---- keyboard -------------------------------------------------------------

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

let chordTimer = null;
let chordArmed = false;

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    paletteOpen ? closePalette() : openPalette();
    return;
  }
  if (e.key === "Escape") {
    if (paletteOpen) {
      closePalette();
    } else if (hasOpenModal()) {
      closeModal();
    } else if (hasOpenDrawer()) {
      closeDrawer();
    } else {
      return;
    }
    e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  if (chordArmed) {
    chordArmed = false;
    clearTimeout(chordTimer);
    const dest = CHORDS[e.key.toLowerCase()];
    if (dest) {
      e.preventDefault();
      navigate(dest);
    }
    return;
  }
  if (e.key === "g") {
    chordArmed = true;
    clearTimeout(chordTimer);
    chordTimer = setTimeout(() => {
      chordArmed = false;
    }, 1500);
  } else if (e.key === "/") {
    e.preventDefault();
    const field = document.querySelector("#page-root input[type=search], #page-root .search");
    if (field) field.focus();
    else openPalette();
  } else if (e.key === "?") {
    e.preventDefault();
    showShortcuts();
  }
}

// ---- stream ---------------------------------------------------------------

let stream = null;

function connLabel(mode) {
  const el = document.getElementById("conn");
  if (!el) return;
  el.textContent = mode === "live" ? "Live" : mode === "poll" ? "Polling every 8s" : "";
}

const pollNow = debounce(() => {
  if (current && current.page.onEvent) current.page.onEvent("tick", current.ctx, { polled: true });
}, 300);

function restartStream() {
  if (stream) stream.close();
  stream = api.stream({
    project: store.get("project"),
    onMode: (mode) => {
      store.set("conn", mode);
      connLabel(mode);
    },
    poll: pollNow,
    onEvent: (name, data) => {
      if (name === "health") refreshAttentionSoon();
      if (current && current.page.onEvent) {
        try {
          current.page.onEvent(name, current.ctx, data);
        } catch (_err) {
          // a page's live update must not break the stream
        }
      }
    },
  });
}

const refreshAttentionSoon = debounce(refreshAttention, 1500);

// ---- boot -----------------------------------------------------------------

async function boot() {
  const local = loadLocalPrefs();
  store.set("prefs", Object.assign({ theme: "dark", density: "comfortable" }, local));
  store.set("project", local.default_project || "all");
  applyTheme();
  document.getElementById("palette-icon").appendChild(icon("search"));
  buildNav();
  document.addEventListener("keydown", onKey);
  document.getElementById("open-palette").addEventListener("click", openPalette);
  store.subscribe("attention", buildAttention);
  buildAttention();

  const [prefs, projects] = await Promise.all([api.get("prefs").catch(() => null), api.get("projects").catch(() => null), loadExternalPages()]).then((r) => [r[0], r[1]]);
  if (prefs) {
    store.set("prefs", Object.assign({}, store.get("prefs"), prefs));
    if (prefs.default_project) store.set("project", prefs.default_project);
    applyTheme();
  }
  store.set("projects", projects && Array.isArray(projects.projects) ? projects.projects : []);
  const known = new Set(["all", ...store.get("projects").map((p) => p.root)]);
  if (!known.has(store.get("project"))) store.set("project", "all");
  buildSwitcher();

  window.addEventListener("hashchange", route);
  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason instanceof ApiError) {
      e.preventDefault();
      toastError(e.reason);
    }
  });
  if (!location.hash) location.hash = "#/overview";
  else route();
  restartStream();
  refreshAttention();
}

boot();
