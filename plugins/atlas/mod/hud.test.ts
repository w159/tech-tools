// The HUD (TODO tree and Subagents block) in the rev 4 ATLAS design: the design goldens through the Claude Code adapter,
// the live defects L1 (completed rows vanish), L2 ("3 more todos not shown" hides the plan), L11 (unnamed agents), the restored
// Subagents block, R5 (hardcoded check mark, bullet, ellipsis) and the row budget. omp/hud-paint.test.ts holds the parity half.
import { describe, expect, test } from 'claude-code/testing';
import { world } from '../contracts/band-world';
import { worldHudAgents, worldPhases, worldPlan as worldPlanOf } from '../contracts/hud-world';
import { subagents_120, subagents_120_rich, subagents_80, todo_120, todo_120_rich, todo_40, todo_80 } from '../contracts/hud-golden';
import type { TodoItem } from './contract';
import type { Ui } from './atlas-ui';
import { PALETTES } from './atlas-ui';
import { agentModel, agentName, displayName, hudAgents, hudBudget, hudCompactRows, hudLines, hudListsAgents, hudRows, isRunning, shortModel, todoModel, type HudAgent, type HudInput } from './hud';
import { computeCounts, routeCounts } from './data/todos';
import { effectiveRows, inlineBelowRows } from './register';
import type { Segment } from './runs';
import { textWidth } from './theme';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const text = (row: Segment[]): string => row.map((s) => s.t).join('');
const lines = (rows: Segment[][]): string[] => rows.map(text);
// The design goldens draw the first spinner frame; a row's frame is spinFrameOf(now, name), so the goldens compare with the frame normalised.
const unspin = (l: string): string => l.replace(/[◐◓◑◒]/g, '◐');
const trimmed = (rows: Segment[][]): string[] => lines(rows).map((l) => unspin(l.trimEnd()));
const todo = (id: string, content: string, status: string, extra: Partial<TodoItem> | string = {}): TodoItem => ({ id, content, status, ...(typeof extra === 'string' ? { phase: extra as TodoItem['phase'] } : extra) });

const worldPlan = worldPlanOf;
const worldAgents = worldHudAgents;
const view = (cols: number, rich = false, maxRows = 60) => ({ cols, maxRows, ui, rich, now: 0 });
const phases = worldPhases();

