// Agent detail drawer: head, Terminal | Messages | Tasks tabs, Stop footer.
// openAgentDrawer({row, tab, project, onTab, onClose, onExpand}) -> {close, setRow}.
import { h, replace, relTime, baseName } from "../dom.js";
import { Drawer, Tabs, StateDot, Button, confirm, toast } from "../ui.js";
import { post, describeError } from "../api.js";
import { canStop } from "../pages/agents-model.js";
import * as terminalTab from "./terminal.js";
import * as messagesTab from "./messages.js";
import * as tasksTab from "./tasks.js";

const TAB_IDS = ["terminal", "messages", "tasks"];
const TABS = [
  { id: "terminal", label: "Terminal", mod: terminalTab },
  { id: "messages", label: "Messages", mod: messagesTab },
  { id: "tasks", label: "Tasks", mod: tasksTab },
];

function headParts(row) {
  const meta = [
    row.kind,
    row.project && baseName(row.project),
    relTime(row.since),
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    title: h(
      "span",
      { class: "drawer-title" },
      StateDot(row.state),
      h("span", { class: "mono" }, row.name),
    ),
    subtitle: h(
      "div",
      { class: "drawer-sub" },
      h("div", {}, meta),
      row.cwd && h("div", { class: "mono truncate", title: row.cwd }, row.cwd),
      row.deep_link &&
        h(
          "a",
          { href: row.deep_link, target: "_blank", rel: "noopener" },
          "Open in herdr",
        ),
    ),
  };
}

export function openAgentDrawer({
  row,
  tab,
  project,
  onTab,
  onClose,
  onExpand,
  mode,
}) {
  let current = row;
  let active = TAB_IDS.includes(tab) ? tab : "terminal";
  let stopTab = null;
  let closing = false;

  const panel = h("div", { class: "drawer-panel" });
  const showTab = async (id) => {
    active = id;
    if (stopTab) stopTab();
    stopTab = null;
    const entry = TABS.find((t) => t.id === id);
    const ctx = {
      root: panel,
      project,
      initialMode: id === "messages" ? mode : undefined,
      onExpand:
        id === "terminal" ? () => onExpand && onExpand(current) : undefined,
    };
    const cleanup = await entry.mod.render(ctx, current);
    // A later tab switch or close may have run while the tab was loading.
    if (active !== id || closing) {
      if (typeof cleanup === "function") cleanup();
      return;
    }
    stopTab = typeof cleanup === "function" ? cleanup : null;
  };

  const tabs = Tabs({
    tabs: TABS.map(({ id, label }) => ({ id, label })),
    active,
    onSelect: (id) => {
      if (onTab) onTab(id);
      showTab(id);
    },
  });

  const parts = headParts(current);
  const ctl = Drawer(
    {
      title: parts.title,
      subtitle: parts.subtitle,
      onClose: () => {
        closing = true;
        if (stopTab) stopTab();
        stopTab = null;
        if (onClose) onClose();
      },
    },
    tabs,
    panel,
  );

  if (canStop(current)) {
    ctl.el.append(
      h(
        "div",
        { class: "drawer-foot" },
        Button(
          {
            variant: "danger",
            icon: "stop",
            onClick: async () => {
              const ok = await confirm({
                title: `Stop ${current.name}?`,
                body: "This closes the agent's pane. Work that is not saved is lost.",
                confirmLabel: "Stop agent",
                danger: true,
              });
              if (!ok) return;
              try {
                await post(
                  `/api/v2/herd/panes/${encodeURIComponent(current.pane_id)}/kill`,
                );
                toast(`Stopped ${current.name}`, { kind: "ok" });
                ctl.close();
              } catch (e) {
                const d = describeError(e);
                toast(d.message, { kind: "error", detail: d.detail });
              }
            },
          },
          "Stop",
        ),
      ),
    );
  }

  showTab(active);
  return {
    close: ctl.close,
    // Refresh the head when the row changes live; the open tab keeps its connection.
    setRow(next) {
      current = next;
      const p = headParts(next);
      const head = ctl.el.querySelector(".drawer-head .titles");
      if (head)
        replace(
          head,
          h("h2", {}, p.title),
          h("div", { class: "meta" }, p.subtitle),
        );
    },
  };
}
