// Critique 18, slice C2: LAST is an outcome in plain words, never `1.`, `1 def...`, `reported`, `no matching...` or a cut sentence. The evidence strings are the
// dispatch rows' own, from the live runs' truth.json (todos.json): live-150-562576ed-1 (gamma `1.`), live-110-562576ed-1 (gamma `1 def...`),
// live-110-562576ed-2 (beta `no matching...`), stoprun-150-562576ed-1 (alpha `full file is 7 lines, so first 3...`).
// Critique 19 B1 reversed two of its answers: a tool's failure (`no matching deferred tools`) is no outcome at all, and a count reads `2 functions` at every width.
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
    expect(outcomeOf(LIVE.gamma150)).toBe('2 functions');
  });
  test('a result that opens with numbered source lines is a dump (was `1 def...`)', () => {
    expect(outcomeOf(LIVE.gamma110)).toBe('2 functions');
  });
  test('a result that opens with `full file is 7 lines` is a dump (was `full file is 7 lines, so first 3...`)', () => {
    expect(outcomeOf(LIVE.alpha150)).toBe('2 functions');
  });
  test('a tool failure or empty search states no outcome (critique 19 B1: `No matching deferred tools found.`, `no match`)', () => {
    expect(outcomeOf(LIVE.beta110)).toBe('');
    expect(outcomeOf('1. ToolSearch select:mcp__lean-ctx__ctx_search -> "No matching deferred tools found." (lean-ctx unavailable this session)')).toBe('');
    expect(outcomeOf('1. Grep beta_sum -> no match')).toBe('');
    expect(outcomeOf('No matching deferred tools found.')).toBe('');
  });
  test('the list number is never the outcome (was `1.`), and a sentence too long for the column states none (no `report returned`)', () => {
    const out = outcomeOf(LIVE.numberedOnly);
    expect(out).not.toMatch(/^\d/);
    expect(out).not.toContain('returned');
    expect(cells(out)).toBeLessThanOrEqual(40);
  });
  test('every live shape gives an outcome of 40 cells or fewer with no ellipsis, never `returned` or `<file> read`', () => {
    for (const text of Object.values(LIVE)) { const out = outcomeOf(text); expect(cells(out)).toBeLessThanOrEqual(40); expect(out).not.toContain('...'); expect(out).not.toMatch(/returned|\bread$/); }
  });
  test('a dump with no function in it states no outcome (was `alpha.py read`)', () => {
    expect(outcomeOf('1. Read `/p/notes.md` -> first 3 lines: `# Notes` / `` / `text`')).toBe('');
  });
});

describe('C2: the narrow LAST column never shows a stub', () => {
  const row = (o: Partial<AgentRow> & { name: string }): AgentRow => ({ state: 'done', model: 'haiku', tasks: [1], tool: '2 functions found', ctx: null, focus: false, ...o });
  const draw = (rows: AgentRow[], cols: number): string[] => agentRows(rows, { cols, ui, tick: 0 } as never, { spacers: true, extras: false }).map(runsString);
  test('a done outcome is drawn as lastOf gives it, never swapped for `returned` (critique 19 B1)', () => {
    const out = draw([row({ name: 'alpha-explorer', tool: 'finished' }), row({ name: 'gamma-explorer', tool: '2 functions', tasks: [3] })], 61);
    expect(out.join('\n')).not.toMatch(/reported|returned|\.\.\./);
    expect(out.join('\n')).toMatch(/alpha-explorer\s+done\s+T1\s+-\s+-/); // wave 31: RESULT is a count or `-`, so a text outcome is a dash
  });
  test('a count outcome reads the same words at 110 (61 cells) and 150', () => {
    for (const cols of [61, 150]) expect(draw([row({ name: 'alpha-explorer', tool: '12 functions' })], cols).join('\n')).toContain('12 fn');
  });
});

describe('C2: through lastOf and the HUD rows', () => {
  const agent = (name: string): HudAgent => ({ name, role: 'explorer', state: 'done', ui: 'done', model: 'haiku', since: 1, lastTool: 'Read' });
  const dispatch = (owner: string, evidence: string): TodoItem => ({ id: `d-${owner}`, content: `Read ${owner}`, status: 'completed', owner, origin: 'dispatch', session_id: '', evidence }) as unknown as TodoItem;
  test('lastOf gives the same words the rows show', () => {
    expect(lastOf(none, 'done', [LIVE.gamma150])).toBe('2 functions');
    expect(lastOf(none, 'done', [LIVE.beta110])).toBe('finished'); // the only evidence is a tool failure: no outcome, so `finished`, not the failure
    expect(lastOf(none, 'done', [LIVE.beta110, LIVE.gamma110])).toBe('2 functions'); // the next evidence row that states one wins
  });
  test('at 150 the gamma row shows `2 functions`, not `1.`', () => {
    const rows = hudLines({ todos: [dispatch('gamma-explorer', LIVE.gamma150)], agents: [agent('gamma-explorer')] }, { merge: false, cols: 150, maxRows: 10, ui, now: 5_000_000 }).map(runsString);
    const g = rows.find((r) => /^[▸ ] [◐◓◑◒◇●■▲◉] gamma-explorer/.test(r))!;
    expect(g).toContain('2 fn');
    expect(g).not.toMatch(/\s1\.\s/);
    expect(agentModel([agent('gamma-explorer')], [dispatch('gamma-explorer', LIVE.gamma150)])[0]!.tool).toBe('2 functions');
  });
});
