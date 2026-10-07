import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, Ellipsis, Folder, FolderOpen, GitBranch, GripVertical, Layers, Pencil, Plus, Terminal, Trash2, X } from "lucide-react";

import "./Sidebar.css";

import type { AgentStatus, PaneInfo, SessionSnapshot, WorkspaceInfo, HerdrPane } from "../../shared/protocol.ts";
import { paneTitle } from "../../shared/notify-policy.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import type { AppActions } from "../lib/actions.ts";
import { knownStatus, rollupStatus, STATUS_WORD } from "../lib/status.ts";
import { AgentMark } from "./AgentMark.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RowMenu, type RowMenuItem } from "./RowMenu.tsx";
import { WorktreeDialog, type WorktreeDialogMode } from "./WorktreeDialog.tsx";
import { focusWorkspaceListToggle } from "../lib/focus.ts";
import { folderName, placeLine, shortPathTitle } from "../lib/paneName.ts";
import { useT } from "../lib/i18n.ts";
import { groupDirectories } from "../lib/directoryGroups.ts";
import { rosterPanes } from "../lib/dagPane.ts";
import { useSettings, type SidebarGrouping } from "../lib/settings.ts";

const ERROR_NOTE_MS = 5000;

/** Folder folds belong to a PC and full path (the group's key), not an individual workspace. */
const collapsedKey = (machineId: string, groupKey: string) => `herdr-web-ui:directory-collapsed:${machineId}:${groupKey}`;
function storedCollapsed(machineId: string, groupKeys: string[]): Set<string> {
  const collapsed = new Set<string>();
  try {
    for (const key of groupKeys) if (localStorage.getItem(collapsedKey(machineId, key)) === "1") collapsed.add(key);
  } catch { /* storage denied: nothing is folded */ }
  return collapsed;
}

/** shell prompt titles: `user@host:` is chrome, the path after it is the information */
const SHELL_PREFIX = /^[^:@\s]+@[^:@\s]+:/;
/** Herdr's agent glyph and spinner are already represented by the row mark and badge. */
const AGENT_CHROME = /^π\s*[^\p{L}\p{N}\s]?\s*/u;

function stripPaneChrome(title: string, agent: string | null | undefined): string {
  const shellStripped = title.replace(SHELL_PREFIX, "");
  return agent ? shellStripped.replace(AGENT_CHROME, "") : shellStripped;
}

export { paneTitle };

/**
 * The title a row or the header shows: the user's label, else the live title minus its chrome,
 * a working directory written out shortened to its last folder (lib/paneName.ts).
 */
export function displayPaneTitle(pane: PaneInfo): string {
  return pane.label?.trim() || shortPathTitle(stripPaneChrome(paneTitle(pane), pane.agent)) || pane.pane_id;
}

/** herdr could not bring this pane back after a restart (0.9.3+ `restore_error`): its reason, on hover. */
export function RestoreErrorBadge({ reason }: { reason: string }) {
  const t = useT();
  return <span className="badge badge-restore-error" title={reason}>{t("NOT RESTORED")}</span>;
}

export function StatusBadge({ status }: { status?: AgentStatus }) {
  const t = useT();
  const value = knownStatus(status);
  return (
    <span className={`badge badge-${value}`} data-status={value} title={t("Agent {status}", { status: t(STATUS_WORD[value]) })}>
      {t(STATUS_WORD[value])}
    </span>
  );
}

/**
 * Background tasks an agent started that still run (OmO's `task` children): the main turn can be
 * done while they work, and they wake the session by themselves. A count beside the state word,
 * not a state of its own: DONE stays the moment the agent answered.
 */
export function BackgroundBadge({ count }: { count?: number }) {
  const t = useT();
  if (!count || count <= 0) return null;
  const label = t("Background tasks running: {count}", { count });
  return (
    <span className="badge badge-background" title={label} aria-label={label} data-testid="background-tasks">
      <Layers aria-hidden="true" />{count}
    </span>
  );
}

function cwdBasename(cwd: string | null | undefined): string {
  return cwd ? folderName(cwd) : "unknown directory";
}

interface InlineError {
  workspaceId?: string;
  message: string;
}

