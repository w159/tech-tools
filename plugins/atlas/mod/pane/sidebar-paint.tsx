// sidebar-paint.tsx: PanelLines (mod/panel-layout.ts) as Claude Code elements. A row with a press is a plain Button; every
// run is painted in the live theme's tone on the rev 4 panel token, so the pane meets the band without a seam.
import type { ClientElements, RenderElement } from 'claude-code';
import { fillHex, surfaceHex, uiFromEnv, type Run, type Ui, runHex } from '../atlas-ui';
import { hoverStyle } from '../clickable';
import { bodyLines, fillRows, frameTabOf, type PanelLine, type PanelModel, type PanelTab } from '../panel-layout';
import { panelModelOf } from './sidebar-model';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

/** One run as a Text on the panel (or on its own fill); with NO_COLOR only bold and strike remain. */
export function runEl(els: ClientElements, x: Run, ui: Ui, hoverKey?: string): RenderElement {
  const base = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strikethrough: true } : {}), ...(hoverKey && x.hover ? { hover: hoverStyle(ui, hoverKey) } : {}) };
  return els.Text(ui.color === 'none' ? { ...base, children: x.t } : { ...base, color: runHex(x, ui.theme, ui.color), backgroundColor: fillHex(x, ui), children: x.t }); // a chip's raised tile rides `bgHex`
}
export const panelBg = (ui: Ui): string | undefined => (ui.color === 'none' ? undefined : surfaceHex('panel', ui));

const rowEl = (els: ClientElements, runs: readonly Run[], ui: Ui): RenderElement =>
  els.Box({ flexDirection: 'row', flexShrink: 0, backgroundColor: panelBg(ui), children: (runs.length ? runs : [{ t: ' ', tone: 'text' as const }]).map((x) => runEl(els, x, ui)) }); // a blank layout row is one space: a Box with no child is no row at all, so the design's blank rows vanished on screen

/** A layout row as an element: a Button when the row is pressable. */
export function lineEl(els: ClientElements, l: PanelLine, m: SidebarModel, on: SidebarHandlers, ui: Ui): RenderElement {
  const press = l.press;
  if (!press) return rowEl(els, l.runs, ui);
  if (press.kind === 'compose') return composeEl(els, m, on, ui, l.runs); // the chat tab's chip is the message field (frame spec C1: `✎ message the lead`)
  if (press.kind === 'flip') {
    const flip = (): void => {
      if (press.name) on.selectRecipient(press.name);
      (on.flip ?? on.toggle)(press.key);
    };
    return els.Button({ key: press.key, plain: true, onPress: flip, children: l.runs.map((x) => runEl(els, x, ui, press.key)) });
  }
  const onPress = (): void => {
    if (press.kind === 'worker' && press.name) on.selectRecipient(press.name);
    if (press.copy && m.ui.expanded === press.key) on.copy(press.copy);
    else on.toggle(press.key);
  };
  return els.Button({ key: press.key, plain: true, onPress, children: l.runs.map((x) => runEl(els, x, ui, press.key)) });
}

/** The chat tab's compose chip as a field: it reads as the chip the frame draws until it is typed in. */
function composeEl(els: ClientElements, m: SidebarModel, on: SidebarHandlers, ui: Ui, runs: readonly Run[]): RenderElement {
  const chip = runs.find((x) => x.bgHex !== undefined);
  return els.Box({ flexDirection: 'row', flexShrink: 0, backgroundColor: panelBg(ui), children: [
    ...runs.filter((x) => x !== chip && x.t.trim() === '').map((x) => runEl(els, x, ui)),
    els.Input({ key: 'msg', label: (chip?.t ?? '').trim() || `✎ message the ${m.ui.recipient ?? 'lead'}`, placeholder: '', value: m.ui.draft, onInput: (v: string) => on.draftChange(v), onSubmit: (v: string) => on.send(v) }),
  ] });
}

/** The message field under the team and channel logs. */
export const inputEl = (els: ClientElements, m: SidebarModel, on: SidebarHandlers): RenderElement => els.Input({
  key: 'msg',
  label: `✎ to ${m.ui.recipient ?? 'lead'}`,
  placeholder: 'message',
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
  const fill = fillRows(model, body.length).map((l) => lineEl(els, l.runs.length ? l : { runs: [{ t: ' ', tone: 'text' }] }, m, on, ui)); // the panel surface down to the foot row
  const framed = frameTabOf(model) !== null; // the frame path draws the chat's compose chip itself and the team tab has no field (spec T1-T3, C1-C3)
  return [...body.map((l) => lineEl(els, l, m, on, ui)), ...fill, ...(!framed && (tab === 'team' || tab === 'channel') ? [inputEl(els, m, on)] : [])];
}
