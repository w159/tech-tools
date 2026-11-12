// Critique 8, slice B: the Board equals the board store (B1), owners drop before titles are cut (B2), a row whose owner runs reads running (B3),
// and no cursor on a queued row (B4).
import { describe, expect, test } from 'claude-code/testing';
import { cells, runsString, type Ui } from './atlas-ui';
import { boardBody, boardFolded, boardLines, boardRowsOf, boardText, itemState, planFigure } from './board-model';
import { ownTodos } from './data/todos';
import { todoRows, type TodoRow } from './hud-surface';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const plan = [
  { content: 'T1 read alpha.py (alpha-explorer)', status: 'pending' },
  { content: 'T2 read beta.py (beta-explorer)', status: 'pending' },
  { content: 'T3 read gamma.py (gamma-explorer)', status: 'pending' },
  { content: 'T4 combine the three reports', status: 'pending' },
  { content: 'T5 write the final summary', status: 'pending' },
];
const dispatch = ['alpha', 'beta', 'gamma'].map((n) => ({ content: `Read ${n}.py`, status: 'pending', origin: 'dispatch', owner: `${n}-explorer` }));

describe('B1: the Board footer names the folded dispatches', () => {
  test('5 plan items and 3 dispatches: 5 rows, 3 folded, a footer that says so', () => {
    const items = [...plan, ...dispatch];
    expect(boardRowsOf(items)).toHaveLength(5);
    expect(boardFolded(items)).toBe(3);
    const text = boardText(boardLines(boardRowsOf(items), { cols: 80, ui, folded: boardFolded(items) }));
    expect(text.at(-1)).toBe('  3 dispatches folded'); // the ribbon says `5 items`; the footer does not say it again (critique 11)
    expect(boardText(boardLines(boardRowsOf(plan), { cols: 80, ui, folded: 0 })).join('\n')).not.toContain('folded');
  });
});

describe('B2: the owner column drops before a title is cut', () => {
  test('at the pane widths of the live run no title is cut for an owner cell', () => {
    const rows = boardRowsOf([...plan, ...dispatch]);
    for (const cols of [40, 43, 55]) {
      const text = boardBody(rows, { cols, ui }).map((l) => runsString(l.runs));
      for (const l of text) expect([cols, cells(l) <= cols]).toEqual([cols, true]);
      expect([cols, text.join('\n').includes('T4 combine th...')]).toEqual([cols, false]);
      // critique 15 B5: no owner cell while a title would shrink for it, but the owner is never dropped: it stands under its row
      if (cols < 55) expect([cols, text.filter((l) => /^ {4}(alpha|beta|gamma)-/.test(l)).length]).toEqual([cols, 3]);
      else expect([cols, text.join('\n').includes('T4 combine the three reports')]).toEqual([cols, true]); // room for both: every title whole (the owner cell may shorten)
    }
  });
});

describe('B3: a queued row whose owner runs reads running', () => {
  test('itemState', () => {
    expect(itemState('pending', 'running')).toBe('running');
    expect(itemState('pending', undefined)).toBe('queued');
    expect(itemState('completed', 'running')).toBe('done');
    expect(itemState('pending', 'failed')).toBe('queued'); // critique 18 B3: pending in the store never reads failed
    expect(itemState('in_progress', 'failed')).toBe('failed');
  });
  test('ownTodos names the title worker; the board fold keeps the title as before', () => {
    const own = ownTodos([...plan, ...dispatch].map((x) => ({ ...x })));
    expect(own.slice(0, 3).map((x) => (x as { owner?: string }).owner)).toEqual(['alpha-explorer', 'beta-explorer', 'gamma-explorer']);
    expect(own[0]!.content).toBe('T1 read alpha.py (alpha-explorer)'); // the title is left as written
    const rows = boardRowsOf(own.map((x) => ({ ...x, ...((x as { owner?: string }).owner ? { ownerState: 'running' as const } : {}) })));
    expect(rows.map((x) => x.state)).toEqual(['running', 'running', 'running', 'queued', 'queued']);
    expect(rows.map((x) => x.label)).toEqual(['T1 read alpha.py', 'T2 read beta.py', 'T3 read gamma.py', 'T4 combine the three reports', 'T5 write the final summary']);
  });
});

describe('critique 15 B6: one count rule for returned rows', () => {
  test('planFigure names the returned rows beside the done count; the HUD TODO header says `0/5 · 1 returned` over a returned row (live-150-95c4a588-1 f0063)', () => {
    expect(planFigure(0, 5)).toBe('0/5');
    expect(planFigure(0, 5, 1)).toBe('0/5 · 1 returned');
    const rows: TodoRow[] = [{ label: 'T1 read alpha.py', state: 'blocked', word: 'returned', detail: '', focus: false }, ...['T2', 'T3'].map((l): TodoRow => ({ label: l, state: 'queued', detail: '', focus: false }))];
    const head = runsString(todoRows(rows, { cols: 100, ui }, { spacers: false, extras: false })[0]!);
    expect(head).toContain('0/3 · 1 returned');
  });
});

describe('B4: no running cursor on a queued row', () => {
  const row = (label: string, state: TodoRow['state'], focus: boolean): TodoRow => ({ label, state, detail: '', focus });
  test('a focused queued row draws no marker, a focused running row does', () => {
    const lines = todoRows([row('wait', 'queued', true), row('work', 'running', true)], { cols: 60, ui }, { spacers: false, extras: false }).map((l) => runsString(l));
    expect(lines.some((l) => /^▸.*wait/.test(l))).toBe(false);
    expect(lines.some((l) => /^▸.*work/.test(l))).toBe(true);
  });
});
