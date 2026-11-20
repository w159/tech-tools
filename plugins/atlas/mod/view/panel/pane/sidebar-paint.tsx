// sidebar-paint.tsx: PanelLines (mod/view/panel/panel-layout.ts) as Claude Code elements. A row with a press is a plain Button; every
// run is painted in the live theme's tone on the rev 4 panel token, so the pane meets the band without a seam.
import type { ClientElements, RenderElement } from 'claude-code';
import { fillHex, surfaceHex, type Run, type Ui, runHex } from '../../../design/atlas-ui'; import { lookUi } from '../../../design/look';
import { hoverStyle } from '../../../input/clickable';
import { bodyLines, fillRows, type PanelLine, type PanelModel, type PanelTab } from '../panel-layout';
import { panelModelOf } from './sidebar-model';
import type { SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

/** One run as a Text on the panel (or on its own fill); with NO_COLOR only bold and strike remain. */
export function runEl(els: ClientElements, x: Run, ui: Ui, hoverKey?: string): RenderElement {
  const base = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strikethrough: true } : {}), ...(hoverKey && x.hover ? { hover: hoverStyle(ui, hoverKey) } : {}) };
  return els.Text(ui.color === 'none' ? { ...base, children: x.t } : { ...base, color: runHex(x, ui.theme, ui.color), backgroundColor: fillHex(x, ui), children: x.t }); // a chip's raised tile rides `bgHex`
}
export const panelBg = (ui: Ui): string | undefined => (ui.color === 'none' ? undefined : surfaceHex('panel', ui));

/** The recipient chip's press key (`to:<name>`): a press picks the name as the message's recipient. */
const TO_PREFIX = 'to:';
const rowEl = (els: ClientElements, runs: readonly Run[], ui: Ui, on?: SidebarHandlers): RenderElement => {
  const kids = (runs.length ? runs : [{ t: ' ', tone: 'text' as const }]).map((x) => {
    const key = x.press;
    if (!on || !key?.startsWith(TO_PREFIX)) return runEl(els, x, ui);
    return els.Button({ key, plain: true, onPress: () => on.selectRecipient(key.slice(TO_PREFIX.length)), children: [runEl(els, x, ui, key)] }); // a chip of the row: its own Button
  });
  return els.Box({ flexDirection: 'row', flexShrink: 0, backgroundColor: panelBg(ui), children: kids }); // a blank layout row is one space: a Box with no child is no row at all, so the design's blank rows vanished on screen
};

/** A layout row as an element: a Button when the row is pressable. */
export function lineEl(els: ClientElements, l: PanelLine, m: SidebarModel, on: SidebarHandlers, ui: Ui, cols?: number): RenderElement {
  const press = l.press;
  if (!press) return rowEl(els, l.runs, ui, on);
  if (press.kind === 'compose') return composeEl(els, m, on, ui, l.runs, cols ?? Math.max(10, m.columns - 1)); // the chat tab's field: a bordered input (mock `chat`)
  if (press.kind === 'flip') {
    const flip = (): void => {
      if (press.name) on.selectRecipient(press.name);
      (on.flip ?? on.toggle)(press.key);
    };
    return els.Button({ key: press.key, plain: true, onPress: flip, children: l.runs.map((x) => runEl(els, x, ui, press.key)) });
  }
  if (press.kind === 'goto') return els.Button({ key: `goto:${press.key}`, plain: true, onPress: () => on.setView(press.key as SidebarView), children: l.runs.map((x) => runEl(els, x, ui, `goto:${press.key}`)) });
  const onPress = (): void => {
    if (press.kind === 'worker' && press.name) on.selectRecipient(press.name);
    if (press.copy && m.ui.expanded === press.key) on.copy(press.copy);
    else on.toggle(press.key);
  };
  return els.Button({ key: press.key, plain: true, onPress, children: l.runs.map((x) => runEl(els, x, ui, press.key)) });
}

/** The chat's message field: one round-bordered box the width of the pane holding the `›` prompt and the input (its placeholder is the hint the layout row prints). The layout's three rows (top edge, field, bottom edge) are this one box, so the edges draw nothing (`isComposeEdge`). */
function composeEl(els: ClientElements, m: SidebarModel, on: SidebarHandlers, ui: Ui, runs: readonly Run[], cols: number): RenderElement {
  const hint = runs.find((x) => x.tone === 'muted' && x.t.trim() !== '')?.t ?? `Message the ${m.ui.recipient ?? 'lead'}`;
  const border = ui.color === 'none' ? {} : { borderColor: runHex({ tone: 'dim' }, ui.theme, ui.color) };
  return els.Box({
    flexDirection: 'column', flexShrink: 0, backgroundColor: panelBg(ui), children: [
      els.Box({
        flexDirection: 'row', flexShrink: 0, marginLeft: 1, width: Math.max(10, cols - 1), borderStyle: 'round', ...border, backgroundColor: panelBg(ui), children: [
          els.Input({ key: 'msg', label: ui.ascii ? '>' : '›', placeholder: hint, value: m.ui.draft, onInput: (v: string) => on.draftChange(v), onSubmit: (v: string) => on.send(v) }),
        ],
      }),
    ],
  });
}
/** The top and bottom edge rows of the message field: the box above draws them. */
export const isComposeEdge = (l: PanelLine): boolean => l.press?.kind === 'compose' && l.press.key === 'compose:edge';

/** The message field under the team and channel logs. */
export const inputEl = (els: ClientElements, m: SidebarModel, on: SidebarHandlers): RenderElement => els.Input({
  key: 'msg',
  label: `✎ to ${m.ui.recipient ?? 'lead'}`,
  placeholder: 'message',
  value: m.ui.draft,
  onInput: (v: string) => on.draftChange(v),
  onSubmit: (v: string) => on.send(v),
});

/** One tab's body as elements (no strip): the rows, the panel surface down to the foot row. `pm` is the panel model the
 * caller already built for this frame (sidebarTree builds it once for the header and the body); without it the model is built here. */
export function viewRows(tab: PanelTab, els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number, pm?: PanelModel): RenderElement[] {
  const ui = m.look ?? lookUi();
  const model = pm ?? panelModelOf({ ...m, ui: { ...m.ui, view: tab } }, ui, inner);
  const body = bodyLines(model);
  const fill = fillRows(model, body.length).map((l) => lineEl(els, l.runs.length ? l : { runs: [{ t: ' ', tone: 'text' }] }, m, on, ui, model.cols)); // the panel surface down to the foot row
  return [...body.filter((l) => !isComposeEdge(l)).map((l) => lineEl(els, l, m, on, ui, model.cols)), ...fill];
}
