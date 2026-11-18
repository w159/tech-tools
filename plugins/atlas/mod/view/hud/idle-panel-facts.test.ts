// Idle polish, round 3: what the third hostile critic found on the idle panel, the run facts, the recent list, the tab chips and the health card. One describe per defect.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv } from '../../atlas-ui';
import { healthCardRows } from './hud-surface';
import { bodyLines, headerRows, lineText, tabRows, type PanelModel } from '../panel/panel-layout';
import { panelWorld } from '../../../contracts/panel-world';
import { NOW } from '../../live_fixture';
import { agoText, humanEvent, recentEvents, type Health } from '../../data/idle-health';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const green = (id: string, note?: string) => ({ id, ok: true, lines: 3, pass: 3, ...(note ? { note } : {}) });
const HOOKS = { total: 5, byLabel: [{ label: 'session.measure', n: 1 }, { label: 'turn.complete', n: 1 }, { label: 'classic.Stop', n: 1 }, { label: 'prompt.submit', n: 1 }, { label: 'session.start', n: 1 }], recent: [{ label: 'session.measure', ageSecs: 2 }, { label: 'turn.complete', ageSecs: 2 }, { label: 'classic.Stop', ageSecs: 2 }, { label: 'prompt.submit', ageSecs: 5 }, { label: 'session.start', ageSecs: 16 }], lastEventSecs: 2 };
const h: Health = { gates: { total: 4, green: 4, checks: [green('completion', 'Last Stop allowed'), green('tripwire', 'Team mode: off'), green('routing'), green('header')] }, ctxPct: 6, tokens: 63_000, window: 1_000_000, upSecs: 16, branch: 'master', version: '17.21.1', hooks: { total: 1, byLabel: [{ label: 'session.start', n: 1 }], recent: [{ label: 'session.start', ageSecs: 7 }], lastEventSecs: 7 } };
const world = (cols: number, over: Partial<PanelModel> = {}): PanelModel =>
  panelWorld('route', cols, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], run: { kind: 'idle', secs: 0, startMs: NOW, frame: 0 }, health: h, ...over } as never);
const body = (m: PanelModel): string[] => bodyLines(m).map(lineText);
const idleHealth: Health = h;

const MANY = Array.from({ length: 40 }, (_, i) => ({ label: i % 3 ? 'tool.call Bash' : 'session.measure', ageSecs: 4 + i * 5 }));
describe('1: a tall idle pane is not a slab of empty rows (D11: RECENT grows into the free rows, the footer is the last row)', () => {
  test('at 150 columns (pane 54 x 40) at most one blank row sits between the last event and the closing rule', () => {
    const t = body(world(54, { health: { ...h, hooks: { total: 40, byLabel: [{ label: 'tool.call', n: 40 }], recent: MANY } } }));
    const rule = t.length - 1; // round 3: the footer is the last row, no rule above it
    expect(t[rule]!.trim()).toMatch(/^atlas /);
    let dead = 0;
    for (let i = rule - 1; i >= 0 && t[i]!.trim() === ''; i--) dead++;
    expect(dead).toBeLessThanOrEqual(1);
  });
  test('slice S3: no `waiting for first prompt` line and no zero state; the stepper at rest is five `○` (the slots never move)', () => {
    const t = body(world(54)).join('\n');
    expect(t).not.toContain('waiting for first prompt');
    expect(t).not.toContain('no events yet');
  });
});

describe('4: the run duration is said once', () => {
  const last = { secs: 2, done: 0, total: 0, agents: 0, failed: 0, endedAgo: 3 };
  test('a finished run at rest: `0:02` is the band\'s alone, the panel prints it zero times (slice S4)', () => {
    const t = body(world(54, { run: { kind: 'idle', secs: 2, startMs: NOW, frame: 0 }, health: { ...h, last } })).join('\n');
    expect(t.match(/0:02/g)).toBeNull();
  });
});

describe('5: the recent list reads in words, collapsed, at most 3 rows', () => {
  const m = (): PanelModel => world(54, { health: { ...h, hooks: HOOKS } });
  test('events of the same second are one row with a count; the list is capped at 3', () => {
    const rows = recentEvents(HOOKS.recent, 3);
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ ageSecs: 2, n: 3 });
    expect(rows[0]!.text).toMatch(/3 events/);
    expect(rows.every((r) => r.text.length > 0)).toBe(true);
    expect(recentEvents(Array.from({ length: 9 }, (_, i) => ({ label: 'tool.call Bash', ageSecs: i })), 3).length).toBe(3);
  });
  test('humanEvent words', () => {
    expect(humanEvent('session.measure')).toBe('context measured');
    expect(humanEvent('turn.complete')).toBe('turn finished');
    expect(humanEvent('classic.Stop')).toBe('stop check');
    expect(humanEvent('tool.call Bash')).toBe('tool call Bash');
    expect(humanEvent('some.other_thing')).toBe('some other thing');
  });
});


describe('8: the HEALTH card has one row schema at both widths', () => {
  const text = (cols: number, panel: boolean): string[] => healthCardRows({ ...idleHealth, panel }, { cols, ui }).map((r) => r.map((x) => x.t).join(''));
  test('the same rows at 110 and 150 (panel up or not), the note on its own line', () => {
    const sections = (cols: number): string[] => [...(text(cols, false).join('\n').match(/── [A-Z]+/g) ?? [])].sort();
    expect(sections(110)).toEqual(sections(150)); // frame spec section 6: two columns or three, the same sections
  });
  test('a check is `● name  ok fail` or `○ name  n armed` (no ratio); the team line is not a note on the card', () => {
    const t = text(150, true).join('\n');
    expect(t).not.toMatch(/\d+\/\d+ pass|\d+\/\d+ gates/);
    expect(t).not.toContain('Team mode');
    expect(t).toMatch(/[●○] tripwire +(?:3 +0 +\S+|0 +0 +—)|○ \d+ gates armed · 0 checks yet/); // AA4: before any check the section is one summary line
  });
});

describe('9: every tab is a chip', () => {
  test('chips are one cell apart so each reads as its own tile; no underline rule under the lit one', () => {
    const rows = tabRows(world(54, { tab: 'route' })).map(lineText);
    expect(rows.length).toBe(1);
    expect(rows[0]).not.toMatch(/━/);
    expect(rows[0]).toMatch(/ status   team   channel/); // 1 pad + label + 1 pad, then one gap cell between chips
    expect(headerRows(world(54)).length).toBe(3);
  });
});

describe('10: the last run ended `Ns ago`, not a wall clock with no zone', () => {
});
