// Critique 10, slice C: the team, channel and strip tabs and the Board at 110 columns. Team rows ordered by task like the HUD, the team LAST in the
// HUD's short form, the route and channel tabs indented like the others, one word for `channel`, whole Board titles beside a dropped owner, the narrow
// gates header carrying its count, and plain words (no `audit/low`, no `differs`) in the core tab. Expectations are literal text.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld } from '../contracts/panel-world';
import { cells, type Ui } from './atlas-ui';
import { boardBody, boardText, type BoardRow } from './board-model';
import { coreModel, type CoreModel } from './data/core';
import { busySnap, NOW } from './live_fixture';
import type { LiveSnapshot } from './orchestra-types';
import { bodyLines, fillRows, lineText, panelLines, ribbonRow, stripLayout, tabRows, type PanelModel, type PanelWorker } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';
import type { SidebarModel } from './pane/sidebar-types';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const text = (m: PanelModel): string[] => bodyLines(m).map((l) => lineText(l).trimEnd());
const worker = (name: string, over: Partial<PanelWorker> = {}): PanelWorker => ({ name, role: 'explorer', state: 'done', detail: 'read x.py', ...over });

describe('C1: team rows follow the plan (T1, T2, T3), like the HUD', () => {
  const todos = [
    { id: '1', label: 'T1 read alpha.py', state: 'done' as const, owner: 'alpha-explorer' },
    { id: '2', label: 'T2 read beta.py', state: 'done' as const, owner: 'beta-explorer' },
    { id: '3', label: 'T3 read gamma.py', state: 'done' as const, owner: 'gamma-explorer' },
  ];
  const order = (rows: string[], names: string[]): string[] => names.map((n) => [n, rows.findIndex((l) => l.includes(n))] as const).sort((a, b) => a[1] - b[1]).map(([n]) => n);
  test('workers listed gamma, alpha, beta read alpha, beta, gamma', () => {
    const m = panelWorld('team', 100, mocha, { todos, workers: [worker('gamma-explorer'), worker('alpha-explorer'), worker('beta-explorer')] });
    expect(order(text(m), ['alpha-explorer', 'beta-explorer', 'gamma-explorer'])).toEqual(['alpha-explorer', 'beta-explorer', 'gamma-explorer']);
  });
  test('critique 11 A3: the state does not move a row: a running worker stays below a done one that owns an earlier row', () => {
    const m = panelWorld('team', 100, mocha, { todos, workers: [worker('alpha-explorer'), worker('gamma-explorer', { state: 'running' })] });
    expect(order(text(m), ['alpha-explorer', 'gamma-explorer'])).toEqual(['alpha-explorer', 'gamma-explorer']);
  });
  test('a worker that owns no plan row follows the ones that do, in the order given', () => {
    const m = panelWorld('team', 100, mocha, { todos, workers: [worker('loose-one'), worker('beta-explorer'), worker('alpha-explorer')] });
    expect(order(text(m), ['alpha-explorer', 'beta-explorer', 'loose-one'])).toEqual(['alpha-explorer', 'beta-explorer', 'loose-one']);
  });
});

describe('C1: the team LAST reads as the HUD LAST (`read gamma.py`)', () => {
  const act = (over: Record<string, unknown> = {}) => ({ tool: null, since: NOW - 1000, toolCount: 1, tokens: null, mood: 'done', lastLine: '', ...over });
  const snap = { ...busySnap(), squad: [{ name: 'gamma', persona: 'explorer', state: 'finished', source: 'task' }], members: [], todos: [], now: NOW,
    activity: { gamma: act({ lastTool: 'Read', target: 'gamma.py', lastLine: 'Read gamma.py -> 1 def gamma_name(): / 2 return...' }) } } as unknown as LiveSnapshot;
  const model = { snapshot: snap, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'team' }, columns: 121, rows: 40, tick: 0 } as unknown as SidebarModel;
  test('a done worker shows its outcome as the HUD LAST does (`report returned` with no evidence), not the raw result text', () => {
    const w = panelModelOf(model, mocha, 120).workers[0]!;
    expect(w.detail).toBe('report returned');
  });
  test('a running worker between calls shows the same short form', () => {
    const s = { ...snap, activity: { gamma: act({ mood: 'working', lastTool: 'Read', target: 'beta.py' }) }, squad: [{ name: 'gamma', persona: 'explorer', state: 'running', source: 'task' }] } as unknown as LiveSnapshot;
    expect(panelModelOf({ ...model, snapshot: s }, mocha, 120).workers[0]!.detail).toBe('read beta.py');
  });
});

describe('C2: one word, `channel`', () => {
  test('no strip form shortens it, at any width', () => {
    for (let cols = 20; cols <= 140; cols++) for (const row of stripLayout(cols).rows) for (const t of row) expect([cols, t.id === 'channel' ? t.label : 'channel']).toEqual([cols, 'channel']);
  });
  test('the drawn strip never reads `chan`', () => {
    for (const cols of [40, 50, 53, 55, 58, 80, 120]) expect([cols, tabRows(panelWorld('route', cols, mocha)).map(lineText).join('\n').includes('c: chan ')]).toEqual([cols, false]);
  });
});