/** The row whose ⋯ menu is open: a workspace, seen through the pane its row shows. */
interface MenuState { anchor: HTMLElement; workspace: WorkspaceInfo; pane: PaneInfo; scope: string; title: string; place: string }
interface ConfirmState { title: string; body: string; action?: string; run: () => Promise<void>; escalation?: { label: string; code: string; run: () => Promise<void> } }

export interface SidebarProps {
  snapshot: SessionSnapshot | null;
  selectedPaneId: string | null;
  actions: AppActions;
}

/**
 * One row per workspace, as herdr's Spaces sidebar: the row shows the workspace's current pane
 * (the selected one when it is in the workspace, else the one last viewed there, else the one
 * herdr has in front) and opens it. The panes of a workspace are picked from the tab strip
 * over the pane, the palette and Needs you; the row's state is the roll-up of all of them.
 */
export function Sidebar({ snapshot, selectedPaneId, actions }: SidebarProps) {
  const t = useT();
  const { settings } = useSettings();
  const byFolder = settings.sidebarGrouping === "directory";
  const machineId = useMachineId();
  const { closePane, closeWorkspace, moveWorkspace, removeWorktree, renamePane, renameWorkspace } = useMachineApi();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [worktreeDialog, setWorktreeDialog] = useState<{ mode: WorktreeDialogMode; workspace: WorkspaceInfo } | null>(null);
  const [editingPaneId, setEditingPaneId] = useState<string | null>(null);
  const [paneLabel, setPaneLabel] = useState("");
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [workspaceLabel, setWorkspaceLabel] = useState("");
  const [workspaceOrder, setWorkspaceOrder] = useState<string[]>([]);
  const [dragWorkspaceId, setDragWorkspaceId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<InlineError | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => storedCollapsed(machineId, snapshot ? groupDirectories(snapshot.workspaces, snapshot.panes).map((group) => group.key) : []));
  const unfoldedFor = useRef<Partial<Record<SidebarGrouping, string>>>({});
  // the pane each workspace was last seen on: its row keeps showing and opening that one
  const lastViewed = useRef(new Map<string, string>());

  useEffect(() => {
    const pane = selectedPaneId ? snapshot?.panes.find((pane) => pane.pane_id === selectedPaneId) : undefined;
    if (pane) lastViewed.current.set(pane.workspace_id, pane.pane_id);
  }, [selectedPaneId, snapshot]);

  const setGroupCollapsed = (groupKey: string, collapsed: boolean): void => {
    setCollapsedGroups((current) => {
      if (current.has(groupKey) === collapsed) return current;
      const next = new Set(current);
      if (collapsed) next.add(groupKey); else next.delete(groupKey);
      return next;
    });
    try {
      if (collapsed) localStorage.setItem(collapsedKey(machineId, groupKey), "1");
      else localStorage.removeItem(collapsedKey(machineId, groupKey));
    } catch {}
  };

  useEffect(() => {
    if (inlineError === null) return;
    const timer = window.setTimeout(() => setInlineError(null), ERROR_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [inlineError]);

  useEffect(() => {
    if (!snapshot) {
      setWorkspaceOrder([]);
      return;
    }
    const serverOrder = snapshot.workspaces.map((workspace) => workspace.workspace_id);
    setWorkspaceOrder((current) => current.join("\u0000") === serverOrder.join("\u0000") ? current : serverOrder);
    // New folders bring their stored fold state after reconnecting or creating a session.
    setCollapsedGroups((current) => {
      const keys = groupDirectories(snapshot.workspaces, snapshot.panes).map((group) => group.key);
      const stored = storedCollapsed(machineId, keys.filter((key) => !current.has(key)));
      return stored.size === 0 ? current : new Set([...current, ...stored]);
    });
  }, [snapshot, machineId]);

  // Reveal a newly selected pane's folder once; toggling back preserves its deliberate fold.
  useEffect(() => {
    if (!byFolder || !selectedPaneId || !snapshot) return;
    const directory = groupDirectories(snapshot.workspaces, snapshot.panes).find((group) => group.workspaces.some((entry) => entry.panes.some((pane) => pane.pane_id === selectedPaneId)));
    if (!directory) return;
    const opened = JSON.stringify([machineId, selectedPaneId, directory.key]);
    if (unfoldedFor.current[settings.sidebarGrouping] === opened) return;
    unfoldedFor.current[settings.sidebarGrouping] = opened;
    setGroupCollapsed(directory.key, false);
  }, [selectedPaneId, snapshot, machineId, settings.sidebarGrouping, byFolder]);

  const orderedWorkspaces = useMemo(() => {
    if (!snapshot) return [];
    const byId = new Map(snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace]));
    return workspaceOrder.map((id) => byId.get(id)).filter((workspace): workspace is WorkspaceInfo => workspace !== undefined);
  }, [snapshot, workspaceOrder]);
  const roster = useMemo(() => rosterPanes(snapshot?.panes ?? [], selectedPaneId), [snapshot?.panes, selectedPaneId]);
  const directories = useMemo(() => groupDirectories(orderedWorkspaces, roster), [orderedWorkspaces, roster]);
  // herdr packs a repository's worktree workspaces under the one on its main checkout; a worktree
  // whose repository workspace is not open stays at the top level, in its own place
  const worktreeGroups = useMemo(() => {
    const parentByRepo = new Map<string, WorkspaceInfo>();
    for (const workspace of orderedWorkspaces) {
      if (workspace.worktree && !workspace.worktree.is_linked_worktree && !parentByRepo.has(workspace.worktree.repo_key)) parentByRepo.set(workspace.worktree.repo_key, workspace);
    }
    const childrenOf = new Map<string, WorkspaceInfo[]>();
    const top: WorkspaceInfo[] = [];
    for (const workspace of orderedWorkspaces) {
      const parent = workspace.worktree?.is_linked_worktree ? parentByRepo.get(workspace.worktree.repo_key) : undefined;
      if (!parent) { top.push(workspace); continue; }
      const children = childrenOf.get(parent.workspace_id) ?? [];
      children.push(workspace);
      childrenOf.set(parent.workspace_id, children);
    }
    return top.map((workspace) => ({ workspace, children: childrenOf.get(workspace.workspace_id) ?? [] }));
  }, [orderedWorkspaces]);

  const noteError = (message: string, workspaceId?: string): void => setInlineError({ message, workspaceId });

  /** the pane a workspace's row shows and opens, among the panes the row stands for */
  const currentPane = (workspace: WorkspaceInfo, panes: PaneInfo[]): PaneInfo => {
    const pick = (id: string | null | undefined) => (id ? panes.find((pane) => pane.pane_id === id) : undefined);
    return pick(selectedPaneId)
      ?? pick(lastViewed.current.get(workspace.workspace_id))
      ?? pick(snapshot?.layouts?.find((layout) => layout.tab_id === workspace.active_tab_id)?.focused_pane_id)
      ?? panes.find((pane) => pane.focused)
      ?? panes[0]!;
  };

  const closeMenu = useCallback(() => setMenu(null), []);

  // A close takes the workspace with it, so it asks first, as herdr's ui.confirm_close does.
  // The row is gone afterwards, so focus moves to the header's workspace-list toggle.
  const leave = async (close: () => Promise<void>): Promise<void> => {
    await close();
    setConfirm(null);
    focusWorkspaceListToggle();
  };

  const menuItems = (state: MenuState): RowMenuItem[] => {
    // the roster may have moved on since the menu opened (a pane closed from another client):
    // what an item does follows the latest snapshot, not what the row showed at the click
    const workspace = snapshot?.workspaces.find((candidate) => candidate.workspace_id === state.workspace.workspace_id) ?? state.workspace;
    const panes = snapshot?.panes.filter((pane) => pane.workspace_id === workspace.workspace_id) ?? [];
    const paneCount = Math.max(1, panes.length);
    // the pane the row showed may have closed under the open menu: the items then act on the
    // pane the row shows now, never on an id herdr no longer has
    const pane = panes.find((candidate) => candidate.pane_id === state.pane.pane_id) ?? (panes.length > 0 ? currentPane(workspace, panes) : state.pane);
    // a worktree workspace: its checkout can be deleted; the repository's workspace: its open
    // worktree workspaces close with it, which herdr refuses without close_group
    const linked = workspace.worktree?.is_linked_worktree === true;
    const worktrees = linked ? [] : (snapshot?.workspaces.filter((candidate) => candidate.worktree?.is_linked_worktree && candidate.worktree.repo_key === workspace.worktree?.repo_key) ?? []);
    // herdr's own actions on a workspace: rename, a new tab (prefix+c), its worktrees (prefix+shift+g), close
    const items: RowMenuItem[] = [
      { id: "rename-workspace", label: t("Rename workspace"), icon: Pencil, run: () => beginWorkspaceRename(workspace, state.scope) },
      { id: "rename-pane", label: t("Rename pane"), icon: Pencil, run: () => beginPaneRename(pane) },
      { id: "new-tab", label: t("New tab"), icon: Plus, run: () => actions.openNewTab({ machineId, workspaceId: workspace.workspace_id }) },
      ...(linked ? [] : [
        { id: "new-worktree", label: t("New worktree"), icon: GitBranch, run: () => setWorktreeDialog({ mode: "create", workspace }) },
        { id: "open-worktree", label: t("Open worktree…"), icon: FolderOpen, run: () => setWorktreeDialog({ mode: "open", workspace }) },
      ] satisfies RowMenuItem[]),
    ];
    const deleteItems: RowMenuItem[] = linked ? [{
      id: "delete-worktree", label: t("Delete worktree checkout…"), icon: Trash2, danger: true,
      run: () => setConfirm({
        title: t("Delete the checkout of {name}?", { name: workspace.label }),
        body: t("The folder at {path} is deleted and the workspace closes. The branch stays.", { path: workspace.worktree?.checkout_path ?? "" }),
        action: t("Delete"),
        run: () => leave(async () => { await removeWorktree({ workspace_id: workspace.workspace_id }); }),
        // git refuses a checkout with unsaved changes: the refusal shows, and the action becomes a forced one
        escalation: { label: t("Delete anyway"), code: "dirty_worktree_requires_force", run: () => leave(async () => { await removeWorktree({ workspace_id: workspace.workspace_id, force: true }); }) },
      }),
    }] : [];
    // a lone pane takes its workspace with it; a row with several panes closes them all; a
    // repository's open worktree workspaces go with either
    const closeItem: RowMenuItem = paneCount === 1
      ? { id: "close", label: t("Close"), icon: X, danger: true, divider: true, run: () => setConfirm({
          title: t("Close {title}?", { title: state.title }),
          body: worktrees.length > 0 ? t("Its workspace and its {m} worktree workspaces close with it; the agents in them stop, and the checkouts stay.", { m: worktrees.length }) : t("Its workspace closes with it, and the agent and shell in it stop."),
          run: () => leave(() => worktrees.length > 0 ? closeWorkspace(workspace.workspace_id, true) : closePane(pane.pane_id)),
        }) }
      : { id: "close", label: t("Close workspace"), icon: X, danger: true, divider: true, run: () => setConfirm({
          title: t("Close workspace {name}?", { name: workspace.label }),
          body: worktrees.length > 0 ? t("{n} panes and {m} worktree workspaces close with it; the agents in them stop, and the checkouts stay.", { n: paneCount, m: worktrees.length }) : t("{n} panes close with it, and the agents in them stop.", { n: paneCount }),
          run: () => leave(() => closeWorkspace(workspace.workspace_id, worktrees.length > 0)),
        }) };
    return [...items, closeItem, ...deleteItems];
  };

  // the roster moves under an open menu: a row that left takes its menu with it, and focus
  // goes where a closed row's focus goes
  useEffect(() => {
    if (!menu) return;
    const alive = snapshot?.workspaces.some((workspace) => workspace.workspace_id === menu.workspace.workspace_id);
    if (alive && menu.anchor.isConnected) return;
    setMenu(null);
    focusWorkspaceListToggle();
  });

  const beginPaneRename = (pane: PaneInfo): void => {
    setEditingPaneId(pane.pane_id);
    setPaneLabel(pane.label ?? "");
  };

  const savePaneRename = (pane: PaneInfo): void => {
    const label = paneLabel.trim();
    setEditingPaneId(null);
    void renamePane(pane.pane_id, label).catch((reason: unknown) => {
      noteError(t("Rename failed: {reason}", { reason: reason instanceof Error ? reason.message : String(reason) }), pane.workspace_id);
    });
  };

  // By folder, one workspace can show under several folders: only the copy that was clicked edits.
  // Two mounted inputs would take the focus from each other, and the blur closes both.
  const beginWorkspaceRename = (workspace: WorkspaceInfo, scope: string): void => {
    setEditingWorkspaceId(`${scope}\u0000${workspace.workspace_id}`);
    setWorkspaceLabel(workspace.label);
  };

  const saveWorkspaceRename = (workspaceId: string): void => {
    const label = workspaceLabel.trim();
    setEditingWorkspaceId(null);
    void renameWorkspace(workspaceId, label).catch((reason: unknown) => {
      noteError(t("Rename failed: {reason}", { reason: reason instanceof Error ? reason.message : String(reason) }), workspaceId);
    });
  };

  const reorderWorkspace = (workspaceId: string, insertIndex: number): void => {
    const sourceIndex = workspaceOrder.indexOf(workspaceId);
    if (sourceIndex < 0) return;
    const boundedIndex = Math.max(0, Math.min(workspaceOrder.length - 1, insertIndex));
    if (sourceIndex === boundedIndex) return;
    const previous = workspaceOrder;
    const next = [...workspaceOrder];
    next.splice(sourceIndex, 1);
    next.splice(boundedIndex, 0, workspaceId);
    setWorkspaceOrder(next);
    void moveWorkspace(workspaceId, boundedIndex).catch((reason: unknown) => {
      setWorkspaceOrder(previous);
      noteError(t("Reorder failed: {reason}", { reason: reason instanceof Error ? reason.message : String(reason) }));
    });
  };

  const onDragStart = (event: DragEvent<HTMLElement>, workspaceId: string): void => {
    setDragWorkspaceId(workspaceId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-herdr-workspace", JSON.stringify({ machine_id: machineId, workspace_id: workspaceId }));
  };

  const onDrop = (event: DragEvent<HTMLElement>, targetWorkspaceId: string): void => {
    event.preventDefault();
    let payload: { machine_id?: string; workspace_id?: string };
    try { payload = JSON.parse(event.dataTransfer.getData("application/x-herdr-workspace")); } catch { return; }
    if (payload.machine_id !== machineId || typeof payload.workspace_id !== "string") return;
    const sourceId = dragWorkspaceId ?? payload.workspace_id;
    setDragWorkspaceId(null);
    const index = dropIndex(sourceId, targetWorkspaceId);
    if (index !== null) reorderWorkspace(sourceId, index);
  };

  // The roster shows groups: a repository's workspace moves past the next or previous group as
  // one (herdr keeps its worktrees packed behind it), and a worktree moves among its siblings.
  // The index herdr gets is the edge of the group the move lands on. By folder keeps the flat order.
  const moveVisible = (workspaceId: string, direction: -1 | 1): void => {
    if (byFolder) { reorderWorkspace(workspaceId, workspaceOrder.indexOf(workspaceId) + direction); return; }
    const groupIndex = worktreeGroups.findIndex((group) => group.workspace.workspace_id === workspaceId);
    if (groupIndex >= 0) {
      const target = worktreeGroups[groupIndex + direction];
      if (!target) return;
      const edge = direction === 1 ? (target.children[target.children.length - 1] ?? target.workspace) : target.workspace;
      reorderWorkspace(workspaceId, workspaceOrder.indexOf(edge.workspace_id));
      return;
    }
    const parent = worktreeGroups.find((group) => group.children.some((child) => child.workspace_id === workspaceId));
    if (!parent) return;
    const sibling = parent.children[parent.children.findIndex((child) => child.workspace_id === workspaceId) + direction];
    if (sibling) reorderWorkspace(workspaceId, workspaceOrder.indexOf(sibling.workspace_id));
  };

  /** where a dropped workspace lands, in the flat order, or nowhere when the drop crosses a group's edge */
  const dropIndex = (sourceId: string, targetId: string): number | null => {
    if (byFolder) return workspaceOrder.indexOf(targetId);
    const sourceGroup = worktreeGroups.find((group) => group.workspace.workspace_id === sourceId);
    if (sourceGroup) {
      const targetGroup = worktreeGroups.find((group) => group.workspace.workspace_id === targetId || group.children.some((child) => child.workspace_id === targetId));
      if (!targetGroup || targetGroup === sourceGroup) return null;
      const movingDown = workspaceOrder.indexOf(sourceId) < workspaceOrder.indexOf(targetGroup.workspace.workspace_id);
      const edge = movingDown ? (targetGroup.children[targetGroup.children.length - 1] ?? targetGroup.workspace) : targetGroup.workspace;
      return workspaceOrder.indexOf(edge.workspace_id);
    }
    const parent = worktreeGroups.find((group) => group.children.some((child) => child.workspace_id === sourceId));
    return parent && parent.children.some((child) => child.workspace_id === targetId) ? workspaceOrder.indexOf(targetId) : null;
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, workspaceId: string): void => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    moveVisible(workspaceId, event.key === "ArrowUp" ? -1 : 1);
  };

  const renderWorkspace = (workspace: WorkspaceInfo, visiblePanes: PaneInfo[], scope = "") => {
    if (visiblePanes.length === 0) return null;
    const pane = currentPane(workspace, visiblePanes);
    const fullTitle = paneTitle(pane);
    const displayTitle = displayPaneTitle(pane);
    // Under a folder header the row names the workspace. By workspace it names the workspace
    // and the folder, each only when the title or the other does not already say it.
    const folder = cwdBasename(pane.cwd);
    const said = folder === displayTitle || folder === workspace.label;
    const place = byFolder ? workspace.label : placeLine(workspace.label === displayTitle ? "" : workspace.label, said ? "" : folder);
    const selected = visiblePanes.some((candidate) => candidate.pane_id === selectedPaneId);
    const editingPane = editingPaneId === pane.pane_id;
    const editingWorkspace = editingWorkspaceId === `${scope}\u0000${workspace.workspace_id}`;
    const menuOpen = menu?.workspace.workspace_id === workspace.workspace_id && menu.scope === scope;
    return (
      <li
        className={`workspace pane-item${dragWorkspaceId === workspace.workspace_id ? " is-dragging" : ""}${selected ? " is-selected" : ""}`}
        key={workspace.workspace_id}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => onDrop(event, workspace.workspace_id)}
      >
        <div className="pane-row">
          <button
            type="button"
            className="sidebar-drag-handle"
            aria-label={t("Reorder workspace {name}", { name: workspace.label })}
            title={t("Drag to reorder · Alt+↑/↓")}
            draggable
            onDragStart={(event) => onDragStart(event, workspace.workspace_id)}
            onDragEnd={() => setDragWorkspaceId(null)}
            onKeyDown={(event) => onHandleKeyDown(event, workspace.workspace_id)}
          >
            <GripVertical aria-hidden="true" />
          </button>
          <div
            className="pane-select"
            role="button"
            tabIndex={0}
            aria-current={selected ? "true" : undefined}
            title={`${pane.pane_id} — ${fullTitle}${pane.cwd ? ` — ${pane.cwd}` : ""}`}
            onClick={() => actions.selectPane(pane.pane_id)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              actions.selectPane(pane.pane_id);
            }}
          >
            <span className={`agent-mark-holder${pane.agent ? "" : " is-shell"}`} title={pane.agent ?? t("Shell")}>
              {pane.agent ? <AgentMark agent={pane.agent} size={22} /> : <Terminal aria-hidden="true" />}
            </span>
            <span className="pane-copy">
              <span className="pane-primary">
                {editingPane ? (
                  <input
                    className="input pane-rename-input"
                    aria-label={t("Pane name")}
                    autoFocus
                    value={paneLabel}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setPaneLabel(event.target.value)}
                    onBlur={() => setEditingPaneId(null)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") savePaneRename(pane);
                      if (event.key === "Escape") setEditingPaneId(null);
                    }}
                  />
                ) : (
                  <span className="pane-title">{displayTitle}</span>
                )}
              </span>
              {editingWorkspace ? (
                <input
                  className="input pane-rename-input workspace-rename-input"
                  aria-label={t("Workspace name")}
                  autoFocus
                  value={workspaceLabel}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setWorkspaceLabel(event.target.value)}
                  onBlur={() => setEditingWorkspaceId(null)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") saveWorkspaceRename(workspace.workspace_id);
                    if (event.key === "Escape") setEditingWorkspaceId(null);
                  }}
                />
              ) : (
                <span className="pane-meta">
                  {pane.restore_error ? <RestoreErrorBadge reason={pane.restore_error} /> : <StatusBadge status={rollupStatus(visiblePanes.map((candidate) => candidate.agent_status))} />}
                  <BackgroundBadge count={(pane as HerdrPane).background_tasks} />
                  {place && <span className="pane-subtitle">{place}</span>}
                </span>
              )}
            </span>
          </div>
          <div className="pane-actions">
            <button type="button" className="sidebar-row-action row-menu-toggle" aria-label={t("More for {title}", { title: displayTitle })} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => menuOpen ? setMenu(null) : setMenu({ anchor: event.currentTarget, workspace, pane, scope, title: displayTitle, place: place || workspace.label })}>
              <Ellipsis aria-hidden="true" />
            </button>
          </div>
        </div>
        {inlineError?.workspaceId === workspace.workspace_id && <p className="sidebar-inline-error" role="alert">{inlineError.message}</p>}
      </li>
    );
  };

  return (
    <div className="machine-workspaces">
      <nav className="sidebar-list" aria-label={t("Herdr workspaces")}>
        {!snapshot && <p className="tree-state" role="status">{t("Loading workspaces…")}</p>}
        {snapshot && snapshot.workspaces.length === 0 && (
          <div className="tree-state-empty">
            <p className="tree-state" role="status">{t("No workspaces yet")}</p>
            <button type="button" className="btn" onClick={actions.openNewSession}><Plus aria-hidden="true" />{t("New workspace")}</button>
          </div>
        )}
        {byFolder ? directories.map((directory) => {
          const collapsed = collapsedGroups.has(directory.key);
          const name = directory.path ? cwdBasename(directory.path) : directory.workspaces[0]?.workspace.label;
          return <section className={`directory-group${collapsed ? " is-collapsed" : ""}`} key={directory.key} data-directory={directory.path ?? directory.key}>
            <button type="button" className="directory-header" aria-expanded={!collapsed} aria-label={collapsed ? t("Expand folder {name}", { name: directory.path ?? name ?? "" }) : t("Collapse folder {name}", { name: directory.path ?? name ?? "" })} title={directory.path ?? name} onClick={() => setGroupCollapsed(directory.key, !collapsed)}>
              {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              <Folder aria-hidden="true" />
              <span className="directory-copy"><span className="directory-name">{name}</span>{directory.path && <span className="directory-path">{directory.path}</span>}</span>
              <span className="workspace-number">{directory.paneCount}</span>
            </button>
            {!collapsed && <div className="directory-contents"><ul className="workspace-list">{directory.workspaces.map(({ workspace, panes: visiblePanes }) => renderWorkspace(workspace, visiblePanes, directory.key))}</ul></div>}
          </section>;
        }) : <ul className="workspace-list">{worktreeGroups.map(({ workspace, children }) => (
          <Fragment key={workspace.workspace_id}>
            {renderWorkspace(workspace, roster.filter((pane) => pane.workspace_id === workspace.workspace_id))}
            {/* a repository's worktree workspaces, packed under its row as herdr keeps them; a list of
                their own, beside the row rather than inside it, so a hover or focus on a child row
                does not light the repository's */}
            {children.length > 0 && <li className="worktree-children"><ul className="workspace-list">
              {children.map((child) => renderWorkspace(child, roster.filter((pane) => pane.workspace_id === child.workspace_id)))}
            </ul></li>}
          </Fragment>
        ))}</ul>}
        {inlineError && inlineError.workspaceId === undefined && (
          <p className="sidebar-inline-error" role="alert">{inlineError.message}</p>
        )}
      </nav>
      {menu && <RowMenu anchor={menu.anchor} title={menu.title} subtitle={menu.place} items={menuItems(menu)} onClose={closeMenu} />}
      {confirm && <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.action ?? t("Close")} onConfirm={confirm.run} escalation={confirm.escalation} onClose={() => setConfirm(null)} />}
      {worktreeDialog && <WorktreeDialog mode={worktreeDialog.mode} workspace={worktreeDialog.workspace} onClose={() => setWorktreeDialog(null)} onOpened={(opened) => { setWorktreeDialog(null); actions.selectPane(opened.pane_id); }} />}
    </div>
  );
}