// The first row of the HUD runs its rule on to the last cell (mod/hud-surface.ts ruleToEdge) so the host's `[-]` marker sits at the rule's end: the design golden's first row, with its rule 2 cells shorter before the count and 3 after it.
const edge = (rows: readonly string[]): string[] => [rows[0]!.replace(/(━{6,})( \d+ of \d+ done)$/, (_m, f: string, c: string) => `${f.slice(2)}${c} ━━━`), ...rows.slice(1)];
describe('hud goldens through the Claude Code adapter (rev 4)', () => {
  test('TODO at 120, 120 rich, 80, 60 and 40 equals the design goldens', () => {
    const input: HudInput = { todos: worldPlan(), agents: [], phases };
    expect(trimmed(hudRows(input, view(120)))).toEqual(edge(todo_120));
    expect(trimmed(hudRows(input, view(120, true)))).toEqual(edge(todo_120_rich));
    expect(trimmed(hudRows(input, view(80)))).toEqual(edge(todo_80));
    expect(trimmed(hudRows(input, view(40)))).toEqual(edge(todo_40));
    expect(trimmed(hudRows(input, view(60))).slice(1)).toEqual(todo_40.slice(1));
  });
  test('SUBAGENTS at 120, 120 rich and 80 equals the design goldens; 60 and 40 draw none', () => {
    const block = (cols: number, rich = false): string[] => {
      const rows = trimmed(hudRows({ todos: worldPlan(), agents: worldAgents(), phases }, view(cols, rich)));
      return rows.slice(rows.findIndex((l) => l.includes('SUBAGENTS')));
    };
    expect(block(120)).toEqual([...subagents_120]);
    expect(block(120, true)).toEqual([...subagents_120_rich]);
    expect(block(80)).toEqual([...subagents_80]);
    for (const cols of [60, 40]) expect(trimmed(hudRows({ todos: worldPlan(), agents: worldAgents() }, view(cols))).join('\n')).not.toContain('SUBAGENTS');
    expect(hudRows({ todos: [], agents: worldAgents() }, view(60))).toEqual([]);
  });
  test('both blocks stack as the TODO golden, a blank row, then the SUBAGENTS golden', () => {
    const rows = trimmed(hudRows({ todos: worldPlan(), agents: worldAgents() }, view(120)));
    expect(rows).toEqual([...edge(todo_120), '', ...subagents_120]);
  });
  test('every row is padded to the width and none is wider', () => {
    for (const cols of [120, 80, 60, 40]) for (const r of hudRows({ todos: worldPlan(), agents: worldAgents() }, view(cols))) expect(textWidth(text(r))).toBe(cols);
  });
  test('the rows carry the rev 4 panel background, never the legacy #11111b', () => {
    const bgs = new Set(hudRows({ todos: worldPlan(), agents: worldAgents() }, view(120)).flat().filter((s) => s.t.trim() !== '' || s.bg).map((s) => s.bg));
    expect(bgs.has('#11111b')).toBe(false);
    expect(bgs.has(PALETTES.mocha.panel)).toBe(true);
  });
  test('NO_COLOR keeps the words and drops every colour', () => {
    const rows = hudRows({ todos: worldPlan(), agents: worldAgents() }, { ...view(120), ui: { ...ui, color: 'none' } });
    expect(rows.flat().some((s) => s.color !== undefined || s.bg !== undefined)).toBe(false);
    expect(lines(rows).join('\n')).toContain('running');
  });
  test('ASCII mode draws no glyph outside ASCII except the box rule', () => {
    const rows = hudRows({ todos: worldPlan(), agents: worldAgents() }, { ...view(120), ui: { ...ui, ascii: true } });
    expect(lines(rows).join('').replace(/[\u2500-\u257f]/g, '')).toMatch(/^[\x20-\x7e·]*$/);
  });
});

describe('L1: a completed plan row is shown as completed', () => {
  const plan = [todo('a', 'Trace the failure', 'completed'), todo('b', 'Patch the gate', 'in_progress'), todo('c', 'Run the suite', 'pending')];
  test('the done row stays in the tree with the done glyph, the word and a struck label', () => {
    const rows = hudRows({ todos: plan, agents: [] }, view(120));
    const row = rows.find((r) => text(r).includes('Trace the failure'))!;
    expect(row).toBeDefined();
    expect(text(row)).toMatch(/^ {2}● Trace the failure +done/);
    expect(row.find((s) => s.t === 'Trace the failure')?.strike).toBe(true);
  });
  test('when every row is done they all show, and the header says so', () => {
    const rows = trimmed(hudRows({ todos: plan.map((t) => ({ ...t, status: 'completed' })), agents: [] }, view(120)));
    expect(rows[0]).toContain('3 of 3 done');
    expect(rows.filter((l) => l.includes('done') && l.includes('●'))).toHaveLength(3);
  });
  test('a plan row that completes appears in the next render with state done', () => {
    const before = todoModel(plan, 0);
    const after = todoModel(plan.map((t) => (t.id === 'b' ? { ...t, status: 'completed' } : t)), 0);
    expect(before.map((r) => r.state)).toEqual(['done', 'running', 'queued']);
    expect(after.map((r) => r.state)).toEqual(['done', 'done', 'queued']);
  });
});

describe('L2: the plan is not cut to "N more todos not shown"', () => {
  const big = Array.from({ length: 12 }, (_, i) => todo(`t${i}`, `Step ${i + 1}`, i < 2 ? 'completed' : i === 2 ? 'in_progress' : 'pending'));
  test('a 12 row plan at a 45 row height shows all 12 rows and no more-todos row', () => {
    const rows = trimmed(hudRows({ todos: big, agents: [] }, view(120, false, 45)));
    for (let i = 1; i <= 12; i++) expect(rows.some((l) => new RegExp(`Step ${i}( |$)`).test(l))).toBe(true);
    expect(rows.join('\n')).not.toMatch(/more todo/);
  });
  test('under a tight budget the hidden rows are counted exactly, never hidden silently', () => {
    for (let h = 2; h <= 16; h++) {
      const rows = trimmed(hudRows({ todos: big, agents: [] }, view(120, false, h)));
      expect(rows.length).toBeLessThanOrEqual(h);
      const shown = rows.filter((l) => /Step \d+/.test(l)).length;
      const hidden = Number(/(\d+) more todos?/.exec(rows.join('\n'))?.[1] ?? 0);
      if (rows.length > 1) expect(shown + hidden).toBe(12);
    }
  });
  test('the ribbon count stays the whole plan at every height', () => {
    for (let h = 1; h <= 16; h++) expect(trimmed(hudRows({ todos: big, agents: [] }, view(120, false, h)))[0]).toContain('2 of 12 done');
  });
});

