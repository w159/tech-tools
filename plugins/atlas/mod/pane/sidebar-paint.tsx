// sidebar-paint.tsx: PanelLines (mod/panel-layout.ts) as Claude Code elements. A row with a press is a plain Button; every
// run is painted in the live theme's tone on the rev 4 panel token, so the pane meets the band without a seam.
import type { ClientElements, RenderElement } from 'claude-code';
import { PALETTES, toneHex, uiFromEnv, type Run, type Ui } from '../atlas-ui';
import { bodyLines, type PanelLine, type PanelTab } from '../panel-layout';
import { panelModelOf } from './sidebar-model';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

/** One run as a Text on the panel (or on its own fill); with NO_COLOR only bold and strike remain. */
export function runEl(els: ClientElements, x: Run, ui: Ui): RenderElement {
  const p = PALETTES[ui.theme];
  const base = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strikethrough: true } : {}) };
  return els.Text(ui.color === 'none' ? { ...base, children: x.t } : { ...base, color: toneHex(x.tone, ui.theme), backgroundColor: x.bg ? p[x.bg] : p.panel, children: x.t });
}
export const panelBg = (ui: Ui): string | undefined => (ui.color === 'none' ? undefined : PALETTES[ui.theme].panel);

const rowEl = (els: ClientElements, runs: readonly Run[], ui: Ui): RenderElement =>
  els.Box({ flexDirection: 'row', flexShrink: 0, backgroundColor: panelBg(ui), children: runs.map((x) => runEl(els, x, ui)) });

/** A layout row as an element: a Button when the row is pressable. */
export function lineEl(els: ClientElements, l: PanelLine, m: SidebarModel, on: SidebarHandlers, ui: Ui): RenderElement {
  const press = l.press;
  if (!press) return rowEl(els, l.runs, ui);
  const onPress = (): void => {
    if (press.kind === 'worker' && press.name) on.selectRecipient(press.name);
    if (press.copy && m.ui.expanded === press.key) on.copy(press.copy);
    else on.toggle(press.key);
  };
  return els.Button({ key: press.key, plain: true, onPress, children: l.runs.map((x) => runEl(els, x, ui)) });
}

/** The message field under the team and channel logs. */
export const inputEl = (els: ClientElements, m: SidebarModel, on: SidebarHandlers): RenderElement => els.Input({
  key: 'msg',
  label: `▸ to ${m.ui.recipient ?? 'lead'}`,
  placeholder: 'message · Enter sends',
  value: m.ui.draft,
  onInput: (v: string) => on.draftChange(v),
  onSubmit: (v: string) => on.send(v),
});

/** One tab's body as elements (no strip): the rows, then the message field on team and channel. */
export function viewRows(tab: PanelTab, els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] {
  const ui = uiFromEnv();
  const pm = { ...panelModelOf({ ...m, ui: { ...m.ui, view: tab } }, ui, inner) };
  return [...bodyLines(pm).map((l) => lineEl(els, l, m, on, ui)), ...(tab === 'team' || tab === 'channel' ? [inputEl(els, m, on)] : [])];
}
