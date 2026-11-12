// Critique 18, slice C2: LAST is an outcome in plain words, never `1.`, `1 def...`, `reported`, `no matching...` or a cut sentence. The evidence strings are the
// dispatch rows' own, from the live runs' truth.json (todos.json): live-150-562576ed-1 (gamma `1.`), live-110-562576ed-1 (gamma `1 def...`),
// live-110-562576ed-2 (beta `no matching...`), stoprun-150-562576ed-1 (alpha `full file is 7 lines, so first 3...`).
import { describe, expect, test } from 'claude-code/testing';
import { cells, runsString, type Ui } from './atlas-ui';
import { agentModel, hudLines, lastOf, outcomeOf, type HudAgent } from './hud';
import { agentRows, type AgentRow } from './hud-surface';
import type { TodoItem } from './contract';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const none = { tool: null, target: null, detail: null, lastTool: 'Read', lastLine: '' } as const;
const LIVE = {
  gamma150: "1. Read gamma.py (absolute path) -> first 3 lines: `1 def gamma_name():` / `2     return 'gamma'` / `3 ` ; last 3 lines: `5 def gamma_pair(a, b):` / `6     return (a, b)` / `7 `",
  gamma110: "1. Read /mnt/attach/project-files/atlas-ui-redesign/round2/lc-jfi12tb9/gamma.py -> 1 def gamma_name(): / 2 return 'gamma' / 3 (blank) ... 5 def gamma_pair(a, b): / 6 return (a, b) / 7 (end of file)",
  beta110: '1. ToolSearch select:mcp__lean-ctx__ctx_search,mcp__lean-ctx__ctx_read -> no matching deferred tools (lean-ctx unavailable; proxy 403 on other MCP servers)',
  alpha150: '1. Read `/mnt/attach/project-files/atlas-ui-redesign/round2/lc-vnjh9oie/alpha.py` -> full file is 7 lines, so first 3 and last 3 shown: `def alpha_one():` / `    return 1` / `` ... `def alpha_two(x):` / `    return x * 2` / `` (line 7 blank)',
  numberedOnly: '1. All three files were read and each lists its functions, which are reported in the table above for the lead to combine with the other results.',
};

describe('C2: outcomeOf reads the live result shapes', () => {
  test('a Read echo with a parenthetical after the path still counts what it found (was `1.`)', () => {
    expect(outcomeOf(LIVE.gamma150)).toBe('2 functions found');
  });
  test('a result that opens with numbered source lines is a dump (was `1 def...`)', () => {
    expect(outcomeOf(LIVE.gamma110)).toBe('2 functions found');
  });
  test('a result that opens with `full file is 7 lines` is a dump (was `full file is 7 lines, so first 3...`)', () => {
    expect(outcomeOf(LIVE.alpha150)).toBe('2 functions found');
  });
  test('a negative tool result drops its parenthetical and reads whole (was `no matching...`)', () => {
    expect(outcomeOf(LIVE.beta110)).toBe('no matching deferred tools');
  });
  test('the list number is never the outcome (was `1.`), and a sentence too long for the column falls back to a clean phrase', () => {
    const out = outcomeOf(LIVE.numberedOnly);
    expect(out).not.toMatch(/^\d/);
    expect(out).not.toContain('...');
    expect(cells(out)).toBeLessThanOrEqual(40);
  });
  test('every live shape gives an outcome of 40 cells or fewer with no ellipsis', () => {
    for (const text of Object.values(LIVE)) { const out = outcomeOf(text); expect(out).not.toBe(''); expect(cells(out)).toBeLessThanOrEqual(40); expect(out).not.toContain('...'); }
  });
});

describe('C2: the narrow LAST column never shows a stub', () => {
  const row = (o: Partial<AgentRow> & { name: string }): AgentRow => ({ state: 'done', model: 'haiku', tasks: [1], tool: '2 functions found', ctx: null, focus: false, ...o });
  const draw = (rows: AgentRow[], cols: number): string[] => agentRows(rows, { cols, ui, tick: 0 } as never, { spacers: true, extras: false }).map(runsString);
  test('a done outcome that does not fit says `returned`, not `reported` or a cut word (live-110-562576ed-1/f0083.ans:28)', () => {
    const out = draw([row({ name: 'alpha-explorer', tool: 'report returned' }), row({ name: 'gamma-explorer', tool: 'no matching deferred tools', tasks: [3] })], 61);
    expect(out.join('\n')).not.toMatch(/reported|\.\.\./);
    expect(out.join('\n')).toContain('returned');
  });
  test('a count outcome that does not fit shortens to `2 found`', () => {
    const out = draw([row({ name: 'alpha-explorer', tool: '12 functions found' })], 61);
    expect(out.join('\n')).not.toContain('...');
    expect(out.join('\n')).toMatch(/12 found|12 functions found/);
  });
});

describe('C2: through lastOf and the HUD rows', () => {
  const agent = (name: string): HudAgent => ({ name, role: 'explorer', state: 'done', ui: 'done', model: 'haiku', since: 1, lastTool: 'Read' });
  const dispatch = (owner: string, evidence: string): TodoItem => ({ id: `d-${owner}`, content: `Read ${owner}`, status: 'completed', owner, origin: 'dispatch', session_id: '', evidence }) as unknown as TodoItem;
  test('lastOf gives the same words the rows show', () => {
    expect(lastOf(none, 'done', [LIVE.gamma150])).toBe('2 functions found');
    expect(lastOf(none, 'done', [LIVE.beta110])).toBe('no matching deferred tools');
  });
  test('at 150 the gamma row shows `2 functions found`, not `1.`', () => {
    const rows = hudLines({ todos: [dispatch('gamma-explorer', LIVE.gamma150)], agents: [agent('gamma-explorer')] }, { cols: 150, maxRows: 10, ui, now: 5_000_000 }).map(runsString);
    const g = rows.find((r) => r.includes('gamma-explorer') && /haiku/.test(r))!;
    expect(g).toContain('2 functions found');
    expect(g).not.toMatch(/\s1\.\s/);
    expect(agentModel([agent('gamma-explorer')], [dispatch('gamma-explorer', LIVE.gamma150)])[0]!.tool).toBe('2 functions found');
  });
});
