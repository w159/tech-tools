// panel-cards.ts: panel-layout split (audit 4.3, stage S14): card and toast runs.
import { brandMark, cells, meter, percent, stateRun, stateWordTone, type Run, type Tone, type Ui, type UiState } from '../../design/atlas-ui';
import { wordOf } from './pane/activity';
import { r, fitRuns, rowWidth, pad, oneLine, dot, runsText } from './panel-shared';

// ---- worker card (transcript) and toast --------------------------------------------------------------------------------------------------

export type CardModel = {
  state: UiState;
  name: string;
  model?: string;
  goal?: string;
  last?: string;
  /** Steps done / total of the worker's plan. */
  steps?: { done: number; total: number };
  /** Context held, 0..1. */
  ctx?: number;
  ui: Ui;
};
/** Closed boxes are this wide at any terminal width (narrower terminals clip to their own width). */
export const CARD_W = 44;
const BOX = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' };
const BOX_ASCII = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
/** A worker card as rows of runs: `┌─ ◆ running implementer-band ──────── opus ─┐`, rows inside `│ ... │`, a closed bottom. Its width is
 * `min(CARD_W, cols)`; both gauges are the same width (12 cells from 100 columns, 8 below) with a blank row between them, so unequal
 * fills never read as one stepped block. The ATLAS mark leads the title and the state word takes its state tone. */
export function cardLines(c: CardModel, cols = 120): Run[][] {
  const b = c.ui.ascii ? BOX_ASCII : BOX;
  const w = Math.max(20, Math.min(CARD_W, cols));
  const inner = w - 4;
  const g = stateRun(c.state, c.ui);
  const edge = (t: string): Run => r(t, g.tone); // the frame carries the state hue (design: blue while running); the rule between name and tag stays grey
  const body = (runs: Run[]): Run[] => [edge(b.v), r(' '), ...fitRuns(runs, inner), r(' '.repeat(Math.max(0, inner - rowWidth(fitRuns(runs, inner))))), r(' '), edge(b.v)];
  const rowLabel = (t: string): Run => r(pad(t, 6), 'muted');
  const title: Run[] = [r(c.ui.ascii ? '@' : '◆', c.ui.ascii ? 'text' : 'accent', { bold: true }), r(' '), r(c.state, stateWordTone(c.state, c.ui), { bold: true }), r(' '), r(c.name, 'text', { bold: true })];
  const tagW = c.model ? cells(c.model) + 1 : 0;
  // `┌─ ` + title + ` ` + rule + tag + ` ─┐`
  const room = c.model ? w - tagW - 8 : w - 7;
  const titleRuns = fitRuns(title, Math.max(4, room));
  const fill = Math.max(1, w - 3 - rowWidth(titleRuns) - 1 - tagW - (c.model ? 3 : 2));
  const top: Run[] = [edge(`${b.tl}${b.h} `), ...titleRuns, r(' '), r(b.h.repeat(fill), 'line'), ...(c.model ? [r(` ${c.model} `, 'sub'), edge(`${b.h}${b.tr}`)] : [edge(`${b.h}${b.tr}`)])];
  const gaugeW = cols >= 100 ? 12 : 8;
  const rows: Run[][] = [];
  if (c.goal) rows.push(body([rowLabel('goal'), r(oneLine(c.goal))]));
  if (c.last) rows.push(body([rowLabel('last'), r(oneLine(c.last))]));
  const hasSteps = !!c.steps && c.steps.total > 0;
  if (c.steps && hasSteps) {
    const v = c.steps.done / c.steps.total;
    rows.push(body([rowLabel('steps'), ...meter(gaugeW, v, c.ui), r(` ${c.steps.done} of ${c.steps.total} ${dot(c.ui)} ${percent(v)}`)]));
  }
  if (c.ctx !== undefined) {
    if (hasSteps) rows.push(body([])); // gauges on adjacent rows touch and merge into one stepped block
    rows.push(body([rowLabel('ctx'), ...meter(gaugeW, c.ctx, c.ui), r(` ${percent(c.ctx)}`)]));
  }
  return [top, ...rows, [edge(`${b.bl}${b.h.repeat(w - 2)}${b.br}`)]];
}
/** Cells the state word of a rail card (and a toast) takes before the two-cell gap and the name: the widest word is `waiting` / `running` / `blocked`. */
export const CARD_WORD_W = 7;
/** The head of a toast: a left bar in `tone` (`▌`, `|` in ASCII), then, only on a finish card (`brand`), the ATLAS mark. The mark is one grey (dim, 240) wherever it is drawn: the one solid chip belongs
 * to the band, the ribbons and the side panel title carry the brand, and a start card, a failure card, a toast and a note repeat only the name (critique 25: `◆ ATLAS` seven times on one screen, in two greys).
 * The finish card keeps it: the capture scorer locates a card by `▌ ◆ ATLAS  <glyph> done  name  role finished` (live_capture.py :676). */
/** Wave 33 (critique 31: toast bars were 141, 114, 203 and 245 by card kind): every card kind wears the same bar, the accent 141 for its first second and the secondary grey 245 after (`fade` 0..1 from the card's age, half and over is the grey). */
export const cardBarTone = (fade: number): Tone => (fade >= 0.5 ? 'sub' : 'accent');
const toastHead = (fade: number, ui: Ui, brand = false): Run[] => [r(ui.ascii ? '|' : '▌', ui.ascii ? 'text' : cardBarTone(fade)), r(' '), ...(!brand ? [] : ui.ascii ? brandMark(ui) : [r('◆ ', 'accent'), r('ATLAS', 'accent')]), ...(brand ? [r('  ')] : [])];
/** `▌ ◆ ATLAS  ● done  implementer-layout  9 of 9 steps` (a finish card, `brand`) or `▌ ◐ running  implementer-layout  what it does`: the bar and the state word in the state's tone, the state, the
 * name, one fact. No full stop. */
export function toastRuns(state: UiState, name: string, fact: string, ui: Ui, brand = false, frame = 0, fade = 0): Run[] {
  // Wave 32 (critique 30: the start card's `◐` was a static half circle): a running card wears the band's spinner in 141, turning with `frame`.
  const g = state === 'running' && !ui.ascii ? { ...stateRun('running', ui, frame), tone: 'accent' as const } : stateRun(state, ui, frame);
  // Design rev 5, C3: the state word sits in a fixed-width column (CARD_WORD_W), so the name starts at the same cell on every card; `failed` is the one failure word.
  return [...toastHead(fade, ui, brand), { ...g, t: `${g.t} ` }, r(wordOf(state), stateWordTone(state, ui), { bold: true }), r(`${' '.repeat(Math.max(0, CARD_WORD_W - cells(state)) + 2)}${name}`), ...(fact ? [r(`  ${oneLine(fact)}`, 'sub')] : [])];
}
export const toastText = (state: UiState, name: string, fact: string, ui: Ui): string => runsText(toastRuns(state, name, fact, ui));
/** A note toast: the same head in the note grey (245), the word `note`, the sender, a preview. */
export function noteToastRuns(sender: string, preview: string, ui: Ui, fade = 0): Run[] {
  return [...toastHead(fade, ui), r('note', 'text', { bold: true }), r(`  ${sender}`), ...(preview ? [r(`  ${oneLine(preview)}`, 'sub')] : [])];
}
export const noteToastText = (sender: string, preview: string, ui: Ui): string => runsText(noteToastRuns(sender, preview, ui));
