// Critique 19, slice B (SUBAGENTS grid). Live shapes: stoprun-150-232567af-1/f0093.ans:31-34 (beta LAST `"No matching deferred tools found."`), stoprun-150-232567af-3/f0104.ans:30-34
// (`toolsearch...`, MODEL 7 wide, `#2` TASK `read beta.py`), live-110-232567af-1/mod-hud_subagents.png (`returned`), live-110-232567af-2/tab-board.png (`alpha.py read`).
import { describe, expect, test } from 'claude-code/testing';
import { cells, runsString, type Ui } from '../../design/atlas-ui';
import type { TodoItem } from '../../contract';
import { agentModel, hudLines, lastAction, lastOf, type HudAgent } from './hud';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const NOW = 5_000_000;
const none = { tool: null, target: null, detail: null, lastTool: null, lastLine: '' } as const;
// truth.json todos.json of stoprun-150-232567af-1: beta's dispatch row holds a tool failure as its evidence.
const BETA_FAIL = '1. ToolSearch select:mcp__lean-ctx__ctx_search,mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_glob -> "No matching deferred tools found." (lean-ctx unavailable this session; plugin:data MCP servers failed with proxy 403)';
const ALPHA = '1. Read `/p/alpha.py` -> first 3 lines: `1 def alpha_one():` / `2     return 1`; last 3 lines: `5 def alpha_two(x):` / `6     return x * 2`';
const BETA = '1. Read /p/beta.py -> line 1 `def beta_sum(a, b):`, line 2 `    return a + b`, line 5 `class BetaBox:`';

describe('B1: LAST is an outcome only', () => {
  test('a tool failure is no outcome: beta reads the next evidence row, else `finished`', () => {
    expect(lastOf({ ...none, lastTool: 'ToolSearch' }, 'done', [BETA_FAIL])).toBe('finished');
    expect(lastOf({ ...none, lastTool: 'ToolSearch' }, 'done', [BETA_FAIL, BETA])).toBe('1 function');
  });
  test('a done agent never reads `returned`, `<file> read` or `no match`', () => {
    for (const ev of [ALPHA, BETA, BETA_FAIL, '1. Grep beta_sum -> no match', '1. Read `/p/notes.md` -> first 3 lines: `# Notes`', undefined, '']) {
      const out = lastOf({ ...none, lastTool: 'Read' }, 'done', [ev]);
      expect([ev, /returned|\bread$|no match|deferred/i.test(out)]).toEqual([ev, false]);
    }
  });
  test('a closing line that is a clipped tool echo states no outcome', () => {
    expect(lastOf({ ...none, lastLine: 'Read gamma.py -> 1 def gamma_name(): / 2 return...' }, 'done', [])).toBe('finished');
    expect(lastOf({ ...none, lastLine: 'No matching deferred tools found.' }, 'done', [])).toBe('finished');
    expect(lastOf({ ...none, lastLine: '9 of 9 steps' }, 'done', [])).toBe('9 of 9 steps');
  });
  test('a running agent that loads tools reads `preparing`, never `toolsearch...` (f0104.ans:34)', () => {
    expect(lastAction({ ...none, tool: 'ToolSearch', target: 'select:mcp__lean-ctx__ctx_search' })).toBe('preparing');
    expect(lastOf({ ...none, tool: 'ToolSearch', target: 'select:x' }, 'running', [])).toBe('preparing');
    expect(lastOf({ ...none, tool: 'Read', target: 'alpha.py' }, 'running', [])).toBe('read alpha.py');
  });
  test('the same words at 110 (61 cells) and 150', () => {
    const agent = (name: string): HudAgent => ({ name, role: 'explorer', state: 'done', ui: 'done', model: 'haiku', since: 1, lastTool: 'Read' });
    const dispatch = (owner: string, evidence: string): TodoItem => ({ id: `d-${owner}`, content: `Read ${owner}`, status: 'completed', owner, origin: 'dispatch', session_id: '', evidence }) as unknown as TodoItem;
    const plan: TodoItem[] = [{ id: 'p1', content: 'T1 read beta.py (beta-explorer)', status: 'completed', owner: 'beta-explorer' } as unknown as TodoItem];
    const lastCol = (cols: number): string => {
      const rows = hudLines({ todos: [...plan, dispatch('beta-explorer', BETA)], agents: [agent('beta-explorer')] }, { merge: false, cols, maxRows: 12, ui, now: NOW }).map(runsString);
      return rows.find((r) => /^[│▌] [◐◓◑◒○✓✗▲◉] beta-explorer\b/.test(r))!;
    };
    for (const cols of [61, 150]) expect([cols, lastCol(cols)]).toEqual([cols, expect.stringMatching(/\s1\s+│$/)]);
    for (const cols of [61, 150]) expect(lastCol(cols)).not.toContain('1 found');
  });
});

