// Settings page (brief 5.9): section list, search, one row per setting with its current value and source.
import { h, replace, on, relTime, num } from "../dom.js";
import { PageHeader, Input, Empty, Skeleton, Copy, confirm, toast } from "../ui.js";
import { get, post, prefs, savePrefs, describeError } from "../api.js";
import { buildHash } from "../router.js";
import { esc, gate } from "../html.js";
import { bindRegion } from "../region.js";
import {
  SECTIONS,
  flattenBehavior,
  controlFor,
  currentLine,
  liveSentence,
  exportLine,
  optionsFor,
  modelOptions,
  isOn,
  toggleValue,
  filterEntries,
  countBySection,
  rangeText,
  resultSentence,
  splitProjects,
  pinPatch,
  hidePatch,
  projectHealth,
} from "./settings-model.js";
import {
  Row,
  makeFeedback,
  SwitchControl,
  SelectControl,
  InputControl,
} from "./settings-row.js";
import {
  buildDashboardRows,
  buildConnectorRows,
  buildPluginRows,
} from "./settings-panels.js";

const PROJECTS_ID = "projects";

const LAYER_LABEL = {
  live_env: "Dashboard process",
  store: "Atlas store",
  claude_settings: "Claude settings",
  omp_config: "omp config",
  shell_rc: "Shell profile",
};

function layersTable(entry) {
  const rows = Object.entries(entry.layers || {}).filter(
    ([, l]) => l.supported,
  );
  if (!rows.length) return null;
  return h(
    "table",
    { class: "layers" },
    h("thead", {}, h("tr", {}, h("th", {}, "Layer"), h("th", {}, "Value"))),
    h(
      "tbody",
      {},
      rows.map(([name, l]) =>
        h(
          "tr",
          {},
          h("td", {}, LAYER_LABEL[name] || name),
          h(
            "td",
            { class: "mono" },
            l.value == null || l.value === "" ? "not set" : l.value,
          ),
        ),
      ),
    ),
  );
}

function moreBlock(entry) {
  const body = [
    entry.details && h("p", {}, entry.details),
    entry.effect && h("p", { class: "meta" }, entry.effect),
    entry.ref &&
      h("p", { class: "meta" }, "Read at ", h("code", {}, entry.ref)),
    layersTable(entry),
  ].filter(Boolean);
  if (!body.length) return null;
  return h(
    "details",
    { class: "setting-more" },
    h("summary", {}, "More"),
    ...body,
  );
}

/** Build one behavior row. `saved(key, sentence)` re-fetches the server state and redraws it. */
function behaviorRow(entry, { saved, models }) {
  const fb = makeFeedback();
  const kind = controlFor(entry);
  const haveModels =
    kind === "model" && Array.isArray(models) && models.length > 0;
  const cur = entry.current || {};

  // POST one key. Resolves true when saved; shows the failure sentence inline otherwise.
  async function save(value, confirmed = false) {
    fb.clear();
    try {
      const res = await post("/api/behavior", {
        updates: { [entry.key]: value },
        confirm: confirmed || undefined,
      });
      const s = resultSentence(res);
      if (s.tone === "ok") {
        await saved(entry.key, s.text);
        return true;
      }
      fb.fail(s.text);
    } catch (e) {
      const s = resultSentence(
        (e && e.data) || { error: "network", why: describeError(e).message },
      );
      if (s.confirm && !confirmed) {
        const yes = await confirm({
          title: "Run this command on every prompt?",
          body: s.confirm,
          confirmLabel: "Save command",
          danger: true,
        });
        if (yes) return save(value, true);
        return false;
      }
      fb.fail(s.text);
    }
    return false;
  }

  // A refused switch or select snaps back to the value the server still holds.
  let control = null;
  if (kind === "switch")
    control = SwitchControl({
      checked: isOn(entry, cur.value),
      label: entry.title,
      save: async (next) => {
        if (!(await save(toggleValue(entry, next))))
          control.setAttribute("aria-checked", String(!next));
      },
    });
  else if (kind === "select" || haveModels)
    control = SelectControl({
      options: haveModels ? modelOptions(models, cur.value) : optionsFor(entry),
      value: cur.value,
      label: entry.title,
      save: async (v) => {
        if (!(await save(v))) control.value = String(cur.value ?? "");
      },
    });
  else if (kind === "number")
    control = InputControl({
      number: true,
      value: cur.value,
      range: entry.range,
      placeholder: rangeText(entry.range),
      label: entry.title,
      save,
    });
  else if (kind !== "readonly")
    control = InputControl({
      mono: true,
      value: cur.value,
      placeholder: String(entry.default || "not set"),
      label: entry.title,
      save,
      type: kind === "url" ? "url" : undefined,
    });

  const extra = [];
  const live = liveSentence(entry);
  if (live) extra.push(h("p", { class: "meta" }, live));
  if (kind === "model" && !haveModels)
    extra.push(h("p", { class: "meta" }, "Ollama list unavailable"));
  if (kind === "readonly")
    extra.push(
      h(
        "p",
        { class: "meta" },
        entry.read_only_reason || "This value cannot be saved here.",
      ),
      Copy(exportLine(entry)),
    );

  return Row({
    meta: { ...entry, section: entry.section },
    control,
    current: currentLine(entry),
    extra,
    more: moreBlock(entry),
    feedback: fb,
  });
}


