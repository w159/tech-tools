// Shared sidebar model types and the one padding helper the section builders use.
import type { LiveSnapshot } from '../orchestra-types';
import type { ClientElements, RenderElement } from 'claude-code';
import { rowOf, type Segment } from '../runs';
import { textWidth } from '../theme';

export type GateLine = { id: string; label: string; ok: boolean; detail?: string; fix?: string };
export type GateGroup = { id: 'completion' | 'tripwire' | 'routing' | 'header'; title: string; lines: GateLine[]; error?: string };
export type SidebarModel = {
  snapshot: LiveSnapshot;
  gates: GateGroup[];
  ui: { recipient: string | null; expanded: string | null; draft: string };
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
  /** Move the keyboard focus ring onto the element drawn under `key` (hotkey `m`). */
  focus(key: string): void;
  /** Expand `key` (never collapse it) and focus it (hotkey `g`). */
  expand(key: string): void;
};

export const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - textWidth(s)));

/** A section header: bold name at the left, a muted summary pushed to the right edge (dropped when there is no room). */
export function headRow(els: ClientElements, left: Segment[], right: Segment | null, cols: number): RenderElement {
  const gap = right ? cols - left.reduce((n, p) => n + textWidth(p.t), 0) - textWidth(right.t) : 0;
  return rowOf(els, right && gap >= 1 ? [...left, { t: ' '.repeat(gap) }, right] : left, cols);
}

export type Hotkey = { key: string; label: string; onPress(): void };

/** A section header with a plain hotkey Button at the right edge (drawn `m: message`); the summary yields to it. */
export function hotkeyHead(els: ClientElements, left: Segment[], right: Segment | null, hk: Hotkey, cols: number): RenderElement {
  const w = textWidth(`${hk.key}: ${hk.label}`);
  return els.Box({
    flexDirection: 'row',
    flexShrink: 0,
    children: [
      headRow(els, left, right, Math.max(1, cols - w - 1)),
      els.Text({ children: ' ' }),
      els.Button({ key: `hotkey:${hk.key}`, plain: true, hotkey: hk.key, label: hk.label, dimColor: true, onPress: hk.onPress }),
    ],
  });
}
