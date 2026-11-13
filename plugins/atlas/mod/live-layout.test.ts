// Layout defects of the live Claude Code capture (round2/after/live-150, live-110; commit cd8daa09): HUD and side panel titles cut far
// below the row's width, a tab strip that wraps and rules the wrong cell, rows whose cell width is not the slot's, a stale `[-]`, a
// two-row plan cut while rows were free, and a jargon footer. Every surface is rendered at the widths the live host gave it and every
// row is measured in terminal cells the way the host measures (Bun.stringWidth: East Asian Wide and emoji = 2, ambiguous = 1).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { worldCard } from '../contracts/panel-world';
import { paintHud } from '../omp/hud-paint';
import { paintPanel } from '../omp/panel-view';
import { runsString, type Ui } from './atlas-ui';
import { bandSpareRows, bandTree } from './band';
import type { TodoItem } from './contract';
import { coreModel } from './data/core';
import { ownTodos } from './data/todos';
import { liveWorkers } from './data/live';
import { hudBudget, hudCompactRows, hudLines, reclaimBlanks, type HudAgent, type HudInput } from './hud';
import { busySnap, NOW } from './live_fixture';
import { cardLines, lineText, panelLines, STRIP_TABS, tabRows, type PanelModel, type PanelTab } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { textWidth } from './theme';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;
/** The host's cell width of a string: Bun.stringWidth where it exists, else the mod's own table (same semantics for these glyphs). */
const hostW = (s: string): number => (globalThis as { Bun?: { stringWidth: (s: string) => number } }).Bun?.stringWidth(s.replace(ANSI, '')) ?? textWidth(s.replace(ANSI, ''));

// ---- the live plan: five todos named as the capture's, three explorers running -----------------------------------------------------------
const todo = (id: string, content: string, status: string): TodoItem => ({ id, content, status });
const PLAN = [
  todo('t1', 'T1 read alpha.py (alpha-explorer)', 'pending'), todo('t2', 'T2 read beta.py (beta-explorer)', 'pending'), todo('t3', 'T3 read gamma.py (gamma-explorer)', 'pending'),
  todo('t4', 'T4 combine the three reports', 'pending'), todo('t5', 'T5 write the final two sentence summary', 'pending'),
];
const agent = (name: string): HudAgent => ({ name, role: 'explorer', state: 'working', model: 'haiku', ui: 'running' });
/** The board as the store holds it: the plan plus one hook-added dispatch row per explorer; the HUD gets it through ownTodos, which names each title's worker. */
const DISPATCH = ['alpha', 'beta', 'gamma'].map((n, i) => ({ ...todo(`d${i}`, `dispatch ${n}-explorer`, 'pending'), owner: `${n}-explorer`, origin: 'dispatch' }));
const input: HudInput = { todos: ownTodos([...PLAN, ...DISPATCH]), agents: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map(agent) };
const view = (cols: number, maxRows: number) => ({ cols, maxRows, ui, rich: false, now: 0 });
/** HUD columns the live host handed the hook: bodyColumns, the transcript less the engine's five (88 beside the 56-column pane at 150, 104 at 110). */
const HUD_WIDTHS = [88, 104, 138];
const PANE_WIDTHS = [55, 43, 37];
/** A TODO row starts with its state glyph and `T<n> `; the SUBAGENTS rows start with theirs too, but name a worker. */
const PLAN_ROW = /^[▸ ] [◐◓◑◒◇●■▲◉] T\d /;

