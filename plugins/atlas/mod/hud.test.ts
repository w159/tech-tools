// omp-format HUD: the TODO tree, "Subagents · N running" block and "Waiting on ..." line above the band.
// Golden fixture reproduces the omp screenshot scenario; every row's text is asserted exactly.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import type { TodoItem } from './contract';
import { hudAgents, hudBudget, hudCompactRows, hudRows, modelLabel, roman, selectCollapsed, truncateMiddle, waitingText, type HudAgent } from './hud';
import { detailOf } from './data/orchestration';
import { computeCounts, routeCounts } from './data/todos';
import { rowOf, type Segment } from './runs';
import { MOCHA as M, textWidth } from './theme';

const text = (row: Segment[]): string => row.map((s) => s.t).join('');
const lines = (rows: Segment[][]): string[] => rows.map(text);
const solid = (rows: Segment[][]): Segment[][] => rows.filter((r) => text(r) !== '');
const solidLines = (rows: Segment[][]): string[] => lines(solid(rows));
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
  todo('d1', '[docs] Document the stage order', 'pending'),
  { ...todo('x1', 'Dispatch: verifier-eval', 'in_progress'), origin: 'dispatch' } as TodoItem,
  { ...todo('x2', '[research] Dispatch: docs-curator-gate', 'pending'), origin: 'dispatch' } as TodoItem,
];

const AGENTS: HudAgent[] = [
  { name: 'verifier-eval', role: 'verifier', model: 'ollama/minimax-m2.1-flash:cloud', task: 'Verify gate fix shows no scorer regression', state: 'working', lastTool: 'eval', detail: 'Comparing mtimes' },
  { name: 'docs-curator-gate', role: 'docs-curator', model: 'anthropic/claude-sonnet-5', task: 'Update docs for gate stage order, fail-closed decision, backstop', state: 'working', lastTool: 'Read', detail: 'Read CHANGELOG style and top section' },
];

const GOLDEN = [
  '',
  'TODO',
  ' ├─ I. Research · 1/2',
  ' │  ├─ ☑ Trace history load failure root cause',
  ' │  └─ ☐ Trace gate path and pre-gate costs',
  ' ├─ II. Implement · 1/4',
  ' ├─ III. Verify · 0/4',
  ' ├─ IV. Docs · 0/1',
  ' └─────',
  '',
  '',
  'Subagents · 2 running',
  ' ├─ • ◑ ollama/minima….1-flash:cloud verifier-eval [verifier]: Verify gate fix shows no scorer regression',
  ' │  └ ✓ eval: Comparing mtimes',
  ' └─ • ◑ anthropic/claude-sonnet-5 docs-curator-gate [docs-curator]: Update docs for gate stage order, fail-closed decision, backstop',
  '    └ ✓ read: Read CHANGELOG style and top section',
  '',
  '⏳ Waiting on verifier and docs-curator agents',
  '',
];

describe('hud golden', () => {
  test('the omp screenshot scenario renders omp\'s exact rows', () => {
    expect(lines(hudRows({ todos: PLAN, agents: AGENTS }, { cols: 140, maxRows: 40 }))).toEqual(GOLDEN);
  });

  test('completed items are struck through and dim; the in-progress item takes the accent', () => {
    const rows = hudRows({ todos: PLAN, agents: [] }, { cols: 140, maxRows: 40 });
    const done = rows[3]!.find((s) => s.t === 'Trace history load failure root cause')!;
    expect(done).toMatchObject({ strike: true, color: M.muted });
    const active = rows[4]!.find((s) => s.t.includes('Trace gate path'))!;
    expect(active.color).toBe(M.violet);
    expect(active.strike).toBeUndefined();
  });

  test('the spine fills with overall progress: accent cells then dim', () => {
    const rows = hudRows({ todos: PLAN, agents: [] }, { cols: 140, maxRows: 40 });
    expect(rows[2]![1]).toMatchObject({ t: '├─ ', color: M.violet });
    expect(rows[7]![1]).toMatchObject({ t: '├─ ', color: M.grey });
    expect(rows[8]!.map((s) => s.color)).toContain(M.grey); // the tail is not lit while work remains
  });
});

