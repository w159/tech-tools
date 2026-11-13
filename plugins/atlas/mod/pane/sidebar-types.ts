// Shared sidebar model types and the one padding helper the section builders use.
import type { CoreModel } from '../data/core';
import type { Ui } from '../atlas-ui';
import type { MotionCtx } from '../motion';
import type { LiveSnapshot } from '../orchestra-types';
import { textWidth } from '../theme';

export type GateLine = { id: string; label: string; ok: boolean; detail?: string; fix?: string };
export type GateGroup = { id: 'completion' | 'tripwire' | 'routing' | 'header'; title: string; lines: GateLine[]; error?: string };
export type SidebarView = 'team' | 'channel' | 'route' | 'gates' | 'core' | 'board';
export type SidebarModel = {
  snapshot: LiveSnapshot;
  gates: GateGroup[];
  /** The Atlas core (contract, verdicts, offload, routes); the g view draws it above the gate groups. */
  core?: CoreModel | null;
  ui: { recipient: string | null; expanded: string | null; draft: string; view: SidebarView };
  /** Theme, ASCII and colour depth as the host reported them once (mod/look.ts); absent in fixtures, which read the host environment. */
  look?: Ui;
  columns: number;
  rows: number;
  /** Spinner tick the render reads (never writes); animates working badges. */
  tick?: number;
  /** Motion view (mod/motion.ts): rows with an entry are drawn mid-transition. Absent: the resting render. */
  motion?: MotionCtx | undefined;
  /** The band's run state and run clock (register.ts builds them from the band's own inputs, pane/band-kind.ts): the panel prints the same word and the same total. */
  /** The shared clock reading the HUD times a running agent on (`$.clock.now()`): the lanes read the same figure as the SUBAGENTS rows (truth 41: alpha 0:16 against 0:17 on one frame). */
  clock?: number;
  run?: { kind: 'working' | 'idle' | 'done' | 'blocked'; secs?: number; startMs?: number; frame?: number };
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
