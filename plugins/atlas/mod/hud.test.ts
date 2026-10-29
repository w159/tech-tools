// omp-format HUD: the TODO tree, "Subagents · N running" block and "Waiting on ..." line above the band.
// Golden fixture reproduces the omp screenshot scenario; every row's text is asserted exactly.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import type { TodoItem } from './contract';
import { hudBudget, hudCompactRows, hudRows, roman, selectCollapsed, truncateMiddle, waitingText, type HudAgent } from './hud';
import { rowOf, type Segment } from './runs';
import { MOCHA as M, textWidth } from './theme';

const text = (row: Segment[]): string => row.map((s) => s.t).join('');
const lines = (rows: Segment[][]): string[] => rows.map(text);
const todo = (id: string, content: string, status: string, phase?: string): TodoItem => ({ id, content, status, ...(phase ? { phase: phase as TodoItem['phase'] } : {}) });

const PLAN: TodoItem[] = [
  todo('r1', 'Trace history load failure root cause', 'completed', 'research'),
  todo('r2', 'Trace gate path and pre-gate costs', 'in_progress', 'research'),
  todo('i1', 'Patch the gate stage order', 'completed', 'implement'),
  todo('i2', 'Add scorer regression test', 'pending', 'implement'),
  todo('i3', 'Wire the kill switch', 'pending', 'implement'),
  todo('i4', 'Update the fixtures', 'pending', 'implement'),
  todo('v1', 'Run the full suite', 'pending', 'verify'),
  todo('v2', 'Run the type check', 'pending', 'verify'),
  todo('v3', 'Run lint', 'pending', 'verify'),
  todo('v4', 'Review the diff', 'pending', 'verify'),
  todo('d1', 'Document the stage order', 'pending', 'docs'),
];

const AGENTS: HudAgent[] = [
  { name: 'verifier-eval', role: 'verifier', model: 'ollama/minimax-m2.1-flash:cloud', task: 'Verify gate fix shows no scorer regression', state: 'working', lastTool: 'eval', lastLine: 'Comparing mtimes' },
  { name: 'docs-curator-gate', role: 'docs-curator', model: 'anthropic/claude-sonnet-5', task: 'Update docs for gate stage order...', state: 'working', lastTool: 'read', lastLine: 'Read CHANGELOG style and top section' },
];

const GOLDEN = [
  'TODO',
  ' ├─ I. Research · 1/2',
  ' │  ├─ ☑ Trace history load failure root cause',
  ' │  └─ ☐ Trace gate path and pre-gate costs',
  ' ├─ II. Implement · 1/4',
  ' ├─ III. Verify · 0/4',
  ' ├─ IV. Docs · 0/1',
  ' └─────',
  'Subagents · 2 running',
  ' ├─ • ◑ ollama/minima….1-flash:cloud verifier-eval [verifier]: Verify gate fix shows no scorer regression',
  ' │  └ ✓ eval: Comparing mtimes',
  ' └─ • ◑ anthropic/claude-sonnet-5 docs-curator-gate [docs-curator]: Update docs for gate stage order...',
  '    └ ✓ read: Read CHANGELOG style and top section',
  '⏳ Waiting on verifier and docs-curator agents',
];

describe('hud golden', () => {
  test('the omp screenshot scenario renders omp\'s exact rows', () => {
    expect(lines(hudRows({ todos: PLAN, agents: AGENTS }, { cols: 140, maxRows: 40 }))).toEqual(GOLDEN);
  });

  test('completed items are struck through and dim; the in-progress item takes the accent', () => {
    const rows = hudRows({ todos: PLAN, agents: [] }, { cols: 140, maxRows: 40 });
    const done = rows[2]!.find((s) => s.t === 'Trace history load failure root cause')!;
    expect(done).toMatchObject({ strike: true, color: M.muted });
    const active = rows[3]!.find((s) => s.t.includes('Trace gate path'))!;
    expect(active.color).toBe(M.violet);
    expect(active.strike).toBeUndefined();
  });

  test('the spine fills with overall progress: accent cells then dim', () => {
    const rows = hudRows({ todos: PLAN, agents: [] }, { cols: 140, maxRows: 40 });
    expect(rows[1]![1]).toMatchObject({ t: '├─ ', color: M.violet });
    expect(rows[6]![1]).toMatchObject({ t: '├─ ', color: M.grey });
    expect(rows[7]!.map((s) => s.color)).toContain(M.grey); // the tail is not lit while work remains
  });
});

