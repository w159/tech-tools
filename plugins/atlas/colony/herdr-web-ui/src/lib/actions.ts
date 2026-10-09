/**
 * What the shell lets its surfaces do. App builds one AppActions object and hands it
 * to the header, the sidebar, the command palette and the settings dialog, so a
 * keyboard shortcut, a palette row and a sidebar button all run the same code.
 */

export type PaneView = "chat" | "terminal";

export interface AppActions {
  selectPane: (paneId: string) => void;
  /** the previous/next pane in sidebar order; wraps around */
  selectAdjacentPane: (direction: -1 | 1) => void;
  setView: (view: PaneView) => void;
  toggleView: () => void;
  openNewSession: () => void;
  /**
   * The New tab dialog for a workspace: the named one (a sidebar row's menu, on its own PC),
   * else the selected pane's. Nothing happens without a workspace to add the tab to.
   */
  openNewTab: (target?: { machineId: string; workspaceId: string }) => void;
  openPalette: () => void;
  openSettings: () => void;
  /** the Add PC dialog, from Settings → Remote PCs and the palette; Settings closes first */
  openAddPc: () => void;
  toggleSidebar: () => void;
  /** flips dark/light (a `system` setting becomes the opposite of the resolved theme) */
  toggleTheme: () => void;
  /** Sign out of token/device authentication; null for automatic local/Tailscale access. */
  lock: (() => void) | null;
  /** null once alerts are on (or unsupported); otherwise asks for permission */
  enableNotifications: (() => void) | null;
  refresh: () => void;
  /** null without a pane: the files of its folder, each opened in the file viewer */
  openFiles: (() => void) | null;
}