describe('1. titles use the width the row has', () => {
  for (const cols of HUD_WIDTHS) {
    test(`HUD TODO at ${cols} columns: every title shows whole, the state word has its column`, () => {
      const rows = hudLines(input, view(cols, 30)).map(runsString);
      const todoRows = rows.filter((r) => PLAN_ROW.test(r)); // the agent rows also name their T1, after the worker
      expect(todoRows).toHaveLength(5);
      expect(todoRows[0]).toContain('T1 read alpha.py'); // wave 32: the agent has its own column, so the title drops the `(alpha-explorer)` suffix
      expect(todoRows[0]!.split('alpha-explorer')).toHaveLength(2);
      expect(todoRows[2]).toContain('T3 read gamma.py');
      expect(todoRows[4]).toContain('T5 write the final two sentence summary');
      expect(todoRows.some((r) => r.includes('...'))).toBe(false);
      // one state column: the word starts in the same cell on every row
      expect(new Set(todoRows.map((r) => r.search(/queued|running/))).size).toBe(1);
      // B3: a row whose owner agent runs reads running (critique 8: T1-T3 read queued while the three explorers ran); the unowned rows stay queued
      expect(todoRows.map((r) => (/running/.test(r) ? 'running' : /queued/.test(r) ? 'queued' : '?'))).toEqual(['running', 'running', 'running', 'queued', 'queued']);
    });
  }
  test('a title that cannot fit is cut with a one-cell `…` (never `...`) and the state word stays whole', () => {
    const long = [todo('t1', `T1 ${'very long title '.repeat(10)}`, 'pending')];
    const rows = hudLines({ todos: long, agents: [] }, view(88, 30)).map(runsString);
    const row = rows.find((r) => r.includes('very long'))!;
    expect(row).toContain('…');
    expect(row).not.toContain('...');
    expect(row.trimEnd().endsWith('queued')).toBe(true);
  });
  test('the pane route tab at 55 columns shows whole titles, owners aside', () => {
    const m = panelWorld('route', 55, ui, { todos: PLAN.map((t) => ({ id: t.id, label: t.content, state: 'queued' as const })), workers: [] });
    const rows = panelLines(m).map(lineText);
    expect(rows.some((r) => r.includes('T1 read alpha.py (alpha-explorer) '))).toBe(true);
    expect(rows.some((r) => r.includes('T5 write the final two sentence summary'))).toBe(true);
    expect(rows.filter((r) => /T\d /.test(r)).some((r) => r.includes('...'))).toBe(false);
  });
});

describe('2. the tab strip fits the pane and the rule sits under the lit tab', () => {
  const tabs = ['route', 'team', 'channel', 'gates', 'core'] as const;
  for (const cols of PANE_WIDTHS) {
    for (const tab of tabs) {
      test(`pane ${cols}, ${tab} lit: whole words (a second strip row where one does not fit), the rule under the lit label`, () => {
        const rows = tabRows(panelWorld(tab as PanelTab, cols, ui)).map(lineText);
        const ruleAt = rows.findIndex((r) => r.includes('━'));
        expect(rows.filter((r) => r.includes('━'))).toHaveLength(1);
        expect(rows.length).toBeLessThanOrEqual(3); // at most two strip rows and the rule
        for (const r of rows) expect(hostW(r.trimEnd())).toBeLessThanOrEqual(cols);
        expect(rows.join('\n')).not.toMatch(/\b[rtcgko]: (rt|tm|ch|gt|co|bd)\b/); // C4: no two-letter form
        const strip = rows[ruleAt - 1]!;
        const rule = rows[ruleAt]!;
        const at = rule.indexOf('━');
        expect(rule.replace(/ /g, '')).toMatch(/^━+$/);
        // the cells under the rule are the lit tab's drawn label, whole, right after its `k: ` hotkey and before the gap
        const entry = STRIP_TABS.find((t) => t.id === tab)!;
        const lit = strip.slice(at, at + [...rule.trim()].length);
        const bare = !/\b[rtcgko]: /.test(strip); // A1: a pane too narrow for `k: ` drops it and keeps one row of bare words
        if (!bare) expect(strip.slice(at - 3, at)).toBe(`${entry.key}: `);
        else expect(rows.filter((r) => r !== rule)).toHaveLength(1);
        expect(strip.slice(at + lit.length, at + lit.length + 1)).toMatch(/^ ?$/); // a gap, or the end of the row
        expect(['status', 'team', 'channel', 'gates', 'core']).toContain(lit);
        if (cols >= 55) expect(lit).toBe(entry.label);
      });
    }
  }
});