describe('hud todo tree', () => {
  test('phases group in plan order, unphased items go under a final Other, a single phase has no numeral', () => {
    const plan = [todo('a', 'docs first', 'pending', 'docs'), todo('b', 'then research', 'pending', 'research'), todo('c', 'loose', 'pending')];
    expect(lines(hudRows({ todos: plan, agents: [] }, { cols: 80, maxRows: 20 })).filter((l) => l.includes('·'))).toEqual([' ├─ I. Docs · 0/1', ' ├─ II. Research · 0/1', ' ├─ III. Other · 0/1']);
    expect(lines(hudRows({ todos: [todo('a', 'solo', 'pending', 'docs')], agents: [] }, { cols: 80, maxRows: 20 }))[1]).toBe(' ├─ Docs · 0/1');
  });

  test('the phase holding the in_progress item is expanded; with none, the first with an open item', () => {
    const plan = [todo('a', 'done', 'completed', 'research'), todo('b', 'open b', 'pending', 'implement'), todo('c', 'working c', 'in_progress', 'verify')];
    expect(lines(hudRows({ todos: plan, agents: [] }, { cols: 80, maxRows: 20 })).join('\n')).toContain('III. Verify · 0/1\n │  └─ ☐ working c');
    const idle = lines(hudRows({ todos: plan.map((t) => (t.status === 'in_progress' ? { ...t, status: 'pending' } : t)), agents: [] }, { cols: 80, maxRows: 20 }));
    expect(idle).toContain(' │  └─ ☐ open b');
  });

  test('a long active phase shows capped items and a "… N more todos" row', () => {
    const plan = [todo('x0', 'now', 'in_progress', 'implement'), ...Array.from({ length: 8 }, (_, i) => todo(`x${i + 1}`, `later ${i + 1}`, 'pending', 'implement'))];
    const out = lines(hudRows({ todos: plan, agents: [] }, { cols: 80, maxRows: 20 }));
    expect(out.slice(1, 8)).toEqual([' ├─ Implement · 0/9', ' │  ├─ ☐ now', ' │  ├─ ☐ later 1', ' │  ├─ ☐ later 2', ' │  ├─ ☐ later 3', ' │  ├─ ☐ later 4', ' │  └─ … 4 more todos']);
  });

  test('the content phase prefix is not repeated in the row', () => {
    const out = lines(hudRows({ todos: [todo('a', '[research] map auth', 'pending', 'research')], agents: [] }, { cols: 80, maxRows: 20 }));
    expect(out[2]).toBe(' │  └─ ☐ map auth');
  });

  test('a fully done plan lights the whole path', () => {
    const rows = hudRows({ todos: [todo('a', 'a', 'completed', 'research'), todo('b', 'b', 'completed', 'docs')], agents: [] }, { cols: 80, maxRows: 20 });
    const spine = rows.slice(1).map((r) => r[1]!); // the gutter cell of every tree row, and the tail
    expect(spine.map((s) => s.color)).toEqual([M.violet, M.violet, M.violet]);
  });
});

