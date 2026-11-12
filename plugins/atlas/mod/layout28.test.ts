// Layout regressions of a5fa582a (live captures): TODO rows folded while the slot had room, the SUBAGENTS header dropped, the band moving between rows, the panel
// saying blocked before the band, `▲ blocked ... ▲ 1 blocked`, and `● 1 closed`.
import { describe, expect, test } from 'claude-code/testing';
import { runsString, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { ownTodos } from './data/todos';
import { hudLines, hudRunRows, hudWantRows, type HudAgent, type HudInput } from './hud';
import { bandLines, runsText, type MissionModel } from './mission-layout';
import { bandRowCount } from './band';
import { busySnap } from './live_fixture';
import { BLOCKED_HOLD_MS, BLOCKED_REST, blockedShown, markBlocked, maskBlocked, slotHold } from './register';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const todo = (id: string, content: string, status: string): TodoItem => ({ id, content, status });
const PLAN = [
  todo('t1', 'T1 read alpha.py (alpha-explorer)', 'pending'),
  todo('t2', 'T2 read beta.py (beta-explorer)', 'pending'),
  todo('t3', 'T3 read gamma.py (gamma-explorer)', 'pending'),
  todo('t4', 'T4 combine the three reports', 'pending'),
  todo('t5', 'T5 write the final summary', 'pending'),
];
const agent = (name: string): HudAgent => ({ name, role: 'explorer', state: 'working', model: 'haiku', ui: 'running' });
const input = (n: number): HudInput => ({ todos: ownTodos(PLAN), agents: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].slice(0, n).map(agent) });
const draw = (n: number, cols: number, maxRows: number): string[] => hudLines(input(n), { cols, maxRows, ui, rich: false, now: 0 }).map((r) => runsString(r).trimEnd());
const todoRowsOf = (rows: string[]): string[] => rows.filter((t) => /T\d\b/.test(t));

describe('layout28 item 1: no TODO row is folded while the slot has room', () => {
  // 150x45 gives a 12-row slot (11 for the HUD under the band row), 110x40 a 10-row slot (9 for the HUD).
  for (const [cols, rows] of [[150, 11], [110, 9]] as const) {
    test(`all five TODO rows and the SUBAGENTS header show at ${cols} columns in ${rows} rows`, () => {
      const out = draw(3, cols, rows);
      const text = out.join('\n');
      expect(out.length).toBeLessThanOrEqual(rows);
      for (const k of ['T1', 'T2', 'T3', 'T4', 'T5']) expect(text).toContain(k);
      expect(text).not.toContain('not shown');
      expect(text).toContain('SUBAGENTS');
    });
  }
  test('a fold reads `+N more` at every width, never `N more todo not shown`', () => {
    for (const cols of [150, 110, 80]) for (const rows of [3, 4, 5, 6]) {
      const text = draw(3, cols, rows).join('\n');
      expect(text).not.toContain('not shown');
      if (/more/.test(text)) expect(text).toMatch(/\+\d+ more/);
    }
  });
  test('the fold keeps every row it can: a taller slot never shows fewer TODO rows', () => {
    let prev = 0;
    for (let rows = 3; rows <= 11; rows++) {
      const n = todoRowsOf(draw(3, 150, rows)).length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });
});

describe('layout28 item 3: the slot holds one height for the run', () => {
  test('slotHold starts at the run reserve, never falls while the run lasts, never passes the budget, and is 0 at rest', () => {
    expect(slotHold(0, true, 4, 10, 12)).toBe(10);
    expect(slotHold(10, true, 6, 10, 12)).toBe(10);
    expect(slotHold(10, true, 12, 10, 12)).toBe(12);
    expect(slotHold(12, true, 3, 10, 12)).toBe(12);
    expect(slotHold(20, true, 3, 10, 12)).toBe(12);
    expect(slotHold(10, false, 6, 10, 12)).toBe(0);
    expect(slotHold(10, true, 6, 10, 0)).toBe(0);
  });
  test('hudRunRows asks for the full HUD height before the agents have started', () => {
    expect(hudRunRows(input(0), 150, 0)).toBeGreaterThan(hudWantRows(input(0), 150, 0));
    expect(hudRunRows(input(3), 150, 0)).toBe(hudWantRows(input(3), 150, 0));
  });
});

describe('layout28 item 3b: the idle band has one height at every width', () => {
  test('bandRowCount with handlers wired is the same at 60, 79, 80 and 150 columns', () => {
    const snapshot = busySnap({ squad: [], activity: {}, comms: [] });
    const rows = [60, 79, 80, 150].map((columns) => bandRowCount({ snapshot, live: [], gates: [], columns, tick: 0, maxRows: 12 }, true));
    expect(new Set(rows).size).toBe(1);
  });
});

describe('layout28 item 4: the panel does not say blocked before the band can', () => {
  test('a change shows the old state for BLOCKED_HOLD_MS and the new one after', () => {
    let m = markBlocked(BLOCKED_REST, true, 1000);
    expect(blockedShown(m, 1000)).toBe(false);
    expect(blockedShown(m, 1000 + BLOCKED_HOLD_MS - 1)).toBe(false);
    expect(blockedShown(m, 1000 + BLOCKED_HOLD_MS)).toBe(true);
    expect(markBlocked(m, true, 1100)).toBe(m);
    m = markBlocked(m, false, 5000);
    expect(blockedShown(m, 5000)).toBe(true);
    expect(blockedShown(m, 5000 + BLOCKED_HOLD_MS)).toBe(false);
  });
  test('maskBlocked puts back the last phase and a Stop verdict that reads allowed, and passes through when shown', () => {
    const snap = { phase: 'blocked' };
    const groups = [{ lines: [{ id: 'stop-verdict', label: 'Stop blocked', detail: 'x' as string | undefined }] }];
    expect(maskBlocked(snap, groups, true, 'build').snapshot).toBe(snap);
    const masked = maskBlocked(snap, groups, false, 'build');
    expect(masked.snapshot.phase).toBe('build');
    expect(masked.groups[0]!.lines[0]!.label).toBe('Last Stop allowed');
  });
});

describe('layout28 item 5: glyphs', () => {
  const model = (over: Partial<MissionModel> = {}): MissionModel => ({ cols: 150, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'plan', 'build', 'verify', 'done'], phase: 'build', done: 3, total: 7, workers: [], checks: null, ui, ...over });
  test('a blocked band row carries one ▲ at any width', () => {
    for (const cols of [150, 110, 80, 60]) {
      const t = runsText(bandLines(model({ cols, workers: [], blocked: true, todoBlocked: 1 }))[0]!.runs);
      expect((t.match(/▲/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
  test('the closed count in the band agents segment has no ● glyph', () => {
    for (const cols of [150, 110]) {
      const t = runsText(bandLines(model({ cols, workers: [{ name: 'a', state: 'failed', secs: 3 }, { name: 'b', state: 'done', secs: 3 }], closed: 1 }))[0]!.runs);
      expect(t).toContain('1 closed');
      expect(t).not.toMatch(/●\s*1 closed/);
    }
  });
});