describe('3. every row of every surface is exactly its slot wide in terminal cells', () => {
  for (const cols of HUD_WIDTHS) {
    test(`HUD at ${cols}: every row is ${cols} cells`, () => {
      for (const maxRows of [30, 12, 9, 6, 3]) {
        const rows = paintHud(input, view(cols, maxRows));
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) expect(hostW(r)).toBe(cols);
      }
    });
  }
  const states = ['running', 'done', 'failed', 'blocked', 'waiting', 'queued'] as const;
  for (const cols of PANE_WIDTHS) {
    for (const tab of ['route', 'team', 'channel', 'gates', 'core'] as const) {
      test(`side panel ${tab} at ${cols}: every painted row is ${cols} cells`, () => {
        const todos = PLAN.map((t, i) => ({ id: t.id, label: t.content, state: states[i % states.length]! }));
        const m: PanelModel = panelWorld(tab, cols, ui, { todos, tick: 1 });
        for (const row of paintPanel(m)) expect(hostW(row)).toBe(cols);
        for (const l of panelLines(m)) expect(hostW(lineText(l))).toBeLessThanOrEqual(cols);
      });
    }
  }
  test('a wide character in a title (CJK, emoji) counts two cells and never overflows a slot', () => {
    const wide = [todo('t1', 'T1 読み取り alpha.py 🔍 summary of the results so far', 'pending'), todo('t2', 'T2 ascii row', 'pending')];
    for (const cols of [88, 40]) for (const r of paintHud({ todos: wide, agents: [] }, view(cols, 10))) expect(hostW(r)).toBe(cols);
    const m = panelWorld('route', 43, ui, { todos: wide.map((t) => ({ id: t.id, label: t.content, state: 'queued' as const })), workers: [] });
    for (const row of paintPanel(m)) expect(hostW(row)).toBe(43);
  });
  test('the worker card is a closed box: every row has the same cell width', () => {
    const rows = cardLines(worldCard(ui), 120).map((r) => hostW(runsString(r)));
    expect(new Set(rows).size).toBe(1);
  });
});

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => (t.kind === 'Text' ? String(t.props.children ?? '') : '')).join('');
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 1, total: 1 }, openGates: 0 });
const bandRows = (columns: number, idle: boolean): string[] => {
  const snapshot = idle ? busySnap({ squad: [], activity: {}, comms: [] }) : busySnap();
  const node = bandTree(els, { snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns, tick: 3, maxRows: 12, core }) as unknown as Node;
  return (node.props.children as Node[]).map(text);
};

describe('3b. the band rows fit their slot', () => {
  for (const columns of [88, 104, 138]) {
    test(`band at ${columns}, idle and running: no row is wider than the slot`, () => {
      for (const idle of [true, false]) for (const r of bandRows(columns, idle)) expect(hostW(r)).toBeLessThanOrEqual(columns);
    });
  }
});

describe('4. no fold marker', () => {
  test('no HUD row carries a [-] or [+] marker, and neither does the band bar: the host draws the one handle right of the tree (wave 33)', () => {
    for (const cols of HUD_WIDTHS) {
      for (const r of hudLines(input, view(cols, 30)).map(runsString)) expect(r).not.toMatch(/\[[-+]\]/);
    }
    const band = bandRows(104, true);
    for (const r of band) expect(r).not.toMatch(/\[[-+]\]/);
  });
});