function projectRow(r, { pinned, isHidden }) {
  const st = projectHealth(r.health);
  const todos = (r.todos && r.todos.open) ?? null;
  const cell = (label, value) =>
    `<span class="proj-fact mono" title="${label}">${esc(num(value))}</span>`;
  return (
    `<div class="proj-row" role="row" data-root="${esc(r.root)}">` +
    `<span class="proj-name"><a href="${esc(buildHash("run", { project: r.root }))}">${esc(r.name || r.root)}</a>` +
    `<span class="mono meta wrap">${esc(r.root)}</span></span>` +
    `<span class="proj-fact mono">${r.last_active ? `${esc(relTime(r.last_active))} ago` : "never"}</span>` +
    cell("Runs 7d", r.runs_7d) +
    cell("Agents active", r.agents_active) +
    cell("Open tasks", todos) +
    cell("Failures 7d", r.failures_7d) +
    cell("Findings open", r.findings_open) +
    `<span class="proj-fact mono st-${esc(st.raw)}">${esc(st.word)}</span>` +
    '<span class="proj-acts">' +
    (isHidden
      ? ""
      : `<button type="button" class="btn btn-sm" data-action="pin" data-root="${esc(r.root)}" aria-pressed="${pinned.has(r.root)}">${pinned.has(r.root) ? "Unpin" : "Pin"}</button>`) +
    `<button type="button" class="btn btn-sm" data-action="hide" data-root="${esc(r.root)}">${isHidden ? "Show" : "Hide"}</button>` +
    "</span></div>"
  );
}

/** The Projects section (absorbed from the old Projects page) as an HTML string (pure; unit-tested). */
export function renderProjectsRegion({
  data = null,
  loaded = false,
  error = null,
  prefs: p = {},
}) {
  const all = (data && data.projects) || [];
  const gated = gate({ loaded, error, count: all.length }, "projects");
  if (gated) return gated;
  const { visible, hidden } = splitProjects(all, p.pinned_projects, p.hidden_projects);
  const pinned = new Set(p.pinned_projects || []);
  const rows = (list, isHidden) => list.map((r) => projectRow(r, { pinned, isHidden })).join("");
  return (
    `<div class="proj-list" role="table" aria-label="Projects">${rows(visible, false)}</div>` +
    (hidden.length
      ? `<details class="hidden-projects"><summary class="mono">Hidden projects (${hidden.length})</summary><div class="proj-list">${rows(hidden, true)}</div></details>`
      : "")
  );
}

