import { describe, expect, test } from 'claude-code/testing';
import { diffSnapshots } from '../host/notify';
import { factsLine } from '../host/discipline';
import { uiFromEnv, type Run } from '../atlas-ui';
import type { Health, HealthCheck } from './idle-health';
import { frameKit, statusFrame, statusGatesRows, statusHooksRows, type GateSrc, type StatusIn } from '../status-frame';
import { tabFrame, tabText, type TabIn } from '../tabs-frame';
import { ageShort, dataCell, dataStateOf, dataWord } from './datastate';

describe('empty, error and stale: the three states of a figure', () => {
  test('empty: no value and no failure', () => {
    const s = dataStateOf({ has: false });
    expect(s).toEqual({ kind: 'empty' });
    expect(dataWord(s)).toBe('no data yet');
    expect([dataCell(s), dataCell(s, true)]).toEqual(['—', '-']);
  });
  test('error: the read failed, even when an old value is held', () => {
    const s = dataStateOf({ has: true, failed: true, ageSecs: 1, refreshSecs: 10 });
    expect(s).toEqual({ kind: 'error' });
    expect(dataWord(s)).toBe('read failed');
    expect(dataCell(s)).toBe('err');
  });
  test('stale: older than its refresh interval, with its age', () => {
    const s = dataStateOf({ has: true, ageSecs: 125, refreshSecs: 60 });
    expect(s).toEqual({ kind: 'stale', ageSecs: 125 });
    expect(dataWord(s)).toBe('stale 2m');
    expect(dataCell(s)).toBe('~2m');
    expect(dataStateOf({ has: true, ageSecs: 60, refreshSecs: 60 })).toEqual({ kind: 'ok' }); // at the interval is still fresh
  });
  test('ok prints nothing; ages read s, m, h', () => {
    expect(dataWord({ kind: 'ok' })).toBe('');
    expect(dataCell({ kind: 'ok' })).toBe('');
    expect([ageShort(45), ageShort(180), ageShort(7300)]).toEqual(['45s', '3m', '2h']);
  });
});

describe('the sites that used to print `unknown`', () => {
  const snap = { root: '/repo', phase: 'implement', todos: [] } as never;
  test('discipline facts: an empty branch and a failed read are different words', () => {
    expect(factsLine(snap, '')).toContain('branch no data yet');
    expect(factsLine(snap, null)).toContain('branch read failed');
    expect(factsLine(snap, 'main')).toContain('branch main');
    expect(factsLine(snap, '')).not.toContain('unknown');
  });
  test('notify: a note with no owner names no data, never `unknown`', () => {
    const base = { squad: [], todos: [], notes: [], phase: 'implement' } as never as Record<string, unknown>;
    const next = { ...base, notes: [{ seq: 1, to: 'human', text: 'hi' }] } as never;
    const ev = diffSnapshots(base as never, next);
    expect(ev).toEqual([{ type: 'note', sender: 'no data yet', preview: 'hi' }]);
  });
});

// ---- M6: the status-frame and tabs-frame sites, each with data missing, a failed read, present data and (where an age is known) stale ----

const ui = { ...uiFromEnv({}), ascii: false };
const kit = frameKit(ui, 60);
const text = (r: readonly Run[]): string => r.map((x) => x.t).join('').trimEnd();
const rowOf = (rows: readonly (readonly Run[])[], name: string): string => rows.map(text).find((t) => t.includes(name)) ?? `<no row ${name}>`;
const checks: HealthCheck[] = [{ id: 'completion', ok: true, lines: 1, pass: 1 }];
const health = (o: Partial<Health> = {}): Health => ({ gates: { total: 1, green: 1, checks }, version: '1', branch: 'main', team: 'off', ...o });
const hooksOf = { total: 1, byLabel: [{ label: 'tool.call', n: 1 }], recent: [{ label: 'tool.call Bash', ageSecs: 7 }] } as never;
const gateRow = (h: Health, src: Partial<GateSrc> = {}): string => rowOf(statusGatesRows(kit, h, { gates: [], prompted: true, ...src }, false), 'completion');
const hookRow = (h: Health, name: string, read?: Parameters<typeof statusHooksRows>[3]): string => rowOf(statusHooksRows(kit, h, undefined, read), name);