describe('5. the plan row budget and the overflow row', () => {
  test('five todos and three agents: the compact form holds all five plan rows', () => {
    // ribbon + 5 plan rows + rule + agents ribbon + the column names + 3 agents + rule = 13 rows (round 5: the closing rules stay; the blank goes first)
    expect(hudCompactRows(input, 88)).toBe(13);
    const rows = hudLines(input, view(88, hudBudget(15, hudCompactRows(input, 88), 7, true))).map(runsString);
    expect(rows.filter((r) => PLAN_ROW.test(r))).toHaveLength(5);
    expect(rows.some((r) => /more todos?/.test(r))).toBe(false);
  });
  test('when rows run short the cut says how many are not shown, in plain words, with no ellipsis', () => {
    const rows = hudLines(input, view(88, 5)).map(runsString); // wave 31: the merged block holds all five plan rows and the agents on them in 7 rows, so the cut needs a slot under that
    const more = rows.find((r) => /\+\d+ more/.test(r))!;
    expect(more).toMatch(/▸ TODO {2}0\/5 · \+\d+ more ▱+ ─+╮$/); // the count rides the TODO ribbon (critique 16: a row of its own cost a plan row)
    expect(more).not.toContain('...');
    const planRows = rows.filter((r) => PLAN_ROW.test(r)).length;
    expect(planRows + Number(/(\d+) more/.exec(more)![1])).toBe(5); // every slot holds a row: shown plus counted is the whole plan
  });
  test('a plan longer than five still keeps its window and counts the rest', () => {
    const many = Array.from({ length: 8 }, (_, i) => todo(`t${i}`, `T${i + 1} item ${i}`, 'pending'));
    const rows = hudLines({ todos: many, agents: [] }, view(88, hudCompactRows({ todos: many, agents: [] }, 88))).map(runsString);
    expect(rows.some((r) => /\+\d+ more|◇ \d+ queued/.test(r))).toBe(true);
  });
});

describe('5b. A1: the band blanks go to the plan before the plan is folded', () => {
  const doneAgent = (name: string): HudAgent => ({ name, role: 'explorer', state: 'done', model: 'haiku', ui: 'done', since: NOW });
  const planDone = PLAN.map((t) => ({ ...t, status: 'completed' }));
  const agents: HudAgent[] = [agent('board-explorer'), ...['gamma-explorer', 'alpha-explorer', 'beta-explorer'].map(doneAgent)];
  const hudIn: HudInput = { todos: planDone, agents };
  const budget = 18; // the live frame's 15 slot rows less the host's line (14), plus the Subagents column-header row and its blank, plus the two closing rules (round 3)
  const cap = 5; // a slot that cuts the plan: the boxes stay closed (critique 28); wave 31: the merged block (plan rows carry the agents) holds everything in 7 rows, so only a slot under that cuts
  const snapshot = busySnap();
  const bandModel = (maxRows: number) => ({ snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns: 88, tick: 0, maxRows, workersInHud: true, ui });
  const draw = (maxRows: number) => hudLines(hudIn, view(88, maxRows));

  test('the band at the live budget spends rows on blanks while the plan is cut', () => {
    const first = draw(cap);
    expect(first.map(runsString).some((r) => /\+\d+ more|· \d+ done/.test(r))).toBe(true); // the defect: the plan is cut (windowed or folded onto the ribbon)
    expect(bandSpareRows(bandModel(budget - first.length))).toBeGreaterThan(0);
  });
  test('reclaimBlanks shows every plan row once the blanks are handed over, and the band loses only blanks', () => {
    const first = draw(cap);
    const hud = reclaimBlanks(first, cap, budget, (h) => bandSpareRows(bandModel(budget - h.length)), draw);
    const rows = hud.map(runsString);
    expect(rows.filter((r) => /T\d /.test(r))).toHaveLength(5);
    expect(rows.some((r) => /more todos? not shown/.test(r))).toBe(false);
    expect(hud.length).toBeLessThanOrEqual(budget);
    // the band keeps its content: the same non-blank rows before and after
    // (the compact worker rows fill what the HUD leaves, so they give way to the reclaim; the band's own row and its message stay)
    const WORKER_ROW = /^\s*[◐◓◑◒◐◓◑◒◐◓◇■▲◉●]\s+\S+\s+[a-z][a-z-]*\s{2,}\S/;
    const body = (maxRows: number): string[] => (bandTree(els, bandModel(maxRows)) as unknown as Node).props.children.map(text).filter((r: string) => r.trim() !== '' && !WORKER_ROW.test(r));
    expect(body(budget - hud.length)).toEqual(body(budget - first.length));
  });
  test('a HUD that already fits, or a band with no blanks, is returned as it was', () => {
    const all = draw(30);
    expect(reclaimBlanks(all, 30, 30, () => 3, draw)).toBe(all);
    const cut = draw(6);
    expect(reclaimBlanks(cut, 6, 14, () => 0, draw)).toBe(cut);
    expect(reclaimBlanks([], 8, 14, () => 3, draw)).toEqual([]);
  });
});