function SectionNav(onPick, extra = []) {
  const nav = h("nav", {
    class: "settings-nav",
    "aria-label": "Settings sections",
  });
  const links = new Map();
  for (const s of [...SECTIONS, ...extra]) {
    const count = h("span", { class: "count" });
    const b = h(
      "button",
      {
        type: "button",
        class: "settings-nav-link",
        dataset: { section: s.id },
      },
      h("span", {}, s.title),
      count,
    );
    b.addEventListener("click", () => onPick(s.id));
    links.set(s.id, { b, count });
    nav.append(b);
  }
  return {
    el: nav,
    paint(c) {
      for (const [id, { b, count }] of links) {
        count.textContent = c[id] || 0;
        b.hidden = !c[id];
      }
    },
  };
}

export async function render(ctx) {
  const root = ctx.root;
  let query = "";
  const search = Input({
    type: "search",
    placeholder: "Search settings",
    "aria-label": "Search settings",
    class: "settings-search",
  });
  replace(
    root,
    PageHeader({
      title: "Settings",
      description: "How Atlas behaves. Every row shows its current value.",
      actions: search,
    }),
    Skeleton(8),
  );

  let entries = [];
  let models = null; // Ollama model list; null when the endpoint failed
  const skeletons = new Map(); // section id -> loading placeholder, removed when behavior rows arrive
  const items = []; // {meta, node} for every row on the page, behavior or not
  const sectionEls = new Map();
  const content = h("div", { class: "settings-wrap" });
  const nav = SectionNav(
    (id) => {
      const el = sectionEls.get(id);
      if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
    },
    [{ id: PROJECTS_ID, title: "Projects" }],
  );
  const empty = h("div", { hidden: true });

  async function refreshBehavior() {
    const fresh = flattenBehavior(await get("/api/behavior"));
    entries = fresh;
    return fresh;
  }

  // Redraw one row from fresh server state, keeping its inline result.
  async function saved(key, sentence) {
    let entry;
    try {
      entry = (await refreshBehavior()).find((e) => e.key === key);
    } catch (e) {
      entry = entries.find((x) => x.key === key);
    }
    const idx = items.findIndex((i) => i.meta.key === key);
    if (!entry || idx < 0) return;
    const node = behaviorRow(entry, { saved, models });
    node.hidden = items[idx].node.hidden;
    items[idx].node.replaceWith(node);
    items[idx] = { meta: entry, node };
    showSaved(node, sentence);
  }
  function showSaved(node, sentence) {
    const slot = node.querySelector(".setting-result");
    slot.className = "setting-result is-ok";
    slot.replaceChildren(
      h("span", { class: "dot s-ok", "aria-hidden": "true" }),
      h("span", {}, sentence),
    );
    setTimeout(() => {
      slot.replaceChildren();
      slot.className = "setting-result";
    }, 3000);
  }

  function applyFilter() {
    const visible = new Set(
      filterEntries(
        items.map((i) => i.meta),
        query,
      ),
    );
    const counts = countBySection([...visible]);
    for (const i of items) i.node.hidden = !visible.has(i.meta);
    // Projects is not a behavior setting: it hides only while a search is active.
    counts[PROJECTS_ID] = query.trim() ? 0 : 1;
    for (const [id, el] of sectionEls)
      el.hidden = !counts[id] && !skeletons.has(id);
    nav.paint(counts);
    replace(
      empty,
      !visible.size ? Empty({ title: `No setting matches ${query}` }) : null,
    );
    empty.hidden = !!visible.size;
  }

  function addSection(id, title) {
    const body = h("div", { class: "settings-rows" });
    const sec = h(
      "section",
      { class: "settings-section", id: `settings-${id}` },
      h("h2", {}, title),
      body,
    );
    sectionEls.set(id, sec);
    content.append(sec);
    return body;
  }

  function addRows(sectionId, rows) {
    const body = sectionEls.get(sectionId).querySelector(".settings-rows");
    for (const r of rows) {
      body.append(r.node);
      items.push({ meta: { ...r.meta, section: sectionId }, node: r.node });
    }
    applyFilter();
  }

  for (const s of SECTIONS) addSection(s.id, s.title);
  const projectsBody = addSection(PROJECTS_ID, "Projects");
  replace(
    root,
    PageHeader({
      title: "Settings",
      description: "How Atlas behaves. Every row shows its current value.",
      actions: search,
    }),
    h(
      "div",
      { class: "settings-layout" },
      nav.el,
      h("div", {}, content, empty),
    ),
  );

  const stopSearch = on(search, "input", () => {
    query = search.value;
    applyFilter();
  });

  // Projects: pin/hide state comes from prefs and paints with the dashboard rows; the list loads after.
  const P = { data: null, loaded: false, error: null };
  const paintProjects = () => {
    projectsBody.innerHTML = renderProjectsRegion({ ...P, prefs: prefs.get() });
  };
  const savePref = async (patch) => {
    try {
      await savePrefs(patch);
    } catch (e) {
      const d = describeError(e);
      toast(d.message, { kind: "error", detail: d.detail });
    }
  };
  const loadProjects = async () => {
    P.loaded = false;
    P.error = null;
    paintProjects();
    try {
      P.data = await get("/api/v2/projects");
    } catch (e) {
      P.error = describeError(e).message;
    }
    P.loaded = true;
    paintProjects();
  };
  const stopProjects = bindRegion(projectsBody, {
    pin: (el) => savePref(pinPatch(prefs.get(), el.dataset.root)),
    hide: (el) => savePref(hidePatch(prefs.get(), el.dataset.root)),
    retry: loadProjects,
  });
  const stopPrefs = prefs.subscribe(paintProjects);
  paintProjects();

  // 1. Dashboard rows read the primed prefs store, so they paint at first render.
  // Behavior sections hold a skeleton until step 2 resolves, so the page never looks empty.
  for (const s of SECTIONS) {
    if (["dashboard", "connectors", "plugins"].includes(s.id)) continue;
    const sk = Skeleton(2);
    skeletons.set(s.id, sk);
    sectionEls.get(s.id).querySelector(".settings-rows").append(sk);
  }
  addRows("dashboard", buildDashboardRows());

  // 2. Behavior rows and the Ollama list load in parallel.
  const loadBehavior = async () => {
    const [behavior, ollama] = await Promise.allSettled([
      refreshBehavior(),
      get("/api/v2/ollama/models", {}, { timeoutMs: 8000 }),
    ]);
    for (const sk of skeletons.values()) sk.remove();
    skeletons.clear();
    if (ollama.status === "fulfilled") models = ollama.value.models || [];
    else console.warn("ollama model list unavailable", ollama.reason); // model rows fall back to a text input
    if (behavior.status === "rejected") {
      content.prepend(
        Empty({
          title: "Behavior settings did not load.",
          body: describeError(behavior.reason).message,
        }),
      );
      applyFilter();
      return;
    }
    for (const e of entries)
      addRows(e.section, [
        { meta: e, node: behaviorRow(e, { saved, models }) },
      ]);
  };

  // 3. Connectors and plugins run alongside step 2, not after it.
  const panels = [
    ["connectors", buildConnectorRows],
    ["plugins", buildPluginRows],
  ];
  loadProjects(); // not awaited: the section shows its own loading state
  await Promise.all([
    loadBehavior(),
    ...panels.map(async ([id, build]) => {
      try {
        addRows(id, await build());
      } catch (e) {
        sectionEls
          .get(id)
          .querySelector(".settings-rows")
          .append(
            h(
              "p",
              { class: "setting-result is-fail" },
              `This section did not load: ${describeError(e).message}`,
            ),
          );
        sectionEls.get(id).hidden = false;
      }
    }),
  ]);
  applyFilter();
  return () => {
    stopSearch();
    stopProjects();
    stopPrefs();
  };
}
