// tab-kit.ts: the cell helpers of the redesigned side panel (approved mockup `mock.html`: status, health, gates, chat). Pure, runs only.
// One grid for every tab: a one-cell gutter each side (`usable` = cols - 2), labels in the muted tone, a figure flush right, a name never run into the next column (a cut is `…`, ascii `...`, with a 2-cell gutter before the next column).
// Colour carries state only: the tones are the existing tokens (text / sub / muted / dim, ok / bad / warn / info / accent / cyan); a role name takes the role's palette colour (roleHex).
import { cells, PALETTES, roleHex, type Run, type Tone, type Ui } from '../../design/atlas-ui';
import { ROLE_COLOUR } from '../../design/theme';
import { r, fitRuns, rowWidth, type PanelLine, type PanelModel, type Press } from './panel-shared';

/** The redesign's greys on the existing tokens: `t` text, `s` sub, `d` muted (labels), `f` dim (rules, empty cells). */
const TONE = { t: 'text', s: 'sub', d: 'muted', f: 'dim' } as const satisfies Record<string, Tone>;
/** A glyph or its ascii fallback. */
export const g = (ui: Pick<Ui, 'ascii'>, full: string, plain: string): string => (ui.ascii ? plain : full);
/** Usable cells of a row: the panel's width less the gutter and the margin. */
export const usable = (m: Pick<PanelModel, 'cols'>): number => Math.max(8, m.cols - 2);
export const w = (runs: readonly Run[]): number => rowWidth(runs);

/** `t` cut to `n` cells with an ellipsis (`...` in ascii); whole when it fits. */
export function clipUi(ui: Pick<Ui, 'ascii'>, t: string, n: number): string {
  if (n <= 0) return '';
  if (cells(t) <= n) return t;
  const e = ui.ascii ? '...' : '\u2026'; // the one ellipsis (glyph guard: no literal in code)
  if (n <= cells(e)) return e.slice(0, n);
  let out = '';
  for (const ch of t) {
    if (cells(out + ch) > n - cells(e)) break;
    out += ch;
  }
  return out + e;
}
export const padR = (t: string, n: number): string => t + ' '.repeat(Math.max(0, n - cells(t)));
export const padL = (t: string, n: number): string => ' '.repeat(Math.max(0, n - cells(t))) + t;
/** A column cell: `t` cut to leave a 2-cell gutter before the next column (a narrow cell, or the last, keeps all `n`), padded to `n`; `right` aligns it to the column's right edge. */
export const col = (ui: Pick<Ui, 'ascii'>, t: string, n: number, tone: Tone, o: Partial<Run> = {}, right = false): Run => {
  const room = right || n <= 3 ? n : n - 2;
  const cut = clipUi(ui, t, room);
  return r(right ? padL(cut, n) : padR(cut, n), tone, o);
};

/** One row: gutter, `left` (cut when it does not fit), the gap, `right` flush to the margin. */
function lr(m: Pick<PanelModel, 'cols' | 'ui'>, left: readonly Run[], right: readonly Run[] = [], at = 0): Run[] {
  const U = usable(m);
  const rw = w(right);
  const room = Math.max(1, U - at - (rw ? rw + 2 : 0));
  const l = fitRuns(left, room);
  return [r(' '.repeat(1 + at)), ...l, ...(rw ? [r(' '.repeat(Math.max(1, U - at - w(l) - rw))), ...right] : [])];
}
export const row = (m: Pick<PanelModel, 'cols' | 'ui'>, left: readonly Run[], right: readonly Run[] = [], press?: Press, at = 0): PanelLine => ({ runs: lr(m, left, right, at), ...(press ? { press } : {}) });
/** A section heading: ` PHASE` muted bold, a figure flush right. */
export const head = (m: Pick<PanelModel, 'cols' | 'ui'>, title: string, right: readonly Run[] = [], figure: readonly Run[] = []): PanelLine => row(m, [r(title, 'muted', { bold: true }), ...figure], right);
/** A key/value row: the key in a muted label column. */
export const kv = (m: Pick<PanelModel, 'cols' | 'ui'>, key: string, rest: readonly Run[], keyW = 10): PanelLine => row(m, [r(padR(key, keyW), 'muted'), ...rest]);
const rule = (ui: Pick<Ui, 'ascii'>, n: number, tone: Tone = 'dim'): Run => r(g(ui, '─', '-').repeat(Math.max(0, n)), tone);

/** A thin bar: `pct` of `width` cells filled in `tone`, the rest the dim track. */
export function bar(ui: Pick<Ui, 'ascii'>, pct: number, width: number, tone: Tone): Run[] {
  const k = Math.max(0, Math.min(width, Math.round((width * pct) / 100)));
  return [r(g(ui, '━', '=').repeat(k), tone), r(g(ui, '━', '-').repeat(width - k), 'dim')];
}
/** The segmented plan bar: `▰` done (ok), running (accent), then `▱` for the rest; every segment is one item up to `max` cells, scaled above that. */
export function segBar(ui: Pick<Ui, 'ascii'>, done: number, running: number, total: number, max = 14): Run[] {
  if (total <= 0) return [];
  const n = Math.min(total, max);
  const d = Math.min(n, Math.round((done / total) * n));
  const run = Math.min(n - d, running > 0 ? Math.max(1, Math.round((running / total) * n)) : 0);
  const on = g(ui, '▰', '#');
  const off = g(ui, '▱', '-');
  return [r(on.repeat(d), 'ok'), r(on.repeat(run), 'accent'), r(off.repeat(n - d - run), 'dim')].filter((x) => x.t !== '');
}

/** A name in its role's colour (the lead in the accent): bold, the neutral text colour for a role with none. */
export function roleRun(t: string, role: string, ui: Ui, o: Partial<Run> = {}): Run {
  if (role === 'lead' || role === 'orchestrator') return r(t, 'accent', o);
  const hex = ROLE_COLOUR[role] === undefined ? undefined : roleHex(role, ui.color, ui.theme);
  return hex ? r(t, 'text', { ...o, fg: hex }) : r(t, 'text', o);
}

/** `#rrggbb` mixed `k` of the way from the panel surface to the accent: the tint behind the user's own bubble. */
export function tint(ui: Pick<Ui, 'theme'>, k = 0.2): string {
  const p = PALETTES[ui.theme];
  const ch = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(p.panel, i) + (ch(p.accent, i) - ch(p.panel, i)) * k).toString(16).padStart(2, '0')).join('')}`;
}

/** `text` wrapped on its words to `width` cells (a word longer than the line is cut), at most `max` lines (the last ends in an ellipsis). */
export function wrapWords(ui: Pick<Ui, 'ascii'>, text: string, width: number, max = 6): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cells(next) <= width) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = cells(word) > width ? clipUi(ui, word, width) : word;
  }
  if (cur) out.push(cur);
  if (out.length > max) { out.length = max; out[max - 1] = clipUi(ui, `${out[max - 1]!} \u2026`, width); }
  return out.length ? out : [''];
}
/** `hh:mm` of a post's own time (`08:41:07` or an iso stamp); empty when it has none. */
export const hhmm = (at: string): string => /(\d{2}:\d{2}|--:--)/.exec(at)?.[1] ?? '';
