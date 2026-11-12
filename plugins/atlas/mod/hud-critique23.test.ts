// Critique 23, slice hud26: every TODO row the slot has room for is drawn, one blank row between the blocks, the rule ends open so the host's `[-]` reads as its
// last cell, the selection cursor is accent 141 on every frame, LAST gets the spare width (MODEL goes first), and a changed board shows on the next draw.
// Live shapes: live-150-513bb41c-1 f0060:24 (`2 more todos not shown` with spare room), live-110 f0039 (`2 funct…`), stoprun-150-513bb41c-1 f0107:24-26.
import { describe, expect, test } from 'claude-code/testing';
import { cells, paintAnsi, runsString, type Run, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { hudLines, hudWantRows, type HudAgent, type HudInput } from './hud';
import { Motion } from './motion';
import { hudGapRows, hudSlotCap } from './register';
import { hudCompactRows, hudFloorRows, hudMotionItems } from './hud';

const NOW = 1_794_458_960_000;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const OWNERS = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'];
const CONTENT = ['T1 read alpha.py (alpha-explorer)', 'T2 read beta.py (beta-explorer)', 'T3 read gamma.py (gamma-explorer)', 'T4 combine the three reports', 'T5 write the final summary'];
const todo = (i: number, status: string, owner?: string): TodoItem => ({ id: `t${i}`, content: CONTENT[i - 1]!, status, ...(owner ? { owner } : {}) }) as unknown as TodoItem;
const agent = (name: string, state: string, uiState: HudAgent['ui'], over: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: uiState, model: 'haiku', since: NOW - 5000, ...over });
const working: HudInput = { todos: [todo(1, 'in_progress', OWNERS[0]), todo(2, 'in_progress', OWNERS[1]), todo(3, 'in_progress', OWNERS[2]), todo(4, 'pending'), todo(5, 'pending')], agents: OWNERS.map((n) => agent(n, 'working', 'running', { tool: 'Read', target: `${n.split('-')[0]}.py` })) };
const done: HudInput = { todos: [1, 2, 3, 4, 5].map((i) => todo(i, 'completed', OWNERS[i - 1])), agents: OWNERS.map((n) => agent(n, 'done', 'done', { lastLine: 'STATUS: DONE' })) };
const blocked: HudInput = { todos: [todo(1, 'completed', OWNERS[0]), todo(2, 'blocked', OWNERS[1]), todo(3, 'completed', OWNERS[2]), todo(4, 'pending'), todo(5, 'pending')], agents: [agent(OWNERS[0]!, 'done', 'done'), agent(OWNERS[1]!, 'failed', 'failed'), agent(OWNERS[2]!, 'done', 'done')] };
const STATES = { working, done, blocked } as const;
const text = (rows: Run[][]): string[] => rows.map((r) => runsString(r).trimEnd());
const planRows = (rows: string[]): string[] => rows.filter((l) => /^[▸ ]\s*\S T[1-5] /.test(l));

describe('every plan row the slot holds is drawn', () => {
  test('hudWantRows is what a roomy draw takes: 14 rows for five todos and three agents', () => {
    expect(hudWantRows(working, 150, NOW)).toBe(14);
    expect(hudWantRows(working, 110, NOW)).toBe(14);
  });
  for (const cols of [150, 110]) for (const [name, input] of Object.entries(STATES)) {
    for (const budget of [13, 14, 15, 16, 17]) {
      test(`${cols} columns, ${name}, a host slot of ${budget} rows: all five plan rows, no "not shown", the band keeps its rows`, () => {
        const cap = hudSlotCap(budget, hudCompactRows(input, cols), hudFloorRows(input, cols, NOW), 7, true, true, hudWantRows(input, cols, NOW));
        const hud = text(hudLines(input, { cols, maxRows: cap, ui, now: NOW }));
        expect(planRows(hud)).toHaveLength(5);
        expect(hud.some((l) => /not shown|\+\d+ more/.test(l))).toBe(false);
        const gap = hudGapRows(hud.some((l) => l.includes('SUBAGENTS')) && !hud.at(-1)!.includes('SUBAGENTS'), hud.length, budget);
        expect(budget - hud.length - gap).toBeGreaterThanOrEqual(1);
      });
    }
  }
  for (const cols of [150, 110]) for (const [name, input] of Object.entries(STATES)) {
    test(`${cols} columns, ${name}, a host slot of 12 rows (the least that holds the boxes): both boxes stay closed, the band keeps its rows, the plan folds before a rule goes`, () => {
      const cap = hudSlotCap(12, hudCompactRows(input, cols), hudFloorRows(input, cols, NOW), 7, true, true, hudWantRows(input, cols, NOW));
      const hud = text(hudLines(input, { cols, maxRows: cap, ui, now: NOW }));
      expect([hud.filter((l) => l.startsWith('╭─ ') && l.endsWith('╮')).length, hud.filter((l) => l.startsWith('╰') && l.endsWith('╯')).length]).toEqual([2, 2]);
      expect(planRows(hud).length).toBeGreaterThanOrEqual(3);
      const gap = hudGapRows(hud.some((l) => l.includes('SUBAGENTS')) && !hud.at(-1)!.includes('SUBAGENTS'), hud.length, 12);
      expect(12 - hud.length - gap).toBeGreaterThanOrEqual(1);
    });
  }
  test('finished rows fold into the title count only when the rows truly do not fit, and never print "not shown" while a blank row remains', () => {
    const at = (n: number): string[] => text(hudLines(blocked, { cols: 110, maxRows: n, ui, now: NOW }));
    for (let n = 14; n >= 8; n--) {
      const out = at(n);
      expect([n, out.some((l) => /not shown/.test(l) && out.some((x) => x === ''))]).toEqual([n, false]);
    }
    expect(at(14)[0]).not.toMatch(/done/);
  });
});

