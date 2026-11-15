// Idle polish, round 3: what the third hostile critic found on the idle panel, the run facts, the recent list, the tab chips and the health card. One describe per defect.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv } from './atlas-ui';
import { healthCardRows } from './hud-surface';
import { bodyLines, headerRows, lineText, tabRows, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { NOW } from './live_fixture';
import { agoText, humanEvent, recentEvents, type Health } from './idle-health';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const green = (id: string, note?: string) => ({ id, ok: true, lines: 3, pass: 3, ...(note ? { note } : {}) });
const HOOKS = { total: 5, byLabel: [{ label: 'session.measure', n: 1 }, { label: 'turn.complete', n: 1 }, { label: 'classic.Stop', n: 1 }, { label: 'prompt.submit', n: 1 }, { label: 'session.start', n: 1 }], recent: [{ label: 'session.measure', ageSecs: 2 }, { label: 'turn.complete', ageSecs: 2 }, { label: 'classic.Stop', ageSecs: 2 }, { label: 'prompt.submit', ageSecs: 5 }, { label: 'session.start', ageSecs: 16 }], lastEventSecs: 2 };
const h: Health = { gates: { total: 4, green: 4, checks: [green('completion', 'Last Stop allowed'), green('tripwire', 'Team mode: off'), green('routing'), green('header')] }, ctxPct: 6, tokens: 63_000, window: 1_000_000, upSecs: 16, branch: 'master', version: '17.21.1', hooks: { total: 1, byLabel: [{ label: 'session.start', n: 1 }], recent: [{ label: 'session.start', ageSecs: 7 }], lastEventSecs: 7 } };
const world = (cols: number, over: Partial<PanelModel> = {}): PanelModel =>
  panelWorld('route', cols, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], run: { kind: 'idle', secs: 0, startMs: NOW, frame: 0 }, health: h, ...over } as never);
const body = (m: PanelModel): string[] => bodyLines(m).map(lineText);
const idleHealth: Health = h;

describe('1: a tall idle pane is not a slab of empty rows', () => {
  test('at 150 columns (pane 54 x 40) at most 10 blank rows sit between the last content row and the closing rule', () => {
    const t = body(world(54));
    const rule = t.findIndex((l, i) => i > 3 && /^\s+─{20,}$/.test(l));
    expect(rule).toBeGreaterThan(0);
    let dead = 0;
    for (let i = rule - 1; i >= 0 && t[i]!.trim() === ''; i--) dead++;
    expect(dead).toBeLessThanOrEqual(10);
  });
  test('the same with no context figure yet (a fresh session, before the first measure): still at most 10 blank rows', () => {
    const t = body(world(54, { health: { ...h, ctxPct: undefined, tokens: undefined, window: undefined } }));
    const rule = t.findIndex((l, i) => i > 3 && /^\s+─{20,}$/.test(l));
    let dead = 0;
    for (let i = rule - 1; i >= 0 && t[i]!.trim() === ''; i--) dead++;
    expect(dead).toBeLessThanOrEqual(10);
    expect(t.join('\n')).not.toMatch(/▕/);
  });
  test('the context gauge is a real row: `context ▕██░░░░░░▏ 6%`; none without a context figure', () => {
    expect(body(world(54)).join('\n')).toMatch(/context ▕█+░*▏ 6%/);
    expect(body(world(54, { health: { ...h, ctxPct: undefined } })).join('\n')).not.toMatch(/▕/);
  });
  test('`waiting for first prompt` replaces the empty zero state while no turn has run', () => {
    const t = body(world(54)).join('\n');
    expect(t).toContain('waiting for first prompt');
    expect(t).not.toContain('no events yet');
  });
});

describe('2: the waiting line pulses with the spinner frame', () => {
  test('the line differs across frames 0..3 and is one row', () => {
    const rows = [0, 1, 2, 3].map((frame) => body(world(54, { run: { kind: 'idle', secs: 0, startMs: NOW, frame } })).filter((l) => l.includes('waiting for first prompt')));
    for (const r of rows) expect(r.length).toBe(1);
    expect(new Set(rows.map((r) => r[0])).size).toBeGreaterThan(1);
  });
  test('once a run has ended the waiting line is gone', () => {
    const last = { secs: 2, done: 0, total: 0, agents: 0, failed: 0 };
    expect(body(world(54, { health: { ...h, last } })).join('\n')).not.toContain('waiting for first prompt');
  });
});