describe('5c. an idle band that leaves rows undrawn hands them to the plan', () => {
  const doneAgent = (name: string): HudAgent => ({ name, role: 'explorer', state: 'done', model: 'haiku', ui: 'done', since: NOW });
  const plan = PLAN.map((t, i) => ({ ...t, status: i === 0 || i === 2 ? 'completed' : 'pending' }));
  const hudIn: HudInput = { todos: plan, agents: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map(doneAgent) };
  const budget = 15;
  const cols = 104;
  const snapshot = busySnap({ squad: [], activity: {}, comms: [] }); // idle: nothing running, so the band draws fewer rows than it is allotted
  const bandModel = (maxRows: number) => ({ snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns: cols, tick: 0, maxRows, workersInHud: true, ui });
  const draw = (maxRows: number) => hudLines(hudIn, { cols, maxRows, ui, rich: false, now: NOW });
  test('every plan row is shown and no "more todos not shown" row appears', () => {
    const cap = hudBudget(budget, hudCompactRows(hudIn, cols), 7, false);
    const first = draw(cap);
    const hud = reclaimBlanks(first, cap, budget, (h) => bandSpareRows(bandModel(budget - h.length)), draw);
    const rows = hud.map(runsString);
    expect(rows.filter((r) => /T\d /.test(r))).toHaveLength(5);
    expect(rows.some((r) => /more todos? not shown/.test(r))).toBe(false);
    expect(hud.length).toBeLessThanOrEqual(budget);
  });
  test('the HUD at the cap alone folds when the band is allotted its seven rows: the defect', () => {
    const cap = hudBudget(budget, hudCompactRows(hudIn, cols), 7, false);
    expect(bandSpareRows(bandModel(budget - cap))).toBeGreaterThan(0);
  });
});

describe('5d. a task that just completed stays in the folded plan', () => {
  test('T3 completed 5 s ago is shown beside the running row while queued rows fold', () => {
    const at = Math.floor(NOW / 1000) - 5;
    const plan: TodoItem[] = [
      { ...todo('t1', 'T1 read alpha.py', 'completed'), completed_at: at - 600 }, { ...todo('t2', 'T2 read beta.py', 'in_progress'), claimed_at: at - 60 },
      { ...todo('t3', 'T3 read gamma.py', 'completed'), completed_at: at }, todo('t4', 'T4 combine the reports', 'pending'), todo('t5', 'T5 write the summary', 'pending'),
    ];
    const rows = hudLines({ todos: plan, agents: [] }, { cols: 104, maxRows: 4, ui, rich: false, now: NOW }).map(runsString);
    expect(rows.some((r) => r.includes('T3 read gamma.py'))).toBe(true);
    expect(rows.some((r) => r.includes('T2 read beta.py'))).toBe(true);
    expect(rows.some((r) => /\+\d+ more|◇ \d+ queued/.test(r))).toBe(true);
  });
});

describe('6. the band footer says it in plain words', () => {
  test('idle band: no header n/m or evidence n/m tally', () => {
    for (const columns of [104, 138]) {
      const row = bandRows(columns, true).find((r) => r.includes('verdicts'))!;
      expect(row).toBeDefined();
      expect(row).not.toMatch(/header \d+\/\d+/);
      expect(row).not.toMatch(/evidence \d+\/\d+/);
      expect(row).not.toMatch(/header/); // replies are a different unit from the plan: the gates tab holds that tally (critique 10 B4)
      expect(row).not.toContain('no done items yet'); // a zero the band cannot explain beside the plan count (critique 12 B1)
    }
  });
});
