// Agents page: one table of every agent and shell, grouped by project, with a detail drawer.
import { h, replace, relTime, truncate } from "../dom.js";
import {
  PageHeader,
  Button,
  Input,
  Segmented,
  StateDot,
  confirm,
  toast,
} from "../ui.js";
import { esc, gate } from "../html.js";
import { bindRegion } from "../region.js";
import { STATE_GLYPH, roleLetter } from "../glyph-table.js";
import { get, post, topics, describeError } from "../api.js";
import { mergeAgents } from "../state.js";
import { current, buildHash } from "../router.js";
import {
  STATE_FILTERS,
  inProject,
  filterRows,
  groupByProject,
  splitRecent,
  chipCounts,
  promptState,
  canStop,
} from "./agents-model.js";
import { openLaunchModal } from "./agents-launch.js";
import { openAgentDrawer } from "../drawer/agent-drawer.js";
import * as terminalTab from "../drawer/terminal.js";

const SEATS_POLL_MS = 8000;

/** Write agent/tab/full into the hash without a hashchange: the page re-renders only for real navigation. */
function writeHash(patch) {
  const { route, params } = current();
  const next = { ...params, ...patch };
  history.replaceState(null, "", buildHash(route, next));
}

async function stopRow(row, reload) {
  const ok = await confirm({
    title: `Stop ${row.name}?`,
    body: "This closes the agent's pane. Work that is not saved is lost.",
    confirmLabel: "Stop agent",
    danger: true,
  });
  if (!ok) return;
  try {
    await post(`/api/v2/herd/panes/${encodeURIComponent(row.pane_id)}/kill`);
    toast(`Stopped ${row.name}`, { kind: "ok" });
    reload();
  } catch (e) {
    const d = describeError(e);
    toast(d.message, { kind: "error", detail: d.detail });
  }
}


const GLYPH_KEY = {
  working: "running",
  input: "input",
  ready: "idle",
  done: "finished",
  fail: "failed",
  unknown: "dead",
};
const PREFIX_ROLE = {
  impl: "implementer",
  docs: "docs-curator",
  test: "test-engineer",
  review: "reviewer",
  rereview: "reviewer",
};

/** Role letter for a seat: the name prefix names the role (impl-x is an implementer), else the kind. */
function seatLetter(row) {
  const prefix = String(row.name || "").split("-")[0];
  return roleLetter(PREFIX_ROLE[prefix] || (row.kind === "lead" ? "lead" : prefix));
}

function seatActions(r, webUp) {
  const btn = (action, label, extra = "") =>
    `<button type="button" class="btn btn-sm" data-action="${action}" data-key="${esc(r.key)}"${extra}>${label}</button>`;
  return [
    r.deep_link && webUp
      ? `<a class="btn btn-sm" href="${esc(r.deep_link)}" target="_blank" rel="noopener">herdr</a>`
      : "",
    promptState(r).ok ? btn("prompt", "Prompt") : "",
    canStop(r) ? btn("stop", "Stop") : "",
  ].join("");
}

function seatRow(r, { selected, webUp }) {
  const glyph = STATE_GLYPH[GLYPH_KEY[r.state] || "dead"];
  return (
    `<div class="seat-row" role="row" tabindex="0" data-action="open" data-key="${esc(r.key)}" data-state="${esc(r.state)}"` +
    (selected === r.key ? ' aria-selected="true"' : "") +
    ">" +
    `<span class="seat-letter mono">${esc(seatLetter(r))}</span>` +
    `<span class="seat-glyph mono st-${esc(r.state)}" aria-hidden="true">${glyph}</span>` +
    `<span class="seat-name mono">${esc(r.name)}</span>` +
    `<span class="seat-state mono st-${esc(r.state)}">${esc(r.word)}</span>` +
    `<span class="seat-age mono">${esc(relTime(r.since))}</span>` +
    `<span class="seat-task">${esc(truncate(r.task, 90))}</span>` +
    `<span class="seat-acts">${seatActions(r, webUp)}</span>` +
    "</div>"
  );
}