describe('one blank row between TODO and SUBAGENTS in every state', () => {
  for (const cols of [150, 110, 57]) for (const [name, input] of Object.entries(STATES)) {
    test(`${cols} columns, ${name}`, () => {
      const out = text(hudLines(input, { cols, maxRows: 40, ui, now: NOW }));
      const sub = out.findIndex((l) => l.includes('▸ SUBAGENTS'));
      expect(out[sub - 1]).toBe('');
      expect(out[sub - 2]).not.toBe('');
      expect(out.filter((l) => l === '')).toHaveLength(1);
    });
  }
});

describe('the rule ends in a corner on the last cell, where the host `[-]` stands against it', () => {
  test('every title rule ends in `╮`, every closing rule in `╯`, and every rule reaches the last cell (host cells: AbovePrompt bodyColumns, index.d.ts:11262-11270)', () => {
    for (const cols of [150, 110, 57]) {
      for (const l of text(hudLines(working, { cols, maxRows: 40, ui, now: NOW }))) {
        if (l.startsWith('╭')) expect([cols, l.endsWith('─╮'), cells(l)]).toEqual([cols, true, cols]);
        if (l.startsWith('╰')) expect([cols, l.endsWith('─╯'), cells(l)]).toEqual([cols, true, cols]);
        if (!l.startsWith('╭') && !l.startsWith('╰')) expect(l).not.toMatch(/[╮╯]/); // rows carry no wall
      }
    }
  });
});

describe('SUBAGENTS columns and the selection', () => {
  const long: HudInput = { ...working, agents: OWNERS.map((n) => agent(n, 'working', 'running', { tool: 'Read', target: `${n.split('-')[0]}_long_module_name.py` })) };
  test('LAST keeps the spare width at 110: the whole `read <file>`, never `2 funct…`', () => {
    const rows = text(hudLines(long, { cols: 110, maxRows: 40, ui, now: NOW }));
    for (const n of ['alpha', 'beta', 'gamma']) expect(rows.find((l) => l.includes(`${n}-explorer`) && /running\s+T\d/.test(l) && l.includes('read')) ?? '').toContain(`read ${n}_long_module_name.py`);
  });
  test('at the narrowest width MODEL goes first and LAST stays whole', () => {
    const rows = text(hudLines(working, { cols: 57, maxRows: 40, ui, now: NOW }));
    const head = rows.find((l) => /AGENT\s+STATE/.test(l))!;
    expect(head).not.toContain('MODEL');
    expect(head).toContain('LAST');
    expect(rows.some((l) => l.includes('read alpha.py'))).toBe(true);
  });
  for (const cols of [150, 110, 57]) {
    test(`${cols} columns: the cursor is accent (xterm 141) on every frame of the arrival ramp, and the selected name is bold`, () => {
      const mo = new Motion(true);
      const before: HudInput = { ...working, agents: [] };
      mo.observe('hud-agents', hudMotionItems(before, { now: 1000 }).agents, 0);
      mo.observe('hud-agents', hudMotionItems(working, { now: 1000 }).agents, 1000);
      for (const dt of [0, 40, 100, 200, 400, 800, 2000]) {
        const rows = hudLines(working, { cols, maxRows: 40, ui, now: 1005, motion: mo.ctx(1000 + dt) });
        const cursors = rows.flatMap((r) => r.filter((x) => x.t === '▸'));
        const marks = cursors.filter((x) => x.bold && x.tone === 'accent');
        expect([dt, marks.length >= 2, marks.every((x) => x.fg === undefined)]).toEqual([dt, true, true]);
        for (const r of rows) if (r[0]?.t === '▸' && r.some((x) => x.t.includes('-explorer') && !x.t.includes('('))) expect(r.find((x) => x.t.includes('-explorer') && !x.t.includes('('))!.bold).toBe(true);
      }
    });
  }
  test('256-colour hosts map the cursor to index 141', () => {
    const c256: Ui = { theme: 'mocha', ascii: false, color: '256' };
    const rows = hudLines(working, { cols: 150, maxRows: 40, ui: c256, now: NOW });
    const cursor = rows.flatMap((r) => r.filter((x) => x.t === '▸'))[0]!;
    expect(paintAnsi(cursor, c256)).toContain('38;5;141');
  });
});

describe('a changed board shows on the next redraw', () => {
  test('flipping a todo or an agent changes the very next frame (the 500 ms stat poll is the only wait)', () => {
    const next: HudInput = { todos: working.todos.map((t, i) => (i === 3 ? ({ ...t, status: 'in_progress' } as TodoItem) : t)), agents: working.agents };
    const a = text(hudLines(working, { cols: 150, maxRows: 40, ui, now: NOW }));
    const b = text(hudLines(next, { cols: 150, maxRows: 40, ui, now: NOW }));
    expect(a.find((l) => l.includes('T4'))).toMatch(/queued/);
    expect(b.find((l) => l.includes('T4'))).toMatch(/running/);
  });
});
