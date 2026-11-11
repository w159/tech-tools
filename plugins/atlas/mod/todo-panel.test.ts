// The Board on Claude Code: the slot rows (todoRows) and the pane tree (boardTree) draw the rev 4 board from todos.json rows.
// The text equals the design golden; colour is state only, from the shared tokens; every row is exactly its width.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { board_120, board_120_rich, board_80, WORLD_NOW, worldItems } from '../contracts/board-golden';
import { PALETTES, toneHex, type Ui } from './atlas-ui';
import { boardTree, runSegment, todoRows } from './todo-panel';
import { textWidth } from './theme';
import type { Segment } from './runs';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const latte: Ui = { theme: 'latte', ascii: false, color: 'truecolor' };
const text = (row: Segment[]): string => row.map((s) => s.t).join('');
const o = (cols: number, over: Record<string, unknown> = {}) => ({ cols, tick: 0, expanded: true, maxRows: 20, now: WORLD_NOW, ui: mocha, ...over });

describe('slot rows', () => {
  test('nothing without items, without room, or folded', () => {
    expect(todoRows([], o(120))).toEqual([]);
    expect(todoRows(worldItems(), o(120, { maxRows: 0 }))).toEqual([]);
    expect(todoRows(worldItems(), o(120, { expanded: false }))).toEqual([]);
  });
  for (const [cols, rich, golden] of [[120, false, board_120], [120, true, board_120_rich], [80, false, board_80]] as const) {
    test(`${cols}${rich ? ' rich' : ''}: the header and rows are the golden's, every row padded to exactly ${cols} cells`, () => {
      const rows = todoRows(worldItems(), o(cols, { rich }));
      expect(rows.map((r) => text(r).trimEnd())).toEqual(golden.slice(2));
      for (const r of rows) expect(textWidth(text(r))).toBe(cols);
    });
  }
  test('a short slot ends in `+N more`, and the width never overflows at any column count', () => {
    const rows = todoRows(worldItems(), o(120, { maxRows: 4 }));
    expect(rows.map((r) => text(r).trimEnd()).at(-1)).toBe('  +5 more');
    expect(rows).toHaveLength(4);
    for (let cols = 20; cols <= 130; cols += 7) for (const r of todoRows(worldItems(), o(cols))) expect([cols, textWidth(text(r))]).toEqual([cols, cols]);
  });
  test('the running row spins with the tick (◐ ◓ ◑ ◒) and nothing else moves', () => {
    const run = (tick: number) => text(todoRows(worldItems(), o(120, { tick }))[4]!);
    expect([0, 1, 2, 3, 4].map((t) => run(t).slice(2, 3))).toEqual(['◐', '◓', '◑', '◒', '◐']);
    expect(run(0).replace('◐', '')).toBe(run(1).replace('◓', ''));
  });
  test('colour is state only: glyphs and chips take the state token, text the text tokens, nothing a hard-coded hex', () => {
    const rows = todoRows(worldItems(), o(120, { rich: true }));
    const palette = new Set(Object.values(PALETTES.mocha));
    for (const r of rows) for (const s of r) for (const c of [s.color, s.bg]) if (c) expect(palette.has(c)).toBe(true);
    const done = rows[1]!;
    expect(done.find((s) => s.t === '●')).toMatchObject({ color: PALETTES.mocha.ok });
    expect(done.find((s) => s.t === 'Wire band to host')).toMatchObject({ color: PALETTES.mocha.sub, strike: true });
    expect(done.find((s) => s.t.trim() === 'DONE')).toMatchObject({ bg: PALETTES.mocha.ok, bold: true });
    expect(rows[4]!.find((s) => s.t === '▸')).toMatchObject({ color: PALETTES.mocha.accent, bold: true });
  });
  test('Latte: done falls back to text colour (the ok glyph is under 3:1 on the Latte panel)', () => {
    const done = todoRows(worldItems(), o(120, { ui: latte }))[1]!;
    expect(done.find((s) => s.t === '●')).toMatchObject({ color: PALETTES.latte.text });
    expect(done.every((s) => s.bg === PALETTES.latte.panel)).toBe(true);
  });
  test('NO_COLOR keeps bold and strike and sets no colour at all', () => {
    const rows = todoRows(worldItems(), o(120, { ui: { ...mocha, color: 'none' } }));
    for (const r of rows) for (const s of r) expect([s.color, s.bg]).toEqual([undefined, undefined]);
    expect(rows[1]!.find((s) => s.t === 'Wire band to host')?.strike).toBe(true);
    expect(runSegment({ t: 'x', tone: 'ok' }, mocha)).toEqual({ t: 'x', color: toneHex('ok', 'mocha'), bg: PALETTES.mocha.panel });
  });
  test('rows keep todo order, with the per-subagent dispatch rows after the plan', () => {
    const rows = todoRows([{ content: 'sub', status: 'pending', origin: 'dispatch' }, { content: 'plan', status: 'pending' }], o(120));
    expect(text(rows[0]!)).toStartWith('ITEM');
    expect([text(rows[1]!), text(rows[2]!)].map((r) => r.slice(0, 10).trim())).toEqual(['◇ plan', '◇ sub']);
  });
});

describe('pane tree', () => {
  type Node = { kind: string; props: Record<string, any> };
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
  const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
  const rowTexts = (n: Node): string[] => (n.props.children as Node[]).map((row) => (row.props.children as Node[]).map((t) => t.props.children).join(''));
  const tree = (items: ReturnType<typeof worldItems>, over: Record<string, unknown> = {}) =>
    boardTree(els, items, { cols: 120, rows: 30, tick: 0, now: WORLD_NOW, ui: mocha, ...over }) as unknown as Node;

  test('the whole surface: ribbon, a blank row, the header, seven items; each row exactly the width', () => {
    const rows = rowTexts(tree(worldItems()));
    expect(rows.map((r) => r.trimEnd())).toEqual(board_120);
    for (const r of rows) expect(textWidth(r)).toBe(120);
  });
  test('rich: chips and the elapsed gauge', () => {
    expect(rowTexts(tree(worldItems(), { rich: true })).map((r) => r.trimEnd())).toEqual(board_120_rich);
  });
  test('80 columns: ribbon and the item and state columns', () => {
    expect(rowTexts(tree(worldItems(), { cols: 80 })).map((r) => r.trimEnd())).toEqual(board_80);
  });
  test('rows beyond the pane height become `+N more`', () => {
    const rows = rowTexts(tree(worldItems(), { rows: 6 })).map((r) => r.trimEnd());
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)).toBe('  +5 more');
  });
  test('an empty board draws the ribbon and `(no state)`', () => {
    const rows = rowTexts(tree([])).map((r) => r.trimEnd());
    expect(rows[0]).toContain('BOARD');
    expect(rows[0]).toContain('0 items');
    expect(rows.at(-1)).toBe('  (no state)');
  });
  test('the pane sits on the rev 4 panel colour', () => {
    expect(tree(worldItems()).props.backgroundColor).toBe(PALETTES.mocha.panel);
  });
});