describe('hud subagents', () => {
  test('no agents running -> no Subagents block and no Waiting line', () => {
    const idle: HudAgent = { ...AGENTS[0]!, state: 'done' };
    const out = lines(hudRows({ todos: PLAN, agents: [idle] }, { cols: 140, maxRows: 40 }));
    expect(out.join('\n')).not.toContain('Subagents');
    expect(out.join('\n')).not.toContain('Waiting on');
  });

  test('agents without todos still draw the Subagents block and the Waiting line', () => {
    const out = lines(hudRows({ todos: [], agents: [AGENTS[0]!] }, { cols: 140, maxRows: 40 }));
    expect(out[0]).toBe('Subagents · 1 running');
    expect(out[out.length - 1]).toBe('⏳ Waiting on verifier agent');
  });

  test('a current tool call shows without the done mark; a missing model drops the badge', () => {
    const a: HudAgent = { name: 'explorer-calc', role: 'explorer', state: 'working', tool: 'grep', target: 'hudRows', task: 'Find callers' };
    expect(lines(hudRows({ todos: [], agents: [a] }, { cols: 80, maxRows: 10 })).slice(1, 3)).toEqual([' └─ • explorer-calc [explorer]: Find callers', '    └ grep: hudRows']);
  });

  test('more than three agents list three and count the rest', () => {
    const many = Array.from({ length: 5 }, (_, i): HudAgent => ({ name: `w${i}`, role: 'explorer', state: 'working' }));
    const out = lines(hudRows({ todos: [], agents: many }, { cols: 80, maxRows: 20 }));
    expect(out[0]).toBe('Subagents · 5 running');
    expect(out).toContain(' └─ … 2 more');
    expect(out.filter((l) => l.includes('• w'))).toHaveLength(3);
  });

  test('the Waiting line names the distinct roles', () => {
    const run = (roles: string[]): HudAgent[] => roles.map((role, i) => ({ name: `n${i}`, role, state: 'working' }));
    expect(waitingText(run(['explorer', 'docs-auditor']))).toBe('Waiting on explorer and docs-auditor agents');
    expect(waitingText(run(['explorer', 'explorer']))).toBe('Waiting on explorer agents');
    expect(waitingText(run(['a', 'b', 'c']))).toBe('Waiting on a, b and c agents');
    expect(waitingText(run(['unknown']))).toBe('Waiting on n0 agent');
  });
});

describe('hud row budget', () => {
  const rowsAt = (maxRows: number): string[] => lines(hudRows({ todos: PLAN, agents: AGENTS }, { cols: 140, maxRows }));

  test('shrinks by collapsing first: previews go before any block is dropped', () => {
    const out = rowsAt(GOLDEN.length - 1);
    expect(out).toHaveLength(GOLDEN.length - 2);
    expect(out.join('\n')).not.toContain('✓ eval');
    expect(out).toContain('Subagents · 2 running');
    expect(out).toContain('⏳ Waiting on verifier and docs-curator agents');
    expect(out).toContain(' ├─ IV. Docs · 0/1');
  });

  test('every budget is respected and blocks drop last: waiting, then subagents, then the tree', () => {
    for (let n = 0; n <= GOLDEN.length; n++) expect(rowsAt(n).length).toBeLessThanOrEqual(n);
    const joined = (n: number): string => rowsAt(n).join('\n');
    expect(joined(9)).toContain('TODO');
    expect(joined(9)).toContain('Subagents');
    expect(joined(2)).not.toContain('Waiting on');
    expect(rowsAt(0)).toEqual([]);
  });

  test('empty input -> no rows', () => {
    expect(hudRows({ todos: [], agents: [] }, { cols: 80, maxRows: 20 })).toEqual([]);
  });

  test('no row is wider than the column budget', () => {
    for (const cols of [20, 40, 60]) for (const r of hudRows({ todos: PLAN, agents: AGENTS }, { cols, maxRows: 40 })) expect(textWidth(text(r))).toBeLessThanOrEqual(cols);
  });
});