describe('M6 status-frame: the gates `last` cell', () => {
  test('missing: no check age and no hook event gives the no-data dash', () => {
    expect(gateRow(health())).toMatch(/—$/);
  });
  test('failed read: `err`, not the dash (read flag, or the group own error)', () => {
    expect(gateRow(health(), { read: { failed: { gates: true } } })).toMatch(/err$/);
    expect(gateRow(health(), { gates: [{ id: 'completion', title: 'c', error: 'boom', lines: [] }] })).toMatch(/err$/);
  });
  test('present: the check age', () => {
    const h = health({ gates: { total: 1, green: 1, checks: [{ ...checks[0]!, lastSecs: 12 }] } });
    expect(gateRow(h)).toMatch(/12s$/);
  });
  test('stale: a snapshot older than its refresh interval wears `~` and the real age (12s + 125s)', () => {
    const h = health({ gates: { total: 1, green: 1, checks: [{ ...checks[0]!, lastSecs: 12 }] } });
    expect(gateRow(h, { read: { ageSecs: 125, refreshSecs: 60 } })).toMatch(/~2m$/);
    expect(gateRow(h, { read: { ageSecs: 60, refreshSecs: 60 } })).toMatch(/12s$/);
  });
  test('a failed read is not folded into the `0 checks yet` summary', () => {
    const idle = health();
    const rows = statusGatesRows(kit, idle, { gates: [], prompted: false, read: { failed: { gates: true } } }, false);
    expect(rows.map(text).join('\n')).toMatch(/completion.*err/);
  });
});

describe('M6 status-frame: the hooks `last` cell', () => {
  test('missing: a hook that never fired shows the dash', () => {
    expect(hookRow(health({ hooks: hooksOf }), 'classic.Stop')).toMatch(/—$/);
  });
  test('failed read: `err` on every row, the summary line included', () => {
    expect(hookRow(health({ hooks: hooksOf }), 'classic.Stop', { failed: { hooks: true } })).toMatch(/err$/);
    expect(statusHooksRows(kit, health(), undefined, { failed: { hooks: true } }).map(text).join('\n')).toContain('err');
  });
  test('present: the newest event age', () => {
    expect(hookRow(health({ hooks: hooksOf }), 'tool.call')).toMatch(/7s$/);
  });
  test('stale: older than its refresh interval wears `~` and the real age (7s + 125s)', () => {
    expect(hookRow(health({ hooks: hooksOf }), 'tool.call', { ageSecs: 125, refreshSecs: 60 })).toMatch(/~2m$/);
  });
  test('statusFrame passes the read through to both tables', () => {
    const a: StatusIn = { cols: 62, room: 0, ui, kind: 'idle', phases: [], phase: '', spin: '', todos: { done: 0, total: 0 }, gates: [], health: health({ hooks: hooksOf }), lead: false, read: { failed: { gates: true, hooks: true } } };
    const t = statusFrame(a).map(text);
    expect(rowOf(statusFrame(a), 'completion')).toMatch(/err$/);
    expect(t.find((l) => l.includes('classic.Stop'))).toMatch(/err$/);
    const b = statusFrame({ ...a, read: undefined }).map(text);
    expect(b.find((l) => l.includes('classic.Stop'))).toMatch(/—$/);
  });
});

describe('M6 tabs-frame: the routing transport and the gates tab', () => {
  const route = (transport?: string): unknown => ({ teamId: 't', name: 'alpha', cls: 'implement', effort: 'high', isolation: '', maxParallel: 1, seats: [], drift: [], ...(transport ? { transport } : {}) });
  const core = (transport?: string): unknown => ({ routes: [route(transport)], verdicts: [], offload: { kept: 0, returned: 0 } });
  const tab = (o: Partial<TabIn>): string => tabText(tabFrame({ tab: 'core', cols: 62, room: 0, ui, kind: 'idle', health: health(), gates: [], workers: [], todos: [], notes: [], channel: 'c', people: 0, recipient: null, flips: [], lead: false, ...o })).join('\n');
  test('missing: a route with no recorded transport says no data yet', () => {
    expect(tab({ core: core() as never })).toContain('implement/high · no data yet');
  });
  test('failed read: the routes say `read failed`, never a quiet empty section', () => {
    const t = tab({ core: null, read: { failed: { routes: true } } });
    expect(t).toContain('ROUTING');
    expect(t).toContain('read failed');
    expect(tab({ core: null })).not.toContain('ROUTING');
  });
  test('present: the transport it ran on', () => {
    const t = tab({ core: core('tmux') as never });
    expect(t).toContain('implement/high · tmux');
    expect(t).not.toContain('no data yet');
  });
  test('gates tab last cell: dash, err, age, stale age', () => {
    const lastOf = (h: Health, read?: TabIn['read'], gates: TabIn['gates'] = []): string => (tab({ tab: 'gates', health: h, gates, kind: 'working', ...(read ? { read } : {}) }).split('\n').find((l) => l.includes('completion')) ?? '');
    const h12 = health({ gates: { total: 1, green: 1, checks: [{ ...checks[0]!, lastSecs: 12 }] } });
    expect(lastOf(health())).toMatch(/—$/);
    expect(lastOf(health(), { failed: { gates: true } })).toMatch(/err$/);
    expect(lastOf(h12)).toMatch(/12s$/);
    expect(lastOf(h12, { ageSecs: 125, refreshSecs: 60 })).toMatch(/~2m$/);
  });
  test('gates tab hooks table takes the read too', () => {
    const t = tab({ tab: 'gates', health: health({ hooks: hooksOf }), read: { failed: { hooks: true } } }).split('\n').find((l) => l.includes('classic.Stop')) ?? '';
    expect(t).toMatch(/err$/);
  });
});
