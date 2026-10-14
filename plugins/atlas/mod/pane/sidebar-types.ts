// Shared sidebar model types and the one padding helper the section builders use.
import type { LiveSnapshot } from '../orchestra-types';
import { textWidth } from '../theme';

export type GateLine = { id: string; label: string; ok: boolean; detail?: string; fix?: string };
export type GateGroup = { id: 'completion' | 'tripwire' | 'routing' | 'header'; title: string; lines: GateLine[]; error?: string };
export type SidebarView = 'team' | 'channel' | 'route' | 'gates';
export type SidebarModel = {
  snapshot: LiveSnapshot;
  gates: GateGroup[];
  ui: { recipient: string | null; expanded: string | null; draft: string; view: SidebarView };
  columns: number;
  rows: number;
  /** Spinner tick the render reads (never writes); animates working badges. */
  tick?: number;
};
export type SidebarHandlers = {
  selectRecipient(name: string): void;
  toggle(key: string): void;
  draftChange(text: string): void;
  send(text: string): void;
  copy(text: string): void;
  /** Move the keyboard focus ring onto the element drawn under `key` (no hotkey: reached with Tab and the arrows). */
  focus(key: string): void;
  /** Expand `key` (never collapse it) and focus it (no hotkey: a row press). */
  expand(key: string): void;
  /** Switch the pane view (hotkeys r/t/c/g). */
  setView(v: SidebarView): void;
  /** Collapse or expand the band's board panel (hotkey `o`); absent in fixtures that do not wire it. */
  toggleTodos?(): void;
};

export const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - textWidth(s)));