describe('L11: agents are named', () => {
  test('the dispatch name wins', () => {
    expect(agentName('explorer-calc', 'explorer', 'Map band row count')).toBe('explorer-calc');
  });
  test('a host id falls back to the description prefix, then the role', () => {
    expect(agentName('a6839f49ee72a2b14', 'explorer', 'readme-explorer: compare README and AGENTS')).toBe('readme-explorer');
    expect(agentName('a6839f49ee72a2b14', 'explorer', 'Map band row count')).toBe('explorer-map-band-row'); // A5: the type and a short task phrase
    expect(agentName('a6839f49ee72a2b14', 'explorer', undefined)).toBe('explorer');
    expect(agentName('a6839f49ee72a2b14', 'unknown', undefined)).toBe('a6839f');
  });
  test('A5: a type-plus-hex name (explorer-3fa9c1) or a bare 6-hex id reads as the description name, else type and task; the id is the last resort', () => {
    expect(agentName('explorer-3fa9c1', 'explorer', 'readme-explorer: compare README and AGENTS')).toBe('readme-explorer');
    expect(agentName('explorer-3fa9c1', 'explorer', 'Map band row count')).toBe('explorer-map-band-row');
    expect(agentName('3fa9c1', 'implementer', 'Fix the gate order')).toBe('implementer-fix-the-gate');
    expect(agentName('explorer-3fa9c1', 'explorer', undefined)).toBe('explorer-3fa9c1'); // nothing better is known
    expect(agentName('3fa9c1', 'unknown', undefined)).toBe('3fa9c1');
    // a real dispatch name that merely ends in hex-looking letters is not a hash
    expect(agentName('explorer-decade', 'explorer', 'Map it')).toBe('explorer-decade');
    expect(agentName('team-2024', 'explorer', 'Map it')).toBe('team-2024');
    expect(agentName('impl-hud', 'implementer', 'Fix it')).toBe('impl-hud');
  });
  test('A5: an agent renamed for display still owns the plan rows its raw name owns', () => {
    const live = [{ name: 'explorer-3fa9c1', role: 'explorer', state: 'working', tool: 'Read', lastTool: null, since: 0, startedAt: 0, target: 'a.py', detail: null, lastLine: '', calls: [], scope: null }] as never;
    const squad = [{ name: 'explorer-3fa9c1', persona: 'explorer', state: 'running', source: 'task', task: 'alpha-explorer: read alpha.py' }] as never;
    const agents = hudAgents(live, squad);
    const rows = trimmed(hudRows({ todos: [{ ...todo('t1', 'T1 read alpha.py', 'in_progress'), owner: 'explorer-3fa9c1' }], agents }, view(120)));
    expect(rows.join('\n')).toMatch(/▸ ◐ alpha-explorer +running +\S* *T1 /);
  });
  test('hudAgents carries the name through, and the block shows it', () => {
    const live = [{ name: 'a6839f49ee72a2b14', role: 'explorer', state: 'working', tool: 'Read', lastTool: null, since: 0, startedAt: 0, target: 'mod/hud.ts', detail: null, lastLine: '', calls: [], scope: null }] as never;
    const squad = [{ name: 'a6839f49ee72a2b14', persona: 'explorer', state: 'running', source: 'task', task: 'band-explorer: map the band rows', model: 'claude-sonnet-5' }] as never;
    const [agent] = hudAgents(live, squad);
    expect(agent).toMatchObject({ name: 'band-explorer', model: 'claude-sonnet-5' });
    const out = trimmed(hudRows({ todos: [], agents: [agent!] }, view(120))).join('\n');
    expect(out).toContain('band-explorer');
    expect(out).toContain('sonnet-5');
  });
});