describe('hud helpers', () => {
  test('roman numerals', () => {
    expect([1, 2, 3, 4, 9, 14].map(roman)).toEqual(['I', 'II', 'III', 'IV', 'IX', 'XIV']);
  });
  test('truncateMiddle keeps both ends', () => {
    expect(truncateMiddle('abcdefghij', 7)).toBe('abc…hij');
    expect(truncateMiddle('abc', 7)).toBe('abc');
  });
  test('selectCollapsed keeps the active item and one closed row of context', () => {
    const tasks = [todo('a', 'a', 'completed'), todo('b', 'b', 'completed'), todo('c', 'c', 'in_progress'), ...['d', 'e', 'f', 'g'].map((x) => todo(x, x, 'pending'))];
    expect(selectCollapsed(tasks, (t) => t.status === 'in_progress', 2)).toEqual({ items: [tasks[1], tasks[2], tasks[3]], summary: '… 3 more todos' });
  });
});

describe('hud strikethrough element', () => {
  type Node = { kind: string; props: Record<string, any> };
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
  const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
  test('Segment.strike reaches the Text strikethrough prop', () => {
    const row = rowOf(els, [{ t: 'done', strike: true }, { t: 'open' }], 20) as unknown as Node;
    expect((row.props.children as Node[]).map((n) => n.props.strikethrough)).toEqual([true, undefined]);
  });
});

describe('hud budget at the measured AbovePrompt maxRows', () => {
  // Live Claude Code 2.1.312, 200x55 terminal, docked pane: maxRows 18 idle, 15 and 14 with agents running, 10 while the
  // lead works, 6 with the task list drawn. The compact form is TODO + active phase (2 items) + Subagents + 2 agents = 7 rows.
  const input = { todos: PLAN, agents: AGENTS };
  const compact = hudCompactRows(input);
  test('the compact form is the TODO header, active phase rows, the Subagents header and one row per agent', () => {
    expect(compact).toBe(7);
    expect(lines(hudRows(input, { cols: 138, maxRows: compact }))).toEqual([
      'TODO', ' ├─ I. Research · 1/2', ' │  ├─ ☑ Trace history load failure root cause', ' │  └─ ☐ Trace gate path and pre-gate costs',
      'Subagents · 2 running', ' ├─ • ◑ ollama/minima….1-flash:cloud verifier-eval [verifier]: Verify gate fix shows no scorer regression', ' └─ • ◑ anthropic/claude-sonnet-5 docs-curator-gate [docs-curator]: Update docs for gate stage order...',
    ]);
  });
  test('the band gives up rows first: the HUD keeps its compact form at every measured maxRows', () => {
    const take = (maxRows: number): number => hudRows(input, { cols: 138, maxRows: hudBudget(maxRows, compact) }).length;
    expect(take(18)).toBeGreaterThanOrEqual(compact);
    expect(18 - take(18)).toBeGreaterThanOrEqual(7); // roomy: the band keeps its 7 rows
    expect(take(15)).toBeGreaterThanOrEqual(compact);
    expect(take(14)).toBeGreaterThanOrEqual(compact);
    expect(10 - take(10)).toBe(3); // the band shrinks to title, rail and one lane
    expect(take(10)).toBe(compact);
    expect(6 - take(6)).toBeGreaterThanOrEqual(1); // never the whole budget
    expect(take(6)).toBeLessThanOrEqual(5);
  });
  test('budget arithmetic', () => {
    expect([18, 15, 14, 10, 6].map((n) => hudBudget(n, 7))).toEqual([11, 8, 7, 7, 5]);
    expect(hudBudget(0, 7)).toBe(0);
  });
  test('a tight budget still shows the Subagents header and the active phase before dropping the tree', () => {
    const tight = lines(hudRows(input, { cols: 138, maxRows: 5 }));
    expect(tight[0]).toBe('TODO');
    expect(tight).toEqual(['TODO', ' ├─ I. Research · 1/2', ' │  └─ ☐ Trace gate path and pre-gate costs', 'Subagents · 2 running', ' └─ • ◑ ollama/minima….1-flash:cloud verifier-eval [verifier]: Verify gate fix shows no scorer regression']);
  });
});