describe('B2: one grid across frames', () => {
  const plan = (n = 3): TodoItem[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, content: `T${i + 1} step ${i + 1}`, status: i === 2 ? 'in_progress' : 'completed', owner: ['alpha-explorer', 'ghost-explorer', 'beta-explorer'][i] }) as unknown as TodoItem);
  const ag = (name: string, state: string, over: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: state as never, model: 'haiku', since: NOW - 1000, ...over });
  const at = (row: string, word: string): number => row.indexOf(word);
  const frame = (agents: HudAgent[], cols = 150): string[] => hudLines({ todos: plan(), agents }, { merge: false, cols, maxRows: 30, ui, now: NOW }).map(runsString);
  test('AGENT, ROLE, STATE and NOW start at the same columns in f0093 (a done LAST error text) and f0104 (a retry running toolsearch)', () => {
    const f0093 = frame([ag('alpha-explorer', 'working', { ui: 'running', tool: 'Read', target: 'alpha.py' }), ag('ghost-explorer', 'failed', { lastTool: 'Read', target: 'ghost.py' }), ag('beta-explorer', 'done', { lastTool: 'ToolSearch', lastLine: 'No matching deferred tools found.' })]);
    const f0104 = frame([ag('alpha-explorer', 'done', { lastTool: 'Read' }), ag('ghost-explorer', 'failed', { lastTool: 'Read', target: 'ghost.py' }), ag('beta-explorer', 'failed', { lastTool: 'Read', target: 'beta.py' }),
      ag('beta-explorer #2', 'working', { ui: 'running', tool: 'ToolSearch', target: 'select:x', task: 'beta-explorer: read beta.py' })]);
    const headOf = (rows: string[]): string => rows.find((r) => /AGENT\s+ROLE\s+STATE/.test(r))!;
    const [h1, h2] = [headOf(f0093), headOf(f0104)];
    for (const w of ['AGENT', 'ROLE', 'STATE', 'NOW']) expect([w, at(h2, w)]).toEqual([w, at(h1, w)]); // the grid is fixed per width: it does not reflow between frames
  });
  test('a retry owns the item: the plan row T3 names `beta-explorer #2` in OWNER, the agent row says what it does (never `read beta.py report returned`)', () => {
    const rows = frame([ag('beta-explorer', 'failed', { lastTool: 'Read' }), ag('beta-explorer #2', 'working', { ui: 'running', tool: 'ToolSearch', target: 'select:x', task: 'beta-explorer: read beta.py' })]);
    const retry = rows.find((r) => /^[│▌] [◐◓◑◒○✓✗▲◉] beta-explorer #2/.test(r))!;
    expect(rows.find((r) => /T3 step 3/.test(r))).toMatch(/running\s+beta-explorer #2/);
    expect(retry).not.toContain('report returned');
    expect(retry).toMatch(/running\s+working/); // loading tools is no step of the task: no outcome, no action
  });
  test('agentModel gives both runs of an item its id', () => {
    const rows = agentModel([ag('beta-explorer', 'failed', { lastTool: 'Read' }), ag('beta-explorer #2', 'working', { tool: 'Read' })], plan());
    expect(rows.map((r) => r.tasks)).toEqual([[3], [3]]);
  });
  test('the grid is the same at every width: no MODEL column, the same column order and the same cells from the left', () => {
    const seen = new Set<string>();
    for (const cols of [100, 120, 150]) {
      const rows = frame([ag('alpha-explorer', 'done', { lastTool: 'Read' }), ag('beta-explorer', 'done', { lastTool: 'Read' })], cols);
      const head = rows.find((r) => /AGENT\s+ROLE\s+STATE/.test(r))!;
      expect([cols, head.includes('MODEL')]).toEqual([cols, false]);
      expect([cols, head.indexOf('ROLE') < head.indexOf('STATE') && head.indexOf('STATE') < head.indexOf('NOW')]).toEqual([cols, true]);
      seen.add([head.indexOf('AGENT'), head.indexOf('ROLE'), head.indexOf('STATE'), head.indexOf('NOW')].join(','));
      for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(cols);
    }
    expect(seen.size).toBe(1); // 100, 120 and 150 columns lay the same columns out from the left
  });
});