describe('the Subagents block is back on Claude Code', () => {
  const running: HudAgent = { name: 'impl-hud', role: 'implementer', state: 'working', model: 'claude-opus-5', tool: 'Read', target: 'mod/hud.ts:12' };
  test('a running agent draws the SUBAGENTS ribbon with its name, state, model and last action', () => {
    const rows = trimmed(hudRows({ todos: [], agents: [running] }, view(120)));
    expect(rows[0]).toContain('SUBAGENTS');
    expect(rows[0]).toContain('1 running');
    expect(rows[2]).toMatch(/^▸ ◐ impl-hud +running +opus-5 +read mod\/hud\.ts:12$/);
  });
  test('with nothing running the block is absent, even with finished agents', () => {
    expect(hudRows({ todos: [], agents: [{ ...running, state: 'done' }] }, view(120))).toEqual([]);
    expect(isRunning({ ...running, state: 'done' })).toBe(false);
  });
  test('with nothing running, agents that finished within the linger window still show as done; older ones are gone', () => {
    const done = (n: string, ago: number): HudAgent => ({ ...running, name: n, state: 'done', ui: 'done', since: 100_000 - ago });
    const at = (ago: number) => trimmed(hudRows({ todos: [], agents: ['a-one', 'a-two', 'a-three'].map((n) => done(n, ago)) }, { ...view(120), now: 100_000 }));
    const recent = at(2_000);
    expect(recent[0]).toContain('SUBAGENTS');
    expect(recent[0]).toContain('3 done');
    expect(recent.filter((l) => /^[ ▸] ● /.test(l))).toHaveLength(3);
    expect(at(20_000)).toEqual([]);
  });
  test('with nothing running, a failed agent stays however long ago it failed', () => {
    const failed: HudAgent = { ...running, name: 'a-bad', state: 'failed', ui: 'failed', since: 100_000 - 60_000 };
    const rows = trimmed(hudRows({ todos: [], agents: [failed] }, { ...view(120), now: 100_000 }));
    expect(rows[0]).toContain('SUBAGENTS');
    expect(rows.filter((l) => /^[ ▸] ■ a-bad/.test(l))).toHaveLength(1);
  });
  test('LAST is the agent\'s last tool and target, not its free-text report (critique 8: three rows read the same posting step)', () => {
    const done = (name: string, lastTool: string, target: string | null, detail: string, lastLine: string): HudAgent => ({ name, role: 'explorer', state: 'done', ui: 'done', tool: null, lastTool, target, detail, lastLine });
    const rows = agentModel([done('alpha', 'Read', 'alpha.py', 'Read /r/alpha.py', 'Read alpha.py -> first 3 lines: 1 def'), done('beta', 'Grep', null, 'def main', ''), done('gamma', '', null, '', 'all green')], []);
    expect(rows.map((r) => r.tool)).toEqual(['read alpha.py', 'grep def main', 'all green']); // call first, the report only when there is no call
  });
  test('a finished agent shows beside a running one, and the header counts every row', () => {
    const rows = trimmed(hudRows({ todos: [], agents: [{ ...running, name: 'a-done', state: 'done', lastLine: '9 of 9 steps' }, running] }, view(120)));
    expect(rows[0]).toContain('1 running');
    expect(rows[0]).toContain('1 done');
    expect(rows.filter((l) => /^[ ▸] [◐●] /.test(l))).toHaveLength(2);
    expect(rows[2]).toContain('impl-hud'); // running first
  });
  test('the T column is the position of the plan row the agent owns', () => {
    const plan = [todo('a', 'First', 'completed'), todo('b', 'Second', 'in_progress', { owner: 'impl-hud' })];
    expect(trimmed(hudRows({ todos: plan, agents: [running] }, view(120))).join('\n')).toMatch(/impl-hud +running +opus-5 +T2 +read/);
  });
  test('shortModel drops the provider and claude- prefix and guesses nothing', () => {
    expect(shortModel('anthropic/claude-sonnet-5')).toBe('sonnet-5');
    expect(shortModel('opus')).toBe('opus');
    expect(shortModel(undefined)).toBe('');
  });
});