describe('hud todo tree', () => {
  test('phases group in plan order, unphased items go under a final Other, a single phase has no numeral', () => {
    const plan = [todo('a', 'docs first', 'pending', 'docs'), todo('b', 'then research', 'pending', 'research'), todo('c', 'loose', 'pending')];
    expect(lines(hudRows({ todos: plan, agents: [] }, { cols: 80, maxRows: 20 })).filter((l) => l.includes('·'))).toEqual([' ├─ I. Docs · 0/1', ' ├─ II. Research · 0/1', ' ├─ III. Other · 0/1']);
    expect(solidLines(hudRows({ todos: [todo('a', 'solo', 'pending', 'docs')], agents: [] }, { cols: 80, maxRows: 20 }))[1]).toBe(' ├─ Docs · 0/1');
  });

  test('the phase holding the in_progress item is expanded; with none, the first with an open item', () => {
    const plan = [todo('a', 'done', 'completed', 'research'), todo('b', 'open b', 'pending', 'implement'), todo('c', 'working c', 'in_progress', 'verify')];
    expect(lines(hudRows({ todos: plan, agents: [] }, { cols: 80, maxRows: 20 })).join('\n')).toContain('III. Verify · 0/1\n │  └─ ☐ working c');
    const idle = lines(hudRows({ todos: plan.map((t) => (t.status === 'in_progress' ? { ...t, status: 'pending' } : t)), agents: [] }, { cols: 80, maxRows: 20 }));
    expect(idle).toContain(' │  └─ ☐ open b');
  });

  test('a long active phase shows capped items and a "… N more todos" row', () => {
    const plan = [todo('x0', 'now', 'in_progress', 'implement'), ...Array.from({ length: 8 }, (_, i) => todo(`x${i + 1}`, `later ${i + 1}`, 'pending', 'implement'))];
    const out = solidLines(hudRows({ todos: plan, agents: [] }, { cols: 80, maxRows: 20 }));
    expect(out.slice(1, 8)).toEqual([' ├─ Implement · 0/9', ' │  ├─ ☐ now', ' │  ├─ ☐ later 1', ' │  ├─ ☐ later 2', ' │  ├─ ☐ later 3', ' │  ├─ ☐ later 4', ' │  └─ … 4 more todos']);
  });

  test('the content phase prefix is not repeated in the row', () => {
    const out = solidLines(hudRows({ todos: [todo('a', '[research] map auth', 'pending', 'research')], agents: [] }, { cols: 80, maxRows: 20 }));
    expect(out[2]).toBe(' │  └─ ☐ map auth');
  });

  test('a fully done plan lights the whole path', () => {
    const rows = hudRows({ todos: [todo('a', 'a', 'completed', 'research'), todo('b', 'b', 'completed', 'docs')], agents: [] }, { cols: 80, maxRows: 20 });
    const spine = solid(rows).slice(1).map((r) => r[1]!); // the gutter cell of every tree row, and the tail
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
    const out = solidLines(hudRows({ todos: [], agents: [AGENTS[0]!] }, { cols: 140, maxRows: 40 }));
    expect(out[0]).toBe('Subagents · 1 running');
    expect(out[out.length - 1]).toBe('⏳ Waiting on verifier agent');
  });

  test('a current tool call shows without the done mark; a missing model drops the badge', () => {
    const a: HudAgent = { name: 'explorer-calc', role: 'explorer', state: 'working', tool: 'grep', target: 'hudRows', task: 'Find callers' };
    expect(solidLines(hudRows({ todos: [], agents: [a] }, { cols: 80, maxRows: 10 })).slice(1, 3)).toEqual([' └─ • explorer-calc [explorer]: Find callers', '    └ grep: hudRows']);
  });

  test('more than three agents list three and count the rest', () => {
    const many = Array.from({ length: 5 }, (_, i): HudAgent => ({ name: `w${i}`, role: 'explorer', state: 'working' }));
    const out = solidLines(hudRows({ todos: [], agents: many }, { cols: 80, maxRows: 20 }));
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

  test('spacer rows go first under pressure, then previews, before any block is dropped', () => {
    const noBlanks = GOLDEN.filter((l) => l !== '');
    expect(rowsAt(GOLDEN.length)).toEqual(GOLDEN);
    expect(rowsAt(GOLDEN.length - 1)).toEqual(noBlanks); // one row short: all spacers drop, nothing else
    expect(rowsAt(noBlanks.length)).toEqual(noBlanks);
    const out = rowsAt(noBlanks.length - 1); // one more row short: now the previews go
    expect(out).toHaveLength(noBlanks.length - 2);
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

  test('blank rows at the measured maxRows 18/14/10/6', () => {
    const at = (n: number): string[] => lines(hudRows({ todos: PLAN, agents: AGENTS }, { cols: 140, maxRows: n }));
    expect(at(19)).toEqual(GOLDEN); // room for every spacer
    expect(at(18)).toEqual(GOLDEN.filter((l) => l !== '')); // 18 and 14: the five spacers drop first, content intact
    expect(at(14)).toEqual(GOLDEN.filter((l) => l !== ''));
    expect(at(10).filter((l) => l === '')).toEqual([]);
    expect(at(10)).toHaveLength(9); // previews shed, never a spacer
    expect(at(6).filter((l) => l === '')).toEqual([]);
    expect(at(6).length).toBeLessThanOrEqual(6);
  });

  test('empty input -> no rows', () => {
    expect(hudRows({ todos: [], agents: [] }, { cols: 80, maxRows: 20 })).toEqual([]);
  });

  test('no row is wider than the column budget', () => {
    for (const cols of [20, 40, 60]) for (const r of hudRows({ todos: PLAN, agents: AGENTS }, { cols, maxRows: 40 })) expect(textWidth(text(r))).toBeLessThanOrEqual(cols);
  });
});

describe('hud label phases and dispatch rows', () => {
  const run = (todos: TodoItem[]): string[] => solidLines(hudRows({ todos, agents: [] }, { cols: 100, maxRows: 40 }));
  test('a [label] prefix that is not a contract phase gets its own group, prefix stripped, in first-seen order', () => {
    const plan = [todo('a', '[docs] write it', 'pending'), todo('b', '[research] look', 'pending', 'research'), todo('c', '[docs] ship it', 'completed'), todo('d', 'loose', 'pending')];
    expect(run(plan).filter((l) => l.includes('·'))).toEqual([' ├─ I. Docs · 1/2', ' ├─ II. Research · 0/1', ' ├─ III. Other · 0/1']);
    expect(run(plan).join('\n')).not.toContain('[docs]');
  });
  test('origin dispatch items are absent from the tree and its totals', () => {
    const dispatch = { ...todo('x', 'Dispatch row', 'in_progress', 'verify'), origin: 'dispatch' } as TodoItem;
    const out = run([todo('a', 'plan item', 'completed', 'research'), dispatch]);
    expect(out.join('\n')).not.toContain('Dispatch row');
    expect(out).toContain(' ├─ Research · 1/1');
    expect(out.join('\n')).not.toContain('Verify');
    expect(hudRows({ todos: [dispatch], agents: [] }, { cols: 80, maxRows: 20 })).toEqual([]);
  });
});

describe('hud counts', () => {
  const contract = { todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done'], itemPhasePrefix: '[<phase>] ' } as never;
  const rows = [
    { ...todo('a', '[research] a', 'completed', 'research') },
    { ...todo('b', '[docs] b', 'completed') },
    ...Array.from({ length: 9 }, (_, i) => todo(`p${i}`, `p${i}`, 'pending', i % 2 ? 'implement' : undefined)),
    { ...todo('x', 'dispatch', 'completed'), origin: 'dispatch' },
    { ...todo('y', 'dispatch 2', 'pending'), origin: 'dispatch' },
  ] as TodoItem[];
  test('computeCounts counts the plan only: 2/11 with two dispatch rows present', () => {
    const c = computeCounts(rows, contract);
    expect([c.done, c.total]).toEqual([2, 11]);
  });
  test('routeCounts counts the same plan from the groups (label and unphased items included, dispatch rows not)', () => {
    const g = (phase: string, items: { id: string; status: string; origin?: string }[]) => ({ phase, dept: '', glyph: '', done: 0, total: items.length, items: items.map((i) => ({ content: '', owner: null, evidence: null, live: true, ...i })) });
    const groups = [g('research', [{ id: 'a', status: 'completed' }]), g('unsorted', [{ id: 'b', status: 'completed' }, { id: 'c', status: 'pending' }, { id: 'd', status: 'completed', origin: 'dispatch' }]), g('advisor', [{ id: 'e', status: 'pending' }])];
    expect(routeCounts(groups as never, contract)).toEqual({ done: 2, total: 3 });
  });
});

describe('hud model label and tool preview', () => {
  test('provider/model like omp: ids with a provider pass through, bare aliases and ids get anthropic/', () => {
    expect(modelLabel('anthropic/claude-sonnet-5-5')).toBe('anthropic/claude-sonnet-5-5');
    expect(modelLabel('claude-sonnet-5-5')).toBe('anthropic/claude-sonnet-5-5');
    expect(modelLabel('sonnet')).toBe('anthropic/sonnet');
    const a: HudAgent = { name: 'w', role: 'explorer', state: 'working', model: 'sonnet' };
    expect(lines(hudRows({ todos: [], agents: [a] }, { cols: 80, maxRows: 10 }))[2]).toBe(' └─ • ◑ anthropic/sonnet w [explorer]');
    const long: HudAgent = { ...a, model: 'ollama/minimax-m2.1-flash:cloud' };
    expect(lines(hudRows({ todos: [], agents: [long] }, { cols: 80, maxRows: 10 }))[2]).toContain('ollama/minima….1-flash:cloud w');
  });
  test('detailOf: Bash -> description else command, Read -> relative-ready path with range, Grep/Glob -> pattern, others -> description', () => {
    expect(detailOf('Bash', { command: 'ls -la', description: 'List files' })).toBe('List files');
    expect(detailOf('Bash', { command: 'ls   -la\nfoo' })).toBe('ls -la foo');
    expect(detailOf('Read', { file_path: '/p/a.ts' })).toBe('Read /p/a.ts');
    expect(detailOf('Read', { file_path: '/p/a.ts', offset: 10, limit: 5 })).toBe('Read /p/a.ts:10-14');
    expect(detailOf('Grep', { pattern: 'foo.*bar', path: '/p' })).toBe('foo.*bar');
    expect(detailOf('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
    expect(detailOf('Agent', { description: 'Map auth', prompt: 'x' })).toBe('Map auth');
    expect(detailOf('Edit', { file_path: '/p/a.ts', old_string: 'a' })).toBe('/p/a.ts');
    expect(detailOf('Bash', {})).toBeUndefined();
  });
  test('the preview row lower-cases the tool, shows the detail, relativizes paths and fits cols', () => {
    const a: HudAgent = { name: 'w', role: 'explorer', state: 'working', tool: 'Read', detail: 'Read /proj/mod/hud.ts:1-20' };
    const out = (agent: HudAgent, cols = 80): string[] => lines(hudRows({ todos: [], agents: [agent], root: '/proj' }, { cols, maxRows: 10 }));
    expect(out(a)[3]).toBe('    └ read: Read mod/hud.ts:1-20');
    expect(out({ ...a, tool: null, lastTool: 'Bash', detail: 'Comparing mtimes' })[3]).toBe('    └ ✓ bash: Comparing mtimes');
    expect(textWidth(out(a, 24)[3]!)).toBeLessThanOrEqual(24);
    expect(out({ ...a, detail: undefined, target: 'hud.ts' })[3]).toBe('    └ read: hud.ts');
  });
  test('hudAgents carries the live detail', () => {
    const live = [{ name: 'w', role: 'explorer', state: 'working', tool: 'Read', lastTool: null, since: 0, startedAt: 0, target: null, detail: 'Read x', lastLine: '', calls: [], scope: null }] as never;
    expect(hudAgents(live, [{ name: 'w', persona: 'explorer', state: 'running', source: 'task', model: 'claude-sonnet-5-5' }])[0]).toMatchObject({ detail: 'Read x', model: 'claude-sonnet-5-5' });
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
      'Subagents · 2 running', ' ├─ • ◑ ollama/minima….1-flash:cloud verifier-eval [verifier]: Verify gate fix shows no scorer regression', ' └─ • ◑ anthropic/claude-sonnet-5 docs-curator-gate [docs-curator]: Update docs for gate stage order, fail-closed decision, backstop',
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
  test('a tight budget keeps the Subagents header and every agent, shrinking the tree to a one-row summary', () => {
    const tight = lines(hudRows(input, { cols: 138, maxRows: 5 }));
    expect(tight.length).toBeLessThanOrEqual(5);
    expect(tight[0]).toBe('TODO · 2/11 · Trace gate path and pre-gate costs');
    expect(tight[1]).toBe('Subagents · 2 running');
    expect(tight.filter((l) => l.includes('verifier-eval') || l.includes('docs-curator-gate'))).toHaveLength(2);
  });
});

describe('hud ladder keeps Subagents over the TODO tree', () => {
  const phases = ['research', 'implement', 'verify', 'docs'];
  const bigPlan: TodoItem[] = Array.from({ length: 11 }, (_, i) =>
    todo(`b${i}`, `Item number ${i}`, i === 0 ? 'completed' : i === 1 ? 'in_progress' : 'pending', phases[Math.min(3, Math.floor(i / 3))]));
  const two: HudAgent[] = [
    { name: 'a-one', role: 'explorer', task: 'first task', state: 'working' },
    { name: 'a-two', role: 'verifier', task: 'second task', state: 'working' },
  ];

  test('budgets 2..8 with two running agents always keep the Subagents header', () => {
    for (let maxRows = 2; maxRows <= 8; maxRows++) {
      const out = lines(hudRows({ todos: bigPlan, agents: two }, { cols: 100, maxRows }));
      expect(out.length).toBeLessThanOrEqual(maxRows);
      expect(out.some((l) => l.startsWith('Subagents'))).toBe(true);
    }
  });

  test('a one-row TODO summary shows at small budgets, with the active item', () => {
    const out = lines(hudRows({ todos: bigPlan, agents: two }, { cols: 100, maxRows: 4 }));
    expect(out[0]).toBe('TODO · 1/11 · Item number 1');
    expect(out.some((l) => l.startsWith('Subagents'))).toBe(true);
    expect(out.filter((l) => l.includes('├─ I.'))).toEqual([]);
  });

  test('no running agents: the tree shrinks as before and never becomes a summary', () => {
    for (let maxRows = 1; maxRows <= 8; maxRows++) {
      const out = lines(hudRows({ todos: bigPlan, agents: [] }, { cols: 100, maxRows }));
      expect(out.every((l) => !l.startsWith('TODO ·'))).toBe(true);
    }
    expect(lines(hudRows({ todos: bigPlan, agents: [] }, { cols: 100, maxRows: 2 }))).toEqual([]);
  });

  test('"Research: x" / "Implement: y" items group by phase and show without the prefix', () => {
    const plan = [todo('a', 'Research: map the code', 'in_progress'), todo('b', 'Implement - patch it', 'pending'), todo('c', 'research: second look', 'pending')];
    const out = solidLines(hudRows({ todos: plan, agents: [] }, { cols: 100, maxRows: 20 }));
    expect(out).toContain(' ├─ I. Research · 0/2');
    expect(out).toContain(' │  ├─ ☐ map the code');
    expect(out.some((l) => l.includes('II. Implement · 0/1'))).toBe(true);
    expect(out.join('\n')).not.toContain('Research:');
  });

  test('an unknown "Note: z" prefix stays under Other with its text intact; a stamped phase wins', () => {
    const note = solidLines(hudRows({ todos: [todo('a', 'Note: z', 'pending')], agents: [] }, { cols: 100, maxRows: 20 }));
    expect(note[1]).toBe(' ├─ Other · 0/1');
    expect(note.some((l) => l.includes('☐ Note: z'))).toBe(true);
    const stamped = solidLines(hudRows({ todos: [todo('b', 'Research: keep stamp', 'in_progress', 'verify')], agents: [] }, { cols: 100, maxRows: 20 }));
    expect(stamped.some((l) => l.includes('Verify · 0/1'))).toBe(true);
    expect(stamped.some((l) => l.includes('Research: keep stamp'))).toBe(true);
  });
});

describe('hud never hides a running agent silently, nor draws an empty HUD at a tight slot', () => {
  const plan: TodoItem[] = Array.from({ length: 11 }, (_, i) => todo(`c${i}`, `Step ${i}`, i === 1 ? 'in_progress' : 'pending', ['research', 'implement', 'verify', 'docs'][i % 4]));
  const mk = (n: number): HudAgent[] => Array.from({ length: n }, (_, i) => ({ name: `ag-${i}`, role: 'explorer', task: `task ${i}`, state: 'working' as const }));
  const shownAgents = (out: string[]): number => out.filter((l) => /ag-\d/.test(l)).length;
  const moreCount = (out: string[]): number => Number(out.map((l) => /… (\d+) more$/.exec(l)?.[1]).find((n) => n !== undefined) ?? 0);

  test('2 running agents at budgets 2..8: agent rows shown plus the "… N more" count equal the running count', () => {
    for (const todos of [plan, []]) {
      for (let maxRows = 2; maxRows <= 8; maxRows++) {
        const out = lines(hudRows({ todos, agents: mk(2) }, { cols: 100, maxRows }));
        expect(out.length).toBeLessThanOrEqual(maxRows);
        expect(out.some((l) => l.startsWith('Subagents'))).toBe(true);
        expect(shownAgents(out) + moreCount(out)).toBe(2);
      }
    }
  });

  test('hudRows at maxRows 1, 2, 3 with agents running', () => {
    expect(lines(hudRows({ todos: plan, agents: mk(2) }, { cols: 100, maxRows: 1 }))).toEqual(['Subagents · 2 running']);
    expect(lines(hudRows({ todos: plan, agents: mk(2) }, { cols: 100, maxRows: 2 }))).toEqual(['Subagents · 2 running', ' └─ … 2 more']);
    expect(lines(hudRows({ todos: plan, agents: mk(1) }, { cols: 100, maxRows: 2 })).slice(0, 1)).toEqual(['Subagents · 1 running']);
    for (const n of [1, 2, 3]) expect(hudRows({ todos: plan, agents: mk(n) }, { cols: 100, maxRows: 3 }).length).toBeGreaterThanOrEqual(2);
  });

  test('hudBudget gives a running agent at least 2 rows once maxRows >= 2', () => {
    for (let maxRows = 2; maxRows <= 20; maxRows++) expect(hudBudget(maxRows, 7, 7, true)).toBeGreaterThanOrEqual(2);
    expect(hudBudget(1, 7, 7, true)).toBe(1);
    expect(hudBudget(2, 7)).toBe(1); // no agent running: unchanged
    expect(hudBudget(0, 7, 7, true)).toBe(0);
  });
});
