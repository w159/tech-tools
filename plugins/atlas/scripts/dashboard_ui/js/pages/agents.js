// Agents page: one table of every agent and shell, grouped by project, with a detail drawer.
import { h, replace, relTime, truncate } from "../dom.js";
import {
  PageHeader,
  Button,
  IconButton,
  Input,
  Segmented,
  Table,
  Skeleton,
  Empty,
  StateDot,
  confirm,
  toast,
} from "../ui.js";
import { get, post, topics, describeError } from "../api.js";
import { mergeAgents } from "../state.js";
import { current, buildHash } from "../router.js";
import {
  STATE_FILTERS,
  NAME_PATTERN,
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
  const tableHost = h("div");
  const listView = h(
    "div",
    { class: "stack" },
    chipsHost,
    noticeHost,
    tableHost,
  );
  const fullView = h("div", { class: "agents-full", hidden: true });

  function rowActions(r) {
    const webUp = !(
      layers().herdr_web_ui && layers().herdr_web_ui.healthy === false
    );
    const open = IconButton({
      icon: "external",
      label: !r.deep_link
        ? "No herdr link for this row"
        : webUp
          ? "Open in herdr"
          : "The herdr web UI is not running",
      size: "sm",
      disabled: !r.deep_link || !webUp,
      onClick: () => window.open(r.deep_link, "_blank", "noopener"),
    });
    const acts = [open];
    if (promptState(r).ok)
      acts.push(
        IconButton({
          icon: "message",
          label: "Prompt",
          size: "sm",
          onClick: () => openRow(r, "messages", "prompt"),
        }),
      );
    if (canStop(r))
      acts.push(
        IconButton({
          icon: "stop",
          label: "Stop",
          size: "sm",
          onClick: () => stopRow(r, reload),
        }),
      );
    return h("div", { class: "row-actions" }, acts);
  }

  const columns = [
    { key: "state", label: "State", render: (r) => StateDot(r.state) },
    {
      key: "name",
      label: "Name",
      render: (r) =>
        h("span", { class: NAME_PATTERN.test(r.name) ? "mono" : "" }, r.name),
    },
    { key: "kind", label: "Kind", class: "col-wide", render: (r) => r.kind || "" },
    {
      key: "task",
      label: "Task",
      class: "truncate-cell",
      render: (r) => truncate(r.task, 80),
    },
    {
      key: "since",
      label: "Since",
      class: "num col-wide",
      render: (r) => relTime(r.since),
    },
    { key: "actions", label: "", render: rowActions },
  ];

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
    if (!S.loaded) return replace(tableHost, Skeleton(6));
    if (S.error && !S.agents)
      return replace(
        tableHost,
        Empty({
          title: "Agents did not load.",
          body: S.error,
          action: Button({ onClick: reload }, "Retry"),
        }),
      );
    const visible = filterRows(rows, { q: S.q, state: S.filter });
    if (!rows.length)
      return replace(
        tableHost,
        Empty({
          title: "No agents running.",
          action: Button(
            { variant: "primary", icon: "plus", onClick: launch },
            "Launch agent",
          ),
        }),
      );
    const { live, recent } = splitRecent(visible);
    const tableRows = groupByProject(live).flatMap((g) => [
      {
        __group: h("span", {}, h("strong", {}, g.label), ` · ${g.rows.length}`),
      },
      ...g.rows,
    ]);
    const table = (rs, emptyEl) =>
      Table({
        columns,
        rows: rs,
        selected: S.drawerKey,
        onRowClick: (r) => openRow(r),
        empty: emptyEl,
      });
    replace(
      tableHost,
      table(tableRows, Empty({ title: "No agents match." })),
      recent.length &&
        h(
          "details",
          { class: "recent-participants" },
          h(
            "summary",
            {},
            h("strong", {}, "Recent participants"),
            ` · ${recent.length}`,
          ),
          h("p", { class: "meta" }, "Seen on a channel recently; no live pane."),
          table(recent, null),
        ),
    );
  }

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
    closeDrawer();
    hideFull();
  };
}