describe('R5: no hardcoded check mark, bullet or ellipsis', () => {
  test('no ✓ • … ☐ ☑ ⏳ in any state', () => {
    const everything = hudRows({ todos: worldPlan(), agents: worldAgents() }, view(120, true)).concat(hudRows({ todos: Array.from({ length: 40 }, (_, i) => todo(`x${i}`, `Item ${i}`, 'pending')), agents: worldAgents() }, view(120, false, 8)));
    expect(lines(everything).join('')).not.toMatch(/[✓•…☐☑⏳]/);
  });
  test('done rows use the state glyph ●', () => {
    expect(trimmed(hudRows({ todos: [todo('a', 'x', 'completed')], agents: [] }, view(120))).join('\n')).toContain('● x');
  });
});

describe('header counts equal the row sums', () => {
  test('TODO and SUBAGENTS counts match the rows of the world', () => {
    const rows = trimmed(hudRows({ todos: worldPlan(), agents: worldAgents() }, view(120)));
    expect(rows[0]).toContain(`${world.todos.filter((t) => t.state === 'done').length} of ${world.todos.length} done`);
    const sub = rows.find((l) => l.includes('SUBAGENTS'))!;
    for (const s of ['queued', 'running', 'done', 'failed'] as const) {
      const n = world.workers.filter((w) => w.state === s).length;
      expect(sub).toContain(`${n} ${s}`);
    }
  });
});

