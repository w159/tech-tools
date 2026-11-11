// sidebar-paint.tsx: PanelLines (mod/panel-layout.ts) as Claude Code elements. A row with a press is a plain Button; every
// run is painted in the live theme's tone on the rev 4 panel token, so the pane meets the band without a seam.
import type { ClientElements, RenderElement } from 'claude-code';
import { surfaceHex, uiFromEnv, type Run, type Ui, runHex } from '../atlas-ui';
import { bodyLines, fillRows, type PanelLine, type PanelModel, type PanelTab } from '../panel-layout';
import { panelModelOf } from './sidebar-model';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

/** One run as a Text on the panel (or on its own fill); with NO_COLOR only bold and strike remain. */
export function runEl(els: ClientElements, x: Run, ui: Ui): RenderElement {
  const base = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strikethrough: true } : {}) };
  return els.Text(ui.color === 'none' ? { ...base, children: x.t } : { ...base, color: runHex(x, ui.theme, ui.color), backgroundColor: surfaceHex(x.bg ?? 'panel', ui), children: x.t });
}
export const panelBg = (ui: Ui): string | undefined => (ui.color === 'none' ? undefined : surfaceHex('panel', ui));

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

/** One tab's body as elements (no strip): the rows, then the message field on team and channel. `pm` is the panel model the
 * caller already built for this frame (sidebarTree builds it once for the ribbon and the body); without it the model is built here. */
export function viewRows(tab: PanelTab, els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number, pm?: PanelModel): RenderElement[] {
  const ui = m.look ?? uiFromEnv();
  const model = pm ?? panelModelOf({ ...m, ui: { ...m.ui, view: tab } }, ui, inner);
  const body = bodyLines(model);
  const fill = fillRows(model, body.length).map(() => lineEl(els, { runs: [{ t: ' ', tone: 'text' }] }, m, on, ui)); // the panel surface down to the foot row
  return [...body.map((l) => lineEl(els, l, m, on, ui)), ...fill, ...(tab === 'team' || tab === 'channel' ? [inputEl(els, m, on)] : [])];
}