/** Main region of the Agents page as an HTML string (pure; unit-tested). */
export function renderAgentsRegion({
  rows = [],
  loaded = false,
  error = null,
  selected = null,
  q = "",
  filter = "all",
  webUp = true,
}) {
  const state = gate({ loaded, error, count: rows.length }, "agents");
  if (state) return state;
  const visible = filterRows(rows, { q, state: filter });
  if (!visible.length)
    return '<div class="region-state empty">No agents match.</div>';
  const { live, recent } = splitRecent(visible);
  const opts = { selected, webUp };
  const groups = groupByProject(live)
    .map(
      (g) =>
        `<div class="grp-hd mono">${esc(g.label)} <span>${g.rows.length}</span></div>` +
        g.rows.map((r) => seatRow(r, opts)).join(""),
    )
    .join("");
  const rest = recent.length
    ? `<details class="recent-participants"><summary class="mono">Recent participants <span>${recent.length}</span></summary>` +
      '<p class="meta">Seen on a channel recently; no live pane.</p>' +
      recent.map((r) => seatRow(r, opts)).join("") +
      "</details>"
    : "";
  return `<div class="seat-list" role="table" aria-label="Agents">${groups}${rest}</div>`;
}

export function render(ctx) {
  const S = {
    agents: topics.agents.get(),
    seats: null,
    error: null,
    loaded: false,
    q: "",
    filter: "all",
    drawer: null,
    drawerKey: null,
    fullStop: null,
    disposed: false,
  };
  const layers = () => (S.agents && S.agents.layers) || {};
  const allRows = () =>
    mergeAgents(S.agents, S.seats).filter((r) => inProject(r, ctx.project));
  const rowByKey = (key) =>
    allRows().find((r) => r.key === key || r.name === key);

  // --- data ---
  async function loadAgents() {
    try {
      S.agents = await get("/api/v2/agents");
      S.error = null;
    } catch (e) {
      S.error = describeError(e).message;
    }
  }
  async function loadSeats() {
    try {
      S.seats = await get("/api/v2/term/seats");
    } catch (e) {
      // Seats only add shells; the agent list still renders without them.
      console.error("seats load failed", e);
    }
  }
  async function reload() {
    await Promise.all([loadAgents(), loadSeats()]);
    paint();
  }

  // --- drawer and full view ---
  function closeDrawer() {
    const d = S.drawer;
    S.drawer = null;
    S.drawerKey = null;
    if (d) d.close();
  }
  function showDrawer(row, tab, mode) {
    if (S.drawer && S.drawerKey === row.key) return;
    closeDrawer();
    S.drawerKey = row.key;
    const handle = openAgentDrawer({
      row,
      tab,
      mode,
      project: ctx.project,
      onTab: (t) => writeHash({ tab: t }),
      onExpand: (r) => {
        writeHash({ agent: r.key, tab: "terminal", full: "1" });
        syncFromHash();
      },
      onClose: () => {
        if (S.drawer !== handle) return;
        S.drawer = null;
        S.drawerKey = null;
        if (!S.disposed) writeHash({ agent: "", tab: "", full: "", mode: "" });
        paint();
      },
    });
    S.drawer = handle;
    paint();
  }
  function showFull(row) {
    closeDrawer();
    listView.hidden = true;
    fullView.hidden = false;
    if (S.fullStop) S.fullStop();
    const body = h("div", { class: "agents-full-body" });
    replace(
      fullView,
      h(
        "div",
        { class: "full-head" },
        h(
          "span",
          { class: "drawer-title" },
          StateDot(row.state),
          h("span", { class: "mono" }, row.name),
        ),
        Button(
          {
            onClick: () => {
              writeHash({ agent: row.key, tab: "terminal", full: "" });
              syncFromHash();
            },
          },
          "Back to agents",
        ),
      ),
      body,
    );
    S.fullStop = terminalTab.render({ root: body }, row);
  }
  function hideFull() {
    if (S.fullStop) S.fullStop();
    S.fullStop = null;
    listView.hidden = false;
    fullView.hidden = true;
    replace(fullView);
  }
  function syncFromHash() {
    const { agent, tab, full, mode } = current().params;
    const row = agent && S.loaded ? rowByKey(agent) : null;
    if (!row) {
      if (S.drawer) closeDrawer();
      hideFull();
      return;
    }
    if (full === "1") return showFull(row);
    hideFull();
    showDrawer(row, tab, mode);
  }
  const openRow = (row, tab = "terminal", mode = "") => {
    writeHash({ agent: row.key, tab, full: "", mode });
    syncFromHash();
  };
  async function openShell() {
    if (!S.seats) await loadSeats();
    // Prefer the host shell; mergeAgents drops it when a project shell already took the name "shell".
    const shells = allRows().filter((r) => r.seatKind === "shell");
    const shell = shells.find((r) => r.address === "shell@host") || shells[0];
    if (!shell)
      return toast("No shell is available", {
        kind: "warn",
        detail: "Recheck in a moment.",
      });
    openRow(shell);
  }
  const launch = () =>
    openLaunchModal({ project: ctx.project, onLaunched: reload });

  // --- views ---
  const search = Input({
    type: "search",
    placeholder: "Search agents",
    "aria-label": "Search agents",
  });
  search.addEventListener("input", () => {
    S.q = search.value;
    paint();
  });
  const chipsHost = h("div", { class: "chips" });
  const noticeHost = h("div");
  const tableHost = h("div", { class: "region" });
  const listView = h(
    "div",
    { class: "stack" },
    chipsHost,
    noticeHost,
    tableHost,
  );
  const fullView = h("div", { class: "agents-full", hidden: true });

  function paintChips(rows) {
    const c = chipCounts(rows);
    replace(
      chipsHost,
      Segmented({
        label: "Filter by state",
        value: S.filter,
        options: STATE_FILTERS.map((f) => ({
          value: f.value,
          label: `${f.label} ${c[f.value]}`,
        })),
        onChange: (v) => {
          S.filter = v;
          paint();
        },
      }),
    );
  }

  function paintNotice() {
    const down =
      layers().herdr_socket && layers().herdr_socket.reachable === false;
    replace(
      noticeHost,
      down &&
        h(
          "div",
          { class: "notice warn" },
          h(
            "span",
            {},
            "herdr is not running, so only channel participants are listed.",
          ),
          Button({ size: "sm", onClick: reload }, "Recheck"),
        ),
    );
  }

  function paintTable(rows) {
    tableHost.innerHTML = renderAgentsRegion({
      rows,
      loaded: S.loaded,
      error: S.error,
      selected: S.drawerKey,
      q: S.q,
      filter: S.filter,
      webUp: !(layers().herdr_web_ui && layers().herdr_web_ui.healthy === false),
    });
  }

  const byKey = (el) => rowByKey(el.dataset.key);
  const unbind = bindRegion(tableHost, {
    open: (el) => {
      const r = byKey(el);
      if (r) openRow(r);
    },
    prompt: (el) => {
      const r = byKey(el);
      if (r) openRow(r, "messages", "prompt");
    },
    stop: (el) => {
      const r = byKey(el);
      if (r) stopRow(r, reload);
    },
    retry: () => {
      S.loaded = false;
      paint();
      reload().then(() => {
        S.loaded = true;
        paint();
      });
    },
  });

  function paint() {
    if (S.disposed) return;
    const rows = allRows();
    paintChips(rows);
    paintNotice();
    paintTable(rows);
    if (S.drawer && S.drawerKey) {
      const live = rowByKey(S.drawerKey);
      if (live) S.drawer.setRow(live);
    }
  }

  // --- mount ---
  replace(
    ctx.root,
    PageHeader({
      title: "Agents",
      description: "Everything running on this machine, live.",
      actions: [
        search,
        Button({ icon: "terminal", onClick: openShell }, "Open shell"),
        Button(
          { variant: "primary", icon: "plus", onClick: launch },
          "Launch agent",
        ),
      ],
    }),
    listView,
    fullView,
  );
  paint();
  reload().then(() => {
    S.loaded = true;
    paint();
    syncFromHash();
  });

  const unsubscribe = topics.agents.subscribe((v) => {
    S.agents = v;
    paint();
  });
  const timer = setInterval(() => {
    if (!document.hidden) loadSeats().then(paint);
  }, SEATS_POLL_MS);
  const onVisible = () => {
    if (!document.hidden) loadSeats().then(paint);
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    S.disposed = true;
    unsubscribe();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    unbind();
    closeDrawer();
    hideFull();
  };
}
