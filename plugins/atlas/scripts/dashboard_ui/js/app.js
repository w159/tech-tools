// fallow-ignore-file unused-file
// Boot: prefs, band shell, router, live counts. Pages are loaded on demand from ./pages/<route>.js.
import { replace, baseName } from "./dom.js";
import { Empty, Button, toast } from "./ui.js";
import { renderBand } from "./band.js";
import { startRouter, navigate, setParams, acceptRender } from "./router.js";
import { mergeAgents, countStates } from "./state.js";
import {
  prefs,
  project,
  live,
  topics,
  startStream,
  primePrefs,
  primeTopics,
  describeError,
} from "./api.js";
import {
  applyTheme,
  applyDensity,
  getTheme,
  watchSystemTheme,
} from "./theme.js";
import { initShortcuts } from "./shortcuts.js";

const BASE_TITLE = "Atlas Command Center";

let cleanup = null;
let currentRoute = "run";
const mq = matchMedia("(max-width: 699px)");

// --- Band ---

// ponytail: phase/branch/lead are placeholders until the Task 4 adapter feeds real run data.
function paintBand() {
  const el = document.getElementById("band");
  if (!el) return;
  const rows = mergeAgents(topics.agents.get(), null);
  const c = countStates(rows);
  const p = project.get();
  // A page that paints the band itself (run.js, with real colony data) marks it owned.
  if (!el.dataset.owner) el.innerHTML = renderBand({
    project: p === "all" ? "all projects" : baseName(p),
    branch: null,
    lead: null,
    phase: "research",
    n: null,
    m: null,
    counts: {
      working: c.working || 0,
      needs: c.input || 0,
      failed: c.fail || 0,
      parked: c.ready || 0,
    },
    live: live.get(),
    clock: new Date().toTimeString().slice(0, 8),
    narrow: mq.matches,
    route: currentRoute,
  });
  document.title = c.input ? `(${c.input}) ${BASE_TITLE}` : BASE_TITLE;
}

// --- Routing ---

function showFailure(root, route, params, e) {
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

async function mount(root, route, params, want) {
  const mod = await import(`./pages/${route}.js`);
  if (currentRoute !== route) return; // user navigated away while the module loaded
  const done =
    (await mod.render({ root, route, params, project: want, navigate, setParams })) || null;
  if (acceptRender(currentRoute, route, root)) cleanup = done;
  else if (typeof done === "function") done();
}

async function show({ route, params }) {
  const want = params.project || "all";
  if (project.get() !== want) project.set(want);
  currentRoute = route;
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  paintBand(); // after cleanup so a page that owned the band has released it
  // Fresh root per navigation: a late paint from the previous page lands on a detached node.
  const old = document.getElementById("page-root");
  const root = old.cloneNode(false);
  old.replaceWith(root);
  try {
    await mount(root, route, params, want);
  } catch (e) {
    showFailure(root, route, params, e);
  }
}

// --- Boot ---

function applyPrefs() {
  const p = prefs.get();
  applyDensity(p.density);
  if (p.theme && p.theme !== getTheme()) applyTheme(p.theme);
}

async function boot() {
  watchSystemTheme();
  initShortcuts();
  topics.agents.subscribe(paintBand);
  live.subscribe(paintBand);
  project.subscribe(paintBand);
  mq.addEventListener("change", paintBand);
  setInterval(() => {
    const c = document.querySelector("#band .clock");
    if (c) c.textContent = new Date().toTimeString().slice(0, 8);
  }, 1000);
  prefs.subscribe(applyPrefs);
  paintBand();
  window.addEventListener("unhandledrejection", (ev) => {
    const d = describeError(ev.reason);
    toast(d.message, { kind: "error", detail: d.detail });
  });
  // Prefs first so the first page paints with the real theme and settings.
  await primePrefs();
  startRouter(show);
  startStream();
  primeTopics();
  const dp = prefs.get().default_project;
  if (!location.hash.includes("project=") && dp && dp !== "all")
    setParams({ project: dp });
}

boot();