describe('4: the run duration is said once', () => {
  const last = { secs: 2, done: 0, total: 0, agents: 0, failed: 0, endedAgo: 3 };
  test('a finished run at rest: `0:02` is the band\'s alone, the panel prints it zero times (slice S4)', () => {
    const t = body(world(54, { run: { kind: 'idle', secs: 2, startMs: NOW, frame: 0 }, health: { ...h, last } })).join('\n');
    expect(t.match(/0:02/g)).toBeNull();
  });
  test('a live run: the phase row never reads idle, carries no clock, and no `last run` row repeats it', () => {
    const t = body(world(54, { run: { kind: 'working', secs: 2, startMs: NOW, frame: 0 }, health: { ...h, last } }));
    const phase = t.find((l) => /phase/.test(l))!;
    expect(phase).not.toContain('idle');
    expect(t.join('\n').match(/0:02/g)).toBeNull();
    expect(t.join('\n')).not.toContain('last run');
  });
});

describe('5: the recent list reads in words, collapsed, at most 3 rows', () => {
  const m = (): PanelModel => world(54, { health: { ...h, hooks: HOOKS } });
  test('human labels, no raw hook names', () => {
    const t = body(m()).join('\n');
    expect(t).not.toMatch(/session\.measure|turn\.complete|classic\.Stop|prompt\.submit|session\.start/);
    expect(t).toMatch(/turn finished/);
    expect(t).toMatch(/prompt sent/);
  });
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

describe('6: a narrow pane names the current stage and n/5', () => {
  test('at 37 columns the phase chain is `research 1/5`, never the short names of the rest', () => {
    const t = body(world(37, { run: { kind: 'working', secs: 3, startMs: NOW, frame: 0 }, phase: 'research', phases: ['research', 'theory', 'test', 'implement', 'verify'], entered: ['research'] })).join('\n');
    expect(t).toMatch(/research 1\/5/);
    expect(t).not.toMatch(/thy|impl|ver\b/);
  });
});

describe('7: no orphan `0 messages` on the idle panel', () => {
  test('zero messages: no row; with notes the count folds into the session row', () => {
    expect(body(world(54)).join('\n')).not.toMatch(/0 messages/);
    const note = { at: '12:00', from: 'lead', text: 'hi' } as never;
    const t = body(world(54, { notes: [note] }));
    expect(t.join('\n')).toMatch(/session .*1 message/);
  });
});

describe('8: the HEALTH card has one row schema at both widths', () => {
  const text = (cols: number, panel: boolean): string[] => healthCardRows({ ...idleHealth, panel }, { cols, ui }).map((r) => r.map((x) => x.t).join(''));
  test('the same rows at 110 and 150 (panel up or not), the note on its own line', () => {
    const a = text(110, false).map((s) => s.replace(/[╭╮╰╯─│\s]+$/g, '').trim());
    const b = text(150, true).map((s) => s.replace(/[╭╮╰╯─│\s]+$/g, '').trim());
    expect(a.filter((l) => /^(gates|session)?\s*[●◇■]/.test(l) || /atlas|branch/.test(l)).length).toBe(b.filter((l) => /^(gates|session)?\s*[●◇■]/.test(l) || /atlas|branch/.test(l)).length);
    expect(a.join('|').replace(/\s+/g, ' ').replace(/[─╭╮╰╯]/g, '')).toBe(b.join('|').replace(/\s+/g, ' ').replace(/[─╭╮╰╯]/g, ''));
  });
  test('a check is `● name n/m`; the team line is the session row\'s `team off`, never a note', () => {
    const t = text(150, true).join('\n');
    expect(t).not.toMatch(/pass · /);
    expect(t).not.toContain('Team mode');
    expect(t).toContain('team off');
    expect(t).toMatch(/● tripwire 3\/3/);
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
  test('relative age on the last run row', () => {
    const last = { secs: 2, done: 0, total: 0, agents: 0, failed: 0, endedAgo: 125 };
    const t = body(world(54, { run: { kind: 'idle', secs: 2, startMs: NOW, frame: 0 }, health: { ...h, last, pulse: { events: [], ctx: [], runs: [{ secs: 2, ok: true, at: 1 }] } } })).join('\n');
    expect(t).toContain(`ended ${agoText(125)} ago`);
    expect(t).not.toMatch(/\d:\d\d [AP]M/);
  });
});