describe('hud row budget', () => {
  const plan = worldPlan();
  const agents = worldAgents();
  test('every budget is respected', () => {
    for (let h = 0; h <= 30; h++) expect(hudRows({ todos: plan, agents }, view(120, false, h)).length).toBeLessThanOrEqual(h);
  });
  test('a running agent keeps its row before the plan keeps its last row', () => {
    for (let h = 3; h <= 8; h++) expect(trimmed(hudRows({ todos: plan, agents }, view(120, false, h))).join('\n')).toContain('implementer-band');
  });
  test('one row is the Subagents ribbon while an agent runs, else the TODO ribbon', () => {
    expect(trimmed(hudRows({ todos: plan, agents }, view(120, false, 1)))[0]).toContain('SUBAGENTS');
    expect(trimmed(hudRows({ todos: plan, agents: [] }, view(120, false, 1)))[0]).toContain('TODO');
  });
  test('empty input -> no rows; dispatch rows are not plan rows', () => {
    expect(hudRows({ todos: [], agents: [] }, view(120))).toEqual([]);
    expect(hudRows({ todos: [{ ...todo('x', 'Dispatch row', 'in_progress'), origin: 'dispatch' }], agents: [] }, view(80, false, 20))).toEqual([]);
    expect(hudLines({ todos: [], agents: [] }, view(120))).toEqual([]);
  });
  test('hudCompactRows is the least the HUD keeps; hudBudget gives a running agent at least 2 rows', () => {
    expect(hudCompactRows({ todos: plan, agents })).toBe(6 + 4); // TODO ribbon, 4 rows and the overflow row (a plan of five shows whole); Subagents ribbon, 2 agents and the overflow row: no column header, it is drawn only when the budget allows
    expect(trimmed(hudRows({ todos: plan, agents }, view(120, false, 6 + 5))).join('\n')).toContain('AGENT'); // one row beyond the floor: the column names return
    for (let maxRows = 2; maxRows <= 20; maxRows++) expect(hudBudget(maxRows, 7, 7, true)).toBeGreaterThanOrEqual(2);
    expect(hudBudget(1, 7, 7, true)).toBe(1);
    expect(hudBudget(2, 7)).toBe(2);
    expect(hudBudget(0, 7, 7, true)).toBe(0);
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


const PLAN: TodoItem[] = [
  todo('r1', 'Trace history load failure root cause', 'completed'), todo('r2', 'Trace gate path and pre-gate costs', 'in_progress'),
  todo('i1', 'Patch the gate stage order', 'completed'), todo('i2', 'Add scorer regression test', 'pending'), todo('i3', 'Wire the kill switch', 'pending'),
  todo('i4', 'Update the fixtures', 'pending'), todo('v1', 'Run the full suite', 'pending'), todo('v2', 'Run the type check', 'pending'),
  todo('v3', 'Run lint', 'pending'), todo('v4', 'Review the diff', 'pending'), todo('d1', 'Document the stage order', 'pending'),
];
const AGENTS: HudAgent[] = [
  { name: 'verifier-eval', role: 'verifier', model: 'ollama/minimax-m2.1-flash:cloud', task: 'Verify gate fix shows no scorer regression', state: 'working', lastTool: 'eval', detail: 'Comparing mtimes' },
  { name: 'docs-curator-gate', role: 'docs-curator', model: 'anthropic/claude-sonnet-5', task: 'Update docs for gate stage order', state: 'working', lastTool: 'Read', detail: 'Read CHANGELOG style' },
];

describe('inline renderer budget (viewport less the rows below the AbovePrompt slot)', () => {
  const input = { todos: PLAN, agents: AGENTS };
  const hudAt = (viewportRows: number, statusRows: number | null = 4): string[] => {
    const eff = effectiveRows(viewportRows, { rows: viewportRows, isFullscreen: false }, statusRows, 2); // the slot is the whole terminal
    return lines(hudRows(input, { cols: 138, maxRows: hudBudget(eff, hudCompactRows(input), 7, true), ui }));
  };
  test('rows below the slot: prompt 3, status line, mode line and blank 2, the blank row above the prompt 1, agent list main + one per running agent', () => {
    expect(inlineBelowRows(4, 2)).toBe(3 + 4 + 2 + 3 + 1);
    expect(inlineBelowRows(null, 0)).toBe(3 + 5 + 2 + 1);
  });
  test('fullscreen and a missing viewport keep the slot as reported; inline takes the smaller of slot and viewport less below', () => {
    expect(effectiveRows(18, { rows: 24, isFullscreen: true }, 4, 2)).toBe(18);
    expect(effectiveRows(18, undefined, 4, 2)).toBe(18);
    expect(effectiveRows(24, { rows: 24, isFullscreen: false }, 4, 2)).toBe(11);
    expect(effectiveRows(24, { rows: 30, isFullscreen: false }, 4, 2)).toBe(17);
    expect(effectiveRows(10, { rows: 60, isFullscreen: false }, 4, 2)).toBe(10);
    expect(effectiveRows(24, { rows: 8, isFullscreen: false }, 4, 2)).toBe(0);
  });
  test('30 rows, 1 running agent, 6-item plan: the blank row above the prompt is counted so the TODO ribbon is not scrolled off', () => {
    const plan = [
      todo('a1', 'Trace the failure', 'completed'), todo('a2', 'Trace the gate', 'in_progress'), todo('b1', 'Patch the gate', 'pending'),
      todo('b2', 'Add the test', 'pending'), todo('c1', 'Run the suite', 'pending'), todo('c2', 'Review the diff', 'pending'),
    ];
    const one = AGENTS.slice(0, 1);
    const rows = 30;
    const eff = effectiveRows(rows, { rows, isFullscreen: false }, 4, 1);
    expect(eff).toBe(rows - (3 + 4 + 2 + 1 + 2));
    const shown = lines(hudRows({ todos: plan, agents: one }, { cols: 138, maxRows: hudBudget(eff, hudCompactRows({ todos: plan, agents: one }), 7, true), ui }));
    expect(shown.length).toBeLessThanOrEqual(eff);
    expect(shown.some((l) => l.includes('TODO'))).toBe(true);
    expect(shown.some((l) => l.includes('SUBAGENTS') && l.includes('1 running'))).toBe(true);
  });
  test('24 and 30 rows with 2 running agents and a long plan: the HUD fits and keeps the TODO, SUBAGENTS and both agents', () => {
    for (const rows of [24, 30]) {
      const eff = effectiveRows(rows, { rows, isFullscreen: false }, 4, 2);
      const shown = hudAt(rows);
      expect(shown.length).toBeLessThanOrEqual(eff);
      expect(shown.some((l) => l.includes('TODO'))).toBe(true);
      expect(shown.some((l) => l.includes('SUBAGENTS') && l.includes('2 running'))).toBe(true);
      expect(shown.filter((l) => l.includes('verifier-eval') || l.includes('docs-curator-gate'))).toHaveLength(2);
    }
  });
});

describe('mutation kills (round 2): queued names, the elapsed clock and the Subagents ribbon probe', () => {
  const liveW = (name: string) => ({ name, role: 'implementer', state: 'working', tool: 'Read', lastTool: null, since: 0, startedAt: 0, target: null, detail: null, lastLine: '', calls: [], scope: null }) as never;
  test('hudAgents lists a dispatched-but-unlisted worker once, and never twice when the host already lists it', () => {
    const agents = hudAgents([liveW('impl-a')], [], ['impl-a', 'impl-b']);
    expect(agents.map((a) => a.name)).toEqual(['impl-a', 'impl-b']);
    expect(agents[1]).toMatchObject({ role: '', state: 'queued', ui: 'queued' });
  });
  test('the running todo shows elapsed mm:ss (zero padded) and its estimate', () => {
    const row = (claimedAgo: number, est?: number) => todoModel([todo('a', 'work', 'in_progress', { claimed_at: 10_000 - claimedAgo, ...(est ? { estimate_s: est } : {}) })], 10_000_000)[0]!.detail;
    expect(row(5)).toBe('elapsed 00:05');
    expect(row(65, 120)).toBe('elapsed 01:05 of 02:00');
    expect(row(3725)).toBe('elapsed 62:05');
  });
  test('hudListsAgents is true only when a SUBAGENTS ribbon has a row under it', () => {
    const seg = (t: string): Segment => ({ t });
    expect(hudListsAgents([[seg('TODO')], [seg('SUBAGENTS'), seg('1 running')], [seg('impl-a')]])).toBe(true);
    expect(hudListsAgents([[seg('TODO')], [seg('SUBAGENTS')]])).toBe(false); // the ribbon alone: counts only
    expect(hudListsAgents([[seg('TODO')], [seg('impl-a')]])).toBe(false);
    expect(hudListsAgents([])).toBe(false);
  });
});

describe('hud fixes (round 3): canonical name, task text, finished wave', () => {
  const sq = (name: string, task: string) => ({ name, persona: 'atlas:explorer', state: 'done', source: 'task', task }) as never;
  const lw = (name: string, state: 'working' | 'done', since = 0) => ({ name, role: 'explorer', state, tool: null, lastTool: null, since, startedAt: 0, target: null, lastLine: '', calls: [], scope: null }) as never;
  test('displayName: one whole name; the lead reads `lead`', () => {
    expect(displayName('lead-a3a3ab', 'lead')).toBe('lead');
    expect(displayName('board-auditor-open-items', 'explorer')).toBe('board-auditor-open-items');
    expect(displayName('alpha-explorer', 'explorer')).toBe(agentName('alpha-explorer', 'explorer'));
  });
  test('the TASK column is filled from the agent description (f0054, f0176)', () => {
    const agents = hudAgents([lw('alpha-explorer', 'working')], [sq('alpha-explorer', 'alpha-explorer: read alpha.py')]);
    const rows = hudLines({ todos: [], agents }, { cols: 120, maxRows: 10, ui, now: 0 }).map((r) => r.map((x) => x.t).join(''));
    expect(rows.some((r) => r.includes('alpha-explorer') && r.includes('read alpha.py'))).toBe(true);
  });
  test('a finished wave lingers as one: the header count and the rows both list all three (110 f0086)', () => {
    const ags = ['alpha', 'beta', 'gamma'].map((n, i): HudAgent => ({ name: `${n}-explorer`, role: 'explorer', state: 'done', ui: 'done', since: 1000 + i * 9000 }));
    const rows = hudLines({ todos: [], agents: ags }, { cols: 110, maxRows: 10, ui, now: 1000 + 18000 + 5000 }).map((r) => r.map((x) => x.t).join(''));
    expect(rows[0]).toContain('3 done');
    expect(rows.filter((r) => /explorer\s+done/.test(r))).toHaveLength(3);
  });
});
