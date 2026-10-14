// Shared-board panel for the band: collapsed it is one gradient progress bar (violet to teal) with
// done/total and the in-progress item; expanded it is one row per item (state glyph, owner chip,
// content, evidence), capped by the row budget with a `+N more` row. Pure: rows in, Segment rows out.
// The shimmer (a bright cell sweeping the filled bar) and the in-progress glyph follow the spinner tick.
import type { TodoItem } from './contract';
import { chip, merge, padRow, seg } from './paint';
import type { Segment } from './runs';
import { fitText, MOCHA as M, mix, spin, textWidth } from './theme';

export type TodoPanelOpts = { cols: number; tick: number; expanded: boolean; maxRows: number };

const EIGHTHS = ' ▏▎▍▌▋▊▉█';
const GLYPH: Record<string, [string, string]> = { pending: ['○', M.muted], completed: ['✔', M.green], blocked: ['✖', M.red] };

const glyphOf = (status: string, tick: number): Segment => {
  if (status === 'in_progress') return seg(spin(tick), M.yellow);
  const [ch, color] = GLYPH[status] ?? GLYPH.pending!;
  return seg(ch, color);
};

/** `width` cells filled `frac`, violet to teal; one cell of the filled part is lit and moves with `tick`. */
function bar(frac: number, width: number, tick: number, pulse: boolean): Segment[] {
  const cells = Math.max(0, Math.min(1, frac)) * width;
  const whole = Math.floor(cells);
  const part = Math.floor((cells - whole) * 8);
  const lit = pulse && whole > 0 ? tick % whole : -1;
  return merge(Array.from({ length: width }, (_, i) => {
    const ch = i < whole ? '█' : i === whole ? EIGHTHS[part] ?? ' ' : ' ';
    const base = mix(M.violet, M.teal, i / Math.max(1, width - 1));
    return { t: ch, color: ch === ' ' ? M.dim : i === lit ? mix(base, M.white, 0.6) : base, bg: M.panel2 };
  }));
}

const runsWidth = (parts: Segment[]): number => textWidth(parts.map((p) => p.t).join(''));

function collapsed(items: TodoItem[], o: TodoPanelOpts): Segment[] {
  const done = items.filter((i) => i.status === 'completed').length;
  const cur = items.find((i) => i.status === 'in_progress');
  const barW = Math.max(6, Math.min(24, Math.floor(o.cols / 4)));
  const head = [seg(' '), seg('board ', M.muted), ...bar(done / items.length, barW, o.tick, !!cur), seg(` ${done}/${items.length} `, M.text, M.panel, true)];
  const room = o.cols - runsWidth(head) - 1;
  const tail = cur && room > 6
    ? [glyphOf('in_progress', o.tick), seg(` ${fitText(`${cur.owner ? `${cur.owner}: ` : ''}${cur.content}`, room - 2)}`, M.text)]
    : [];
  return padRow(fitRow([...head, ...tail], o.cols), o.cols);
}

/** Cut a row to `cols` cells (narrow widths); runs are never split mid-run, so shorten the last ones. */
function fitRow(parts: Segment[], cols: number): Segment[] {
  const out: Segment[] = [];
  let used = 0;
  for (const p of parts) {
    const w = textWidth(p.t);
    if (used + w <= cols) { out.push(p); used += w; continue; }
    const left = cols - used;
    if (left > 0) out.push({ ...p, t: fitText(p.t, left) });
    break;
  }
  return out;
}

function itemRow(i: TodoItem, o: TodoPanelOpts): Segment[] {
  const owner = i.owner ? [chip(fitText(i.owner, 14).padEnd(10), i.status === 'in_progress' ? M.yellow : M.panel2), seg(' ')] : [seg(' '.repeat(13))];
  const head = [seg(' '), glyphOf(i.status, o.tick), seg(' '), ...owner];
  const ev = i.evidence ? i.evidence.replace(/^\s*\d+[.)]\s*/, '').replace(/\s+/g, ' ') : '';
  const room = o.cols - runsWidth(head) - 1;
  const content = fitText(i.content, ev ? Math.max(10, Math.floor(room * 0.6)) : room);
  const rest = ev ? [seg(`  ${fitText(ev, Math.max(0, room - textWidth(content) - 2))}`, M.muted)] : [];
  return padRow(fitRow([...head, seg(content, i.status === 'completed' ? M.muted : M.text), ...rest], o.cols), o.cols);
}

/** Panel rows for the board: [] without items, one row collapsed, else <= `maxRows` item rows. */
export function todoRows(items: TodoItem[], o: TodoPanelOpts): Segment[][] {
  if (!items.length || o.maxRows < 1) return [];
  if (!o.expanded) return [collapsed(items, o)];
  if (items.length <= o.maxRows) return items.map((i) => itemRow(i, o));
  const shown = items.slice(0, Math.max(0, o.maxRows - 1));
  return [...shown.map((i) => itemRow(i, o)), padRow([seg(`   +${items.length - shown.length} more`, M.muted)], o.cols)];
}