describe('C2: the route and channel tabs keep the tab indent', () => {
  for (const cols of [38, 60, 100, 150]) {
    test(`route at ${cols}: every labelled row starts one cell in, like the strip`, () => {
      const rows = text(panelWorld('route', cols, mocha, { rows: 40 })).filter((l) => /^ ?(phase|gates|agents|todo)\b/.test(l));
      expect(rows.length).toBeGreaterThan(2);
      for (const l of rows) expect([cols, l.startsWith(' ')]).toEqual([cols, true]);
    });
    test(`channel at ${cols}: the head row starts in the name column, like every list row (critique 11: it sat one cell from the border)`, () => {
      expect(text(panelWorld('channel', cols, mocha, { rows: 40 }))[0]).toMatch(/^ {4}#\S/);
    });
  }
});

describe('C2: the channel tab with nothing said yet fills the pane with a plain line, at 30 and 40 rows', () => {
  for (const rows of [30, 40]) {
    test(`${rows} rows: head, a plain empty line and the fill make exactly rows - 1`, () => {
      const m = panelWorld('channel', 38, mocha, { rows, notes: [], people: 1, unread: 0 });
      const body = text(m);
      expect(body.some((l) => l.includes('no messages yet'))).toBe(true);
      expect(panelLines(m).length + fillRows(m, bodyLines(m).length).length).toBe(rows - 1);
    });
  }
});

describe('C3: Board titles at 110 columns (a 38-cell pane)', () => {
  const done = (label: string, owner: string): BoardRow => ({ label, state: 'done', owner, detail: '' });
  const rows = [done('T1 read alpha.py', 'alpha-explorer'), done('T2 read beta.py', 'beta-explorer'), done('T3 read gamma.py', 'gamma-explorer'), done('T4 combine the three reports', ''), done('T5 write the final summary', '')];
  test('no title is cut when every row reads done: the owner column drops first', () => {
    const out = boardText(boardBody(rows, { cols: 38, ui: mocha }));
    expect(out.join('\n')).not.toMatch(/\.\.\.|…/);
    expect(out.some((l) => l.includes('T4 combine the three reports'))).toBe(true);
    expect(out.filter((l) => l.trim() === 'alpha-explorer')).toHaveLength(1); // critique 15 B5: the owner stands under its row, indented, instead of vanishing
    expect(out.some((l) => /\S.*alpha-explorer/.test(l))).toBe(false); // never as a column that would cut the title
    for (const l of out) expect(cells(l)).toBeLessThanOrEqual(38);
  });
  test('a running row keeps room for its longer state word: its title may be cut there, the line never passes the pane', () => {
    const mixed = [...rows.slice(0, 3), { ...rows[3]!, state: 'running' as const }, rows[4]!];
    for (const l of boardText(boardBody(mixed, { cols: 38, ui: mocha }))) expect(cells(l)).toBeLessThanOrEqual(38);
  });
});

describe('C3: the narrow gates header carries its count', () => {
  test('at 38 cells the ribbon reads the green count in the short form', () => {
    const m = panelWorld('gates', 38, mocha, { gates: [{ id: 'a', title: 'A', lines: [{ id: 'a1', label: 'x', ok: true }, { id: 'a2', label: 'y', ok: false }] }, { id: 'b', title: 'B', lines: [{ id: 'b1', label: 'z', ok: true }] }] });
    const head = lineText(ribbonRow(m)).trimEnd();
    expect(head).toMatch(/SIDEPANEL ━+ 1\/2$/); // two groups, one green
    expect(cells(head)).toBeLessThanOrEqual(38);
  });
  test('at 150 cells it reads `n/m` too: one gates header format at every width (critique 11)', () => {
    const m = panelWorld('gates', 150, mocha, { gates: [{ id: 'a', title: 'A', lines: [{ id: 'a1', label: 'x', ok: true }] }] });
    expect(lineText(ribbonRow(m)).trimEnd()).toMatch(/SIDEPANEL ━+ 1\/1$/);
    const wide = lineText(ribbonRow(panelWorld('gates', 110, mocha, { gates: [{ id: 'a', title: 'A', lines: [{ id: 'a1', label: 'x', ok: true }] }] }))).trimEnd();
    expect(wide).toMatch(/SIDEPANEL ━+ 1\/1$/);
  });
});

describe('C4: the core tab in plain words', () => {
  const core: CoreModel = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
  const c = JSON.parse(JSON.stringify(core)) as CoreModel;
  c.routes = [{ teamId: 't1', name: 'audit', cls: 'audit', effort: 'low', isolation: 'shared', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
  const c2 = JSON.parse(JSON.stringify(c)) as CoreModel;
  c2.routes[0]!.drift = [];
  for (const w of [37, 60, 100, 150]) {
    test(`at ${w}: no class/effort token, no "differs"`, () => {
      for (const model of [c, c2]) {
        const out = text(panelWorld('core', w, mocha, { core: model, rows: 40 })).join('\n');
        expect([w, /audit\/low/.test(out), /differs/.test(out)]).toEqual([w, false, false]);
      }
    });
  }
  test('the sentence says what was planned and what ran', () => {
    const out = text(panelWorld('core', 150, mocha, { core: c, rows: 40 })).join('\n');
    expect(out).toContain('3 explorers ran, the plan said 1');
    expect(out).toMatch(/3 explorers +too many +asked for 1 on haiku/);
  });
  test('a long reading sentence wraps whole instead of being cut mid-phrase', () => {
    const out = text(panelWorld('core', 37, mocha, { core: { ...core, offload: { ...core.offload, workers: [] } }, workers: [worker('a'), worker('b'), worker('c')], rows: 40 })).join('\n');
    expect(out.replace(/\s+/g, ' ')).toContain('3% of what they read'); // the sentence wraps by words onto the next rows, all of it
    expect(out).not.toMatch(/of wh\.\.\./);
    // A4: the zero-figure sentence takes its short form at this width instead of wrapping (`no token / figures kept`)
    const none = text(panelWorld('core', 37, mocha, { core: { ...core, offload: { ...core.offload, kept: 0, returned: 0, workers: [] } }, workers: [worker('a'), worker('b'), worker('c')], rows: 40 })).join('\n');
    expect(none).toContain(' reading  3 finished, no token log');
  });
});
