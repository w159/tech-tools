// clickable.ts: the one look of a clickable control (wave 42). Accent text, a leading chevron (`▸` closed, `▾` open) and a hover style: plain text never wears the
// accent + chevron pair, so a person can tell what answers a click. The band's and the panel's painters read a run's `press` key and draw it as a Button with `hoverStyle`.
import { type Run, type Ui, xtermHex } from './atlas-ui';

/** The chevron of a control: `▸` closed, `▾` open (ASCII `>` and `v`). */
export const chevron = (open: boolean, ui: Pick<Ui, 'ascii'>): string => (ui.ascii ? (open ? 'v' : '>') : open ? '▾' : '▸');

/** A control's label as one run: the chevron, a space, the label, in the accent and bold, keyed `key` for the painter. */
export const clickRun = (label: string, open: boolean, ui: Pick<Ui, 'ascii'>, key: string, extra: Partial<Run> = {}): Run =>
  ({ t: `${chevron(open, ui)} ${label}`, tone: 'accent', bold: true, press: key, hover: true, ...extra });

/** The host `hover` style of a control's Text: a lighter fill and an underline under the pointer (the hover scope is the control's own key, so the whole label lights together). */
export function hoverStyle(ui: Pick<Ui, 'color'>, key: string): { backgroundColor?: string; underline: true; scope: string } {
  return { ...(ui.color === 'none' ? {} : { backgroundColor: xtermHex(238) }), underline: true, scope: key.slice(0, 64) };
}

/** The fill under an idle tab chip: a raised tile one step off the panel, so a chip reads as a button and not as coloured text (the lit chip is filled with the accent, inverse). With no colour the chip is underlined instead. */
export function chipStyle(ui: Pick<Ui, 'color' | 'theme'>): { backgroundColor?: string; underline?: true } {
  if (ui.color === 'none') return { underline: true };
  return { backgroundColor: xtermHex(ui.theme === 'latte' ? 253 : 237) };
}
