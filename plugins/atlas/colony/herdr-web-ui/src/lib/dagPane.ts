import type { PaneInfo } from "../../shared/protocol.ts";
import { knownStatus } from "./status.ts";

/**
 * A pane omo-herdr-dag opened beside an OmO pane to draw its workflow in the TUI. Told the way
 * the plugin finds its own panes: the label it gives the pane (`DAG · <session>`) or the title
 * its viewer sets (`OmO DAG`). A viewer is no agent: a pane that has one, or that works or waits
 * for input, is never taken for it whatever it is called, so a pane left out of the roster is
 * never one a status, an alert or a close confirmation is about.
 */
export function isDagViewerPane(pane: PaneInfo): boolean {
  if (pane.agent) return false;
  const status = knownStatus(pane.agent_status);
  if (status === "working" || status === "blocked") return false;
  return (typeof pane.label === "string" && pane.label.startsWith("DAG · "))
    || pane.terminal_title === "OmO DAG" || pane.terminal_title_stripped === "OmO DAG";
}

/**
 * The panes the sidebar and the tab strip show: a DAG viewer is left out while its tab has
 * another pane (the OmO it draws, whose chat already lists the workflow), so it neither adds a
 * tab strip nor a pane to pick. It stays when it is the pane open (`keep`) or all its tab has.
 */
export function rosterPanes<T extends PaneInfo>(panes: readonly T[], keep?: string | null): T[] {
  return panes.filter((pane) => pane.pane_id === keep || !isDagViewerPane(pane)
    || !panes.some((other) => other.tab_id === pane.tab_id && !isDagViewerPane(other)));
}

/**
 * A pane herdr's own sidebar plugin (explorer/git) opened beside the work: it carries the
 * `herdr-sidebar-*` tokens and the label `Sidebar`. It is herdr's file tree, not an agent or a
 * shell of the user's, so the Command Center frame (`?chrome=full`) never opens it.
 */
export function isSidebarPane(pane: PaneInfo): boolean {
  if (pane.agent) return false;
  if (Object.keys(pane.tokens ?? {}).some((key) => key.startsWith("herdr-sidebar-"))) return true;
  return pane.label === "Sidebar";
}

/**
 * The panes the Command Center frame lists and may open: the roster minus herdr's sidebar panes.
 * Its first choice when nothing valid is open is an agent (the working one first), then any pane.
 */
export function colonyPanes<T extends PaneInfo>(panes: readonly T[], keep?: string | null): T[] {
  return rosterPanes(panes, keep).filter((pane) => !isSidebarPane(pane));
}

export function colonyFallbackPane<T extends PaneInfo>(panes: readonly T[]): T | null {
  const usable = colonyPanes(panes);
  return usable.find((pane) => pane.agent && pane.agent_status === "working")
    ?? usable.find((pane) => pane.agent)
    ?? usable[0]
    ?? null;
}
