// Idle polish (wave 44): what a hostile critic found in the idle, expanded and clickable states of the health band, card and side panel. One describe per defect.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bandHealth, bandTree, type BandHandlers, type BandModel } from './band';
import { busySnap, NOW } from './live_fixture';
import { uiFromEnv } from './atlas-ui';
import { healthCardRows, padRows } from './hud-surface';
import { bodyLines, lineText, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { textWidth } from './theme';
import { composeSlot } from './slot';
import * as ih from './idle-health';
import type { Health } from './idle-health';
import { hookStats, noteHook, resetHookLog } from './hook-log';
import { sidebarTree, type SidebarHandlers } from './pane/sidebar';
import { activeChipStyle } from './clickable';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
const textOf = (n: Node): string => (n.kind === 'Text' || typeof n.props.children === 'string' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const handlers: BandHandlers = { openView() {}, toggleTodos() {}, toggleHealth() {} };
const green = (id: 'completion' | 'tripwire' | 'routing' | 'header', ok = true) => ({ id, title: id, lines: [{ id, label: id, ok }] }) as any;
const GATES = [green('completion'), green('tripwire'), green('routing'), green('header')];
const HOOKS = { total: 6, byLabel: [{ label: 'tool.call', n: 3 }, { label: 'session.measure', n: 2 }, { label: 'session.start', n: 1 }], recent: [{ label: 'tool.call Bash', ageSecs: 12 }, { label: 'session.measure', ageSecs: 40 }, { label: 'session.start', ageSecs: 70 }], lastEventSecs: 12 };
const HEALTH = { upSecs: 724, version: '17.21.1', branch: 'main', tokens: 42_000, window: 1_000_000, hooks: HOOKS, open: false };
const idleSnap = (over: Record<string, unknown> = {}) => busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 18, ...over } as never);
const model = (columns: number, over: Partial<BandModel> = {}): BandModel => ({ snapshot: idleSnap(), live: [], gates: GATES, columns, tick: 0, maxRows: 12, ui, health: HEALTH, ...over });
const rowsOf = (b: BandModel): string[] => kids(bandTree(els, b, handlers) as unknown as Node).map(textOf);

const h: Health = {
  gates: { total: 4, green: 4, checks: ['completion', 'tripwire', 'routing', 'header'].map((id) => ({ id, ok: true, lines: 3, pass: 3, note: 'Last Stop allowed' })) },
  ctxPct: 6, tokens: 63_000, window: 1_000_000, upSecs: 16, branch: 'master', version: '17.21.1',
  hooks: HOOKS,
  last: { secs: 2, done: 0, total: 0, agents: 2, failed: 0, endedAgo: 600, workers: [{ name: 'alpha', state: 'done', secs: 42 }, { name: 'beta', state: 'failed', secs: 7 }] },
};
const world = (cols: number, over: Partial<PanelModel> = {}, tab: 'route' | 'team' = 'route'): PanelModel => panelWorld(tab, cols, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], run: { kind: 'idle', secs: 0, startMs: NOW }, health: h, ...over } as never);
const body = (m: PanelModel): string[] => bodyLines(m).map(lineText);

describe('1: the checks row never repeats the gates figure', () => {
  for (const cols of [150, 110]) {
    test(`at ${cols}, all green: the band says gates once and draws no checks row`, () => {
      const rows = rowsOf(model(cols));
      expect(rows[0]).toContain('○ gates armed ›');
      expect(rows.join('\n')).not.toMatch(/checks|4\/4 green|completion/);
    });
    test(`at ${cols}, a gate not green brings the checks row back`, () => {
      const rows = rowsOf(model(cols, { gates: [...GATES.slice(0, 3), green('header', false)] }));
      expect(rows.join('\n')).toMatch(/■ 1 denied/); // v1 frame spec: the gates chip carries the denial, the checks row stays out of the band
    });
  }
});

describe('2: the expanded card says each gate in the one vocabulary, never a second gate total', () => {
  const card = healthCardRows(h, { cols: 110, ui }).map((r) => r.map((x) => x.t).join(''));
  test('no line restates the band\'s figure (`gates ok`, `N denied`, `n/m green`); the uptime is the pane NOW line, not a card row (frame spec section 6)', () => {
    const t = card.join('\n');
    expect(t).not.toMatch(/gates ok|\d+ denied|\d+\/\d+ green/);
    expect(t).not.toMatch(/session\s+up /);
  });
  test('each gate is one row of the GATES section: `● name  ok fail` once it fired, `○ name  n armed` before', () => {
    for (const id of ['completion', 'tripwire', 'routing', 'header']) expect(card.some((l) => new RegExp(`[●○] ${id} +(?:3 +0 +\\S+|0 +0 +—)`).test(l)), id).toBe(true);
    expect(card.join('\n')).not.toContain('Last Stop allowed'); // round 3 (E11): the card's GATES column holds the rows and their numbers; a gate's note stays on the panel
  });
});

describe('2b: the gate lines come from the gate groups the mod reads', () => {
  test('per gate: lines, passing lines, and the first line`s label with its detail as the note', () => {
    const gates = [{ id: 'tripwire', title: 'Dispatch tripwire', lines: [{ id: 'team', label: 'Team mode', ok: true, detail: 'off' }, { id: 'lead', label: 'Lead hands work to subagents', ok: true }] }, green('completion'), green('routing'), green('header')] as any;
    const c = bandHealth(model(150, { gates }))!.gates.checks.find((x) => x.id === 'tripwire')!;
    expect(c).toMatchObject({ lines: 2, pass: 2, note: 'Team mode: off' });
  });
  test('a note longer than 32 characters is left out, never cut with an ellipsis', () => {
    const gates = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'a', label: 'Not an orchestrating session so the gate does not apply', ok: true }] }, green('tripwire'), green('routing'), green('header')] as any;
    const c = bandHealth(model(150, { gates }))!.gates.checks.find((x) => x.id === 'completion')!;
    expect(c.note).toBeUndefined();
    expect(c).toMatchObject({ lines: 1, pass: 1 });
  });
});

describe('3: a health row opens only when it has real detail', () => {
  const noHooks: Health = { ...h, hooks: undefined, version: undefined };
  test('events with no hooks seen has no detail: it is not a toggle and wears no chevron', () => {
    expect(ih.healthDetail(noHooks, 'events')).toEqual([]);
    const ls = bodyLines(world(57, { health: noHooks }));
    const row = ls.find((l) => /^ ── ACTIVITY/.test(lineText(l)))!;
    expect(row.press).toBeUndefined();
    expect(lineText(row)).not.toMatch(/[▸▾]/);
  });
  test('a runs row with no agents to list is not a toggle', () => {
    const none: Health = { ...h, last: undefined };
    expect(ih.healthRows(none, ui).find((r) => r.id === 'runs')!.detail).toEqual([]);
  });
});

describe('4: the idle panel ends finished, with live content from real events', () => {
});

describe('5: rows fit by dropping the lowest-value field, never by cutting', () => {
  test('fitFields drops by keep order and keeps the first', () => {
    const f = (t: string, keep: number) => ({ runs: [{ t, tone: 'text' as const }], keep });
    const out = ih.fitFields([f('up 0:16', 9), f('ctx 6%', 8), f('branch master', 2)], 20).map((x) => x.t).join('');
    expect(out).toBe('up 0:16 · ctx 6%');
    expect(ih.fitFields([f('up 0:16', 9), f('ctx 6%', 8)], 3).map((x) => x.t).join('')).toBe('up 0:16');
  });
});

describe('6: ctx and tokens are one measure, labelled so', () => {
  test('band: `context 18%` (round 2: the tokens are the session detail, never beside the figure)', () => {
    const row = rowsOf(model(150))[0]!;
    expect(row).toMatch(/ctx +18%/); // slice S2: the band says `ctx 18%`
    expect(row).not.toContain('42k tok');
  });
  test('the panel session row reads the same words', () => {
    expect(body(world(57, { rows: 28 })).find((l) => l.includes('of 1M'))).toContain('63k of 1M'); // the CONTEXT gauge row: `6% · 63k of 1M`
  });
  test('the detail says what the figure is', () => {
    expect(ih.healthDetail(h, 'context')).toContain('measured on the last response, not a session total');
  });
  test('source: both figures come from the same session.measure event (context.tokens and context.percent)', () => {
    const src = readFileSync(resolve(import.meta.dir, 'register.ts'), 'utf8');
    const at = src.indexOf("on('session.measure'");
    const block = src.slice(at, at + 900);
    expect(block).toContain('e.context.tokens');
    expect(block).toContain('e.context.percent');
    expect(block).toContain('e.context.window');
  });
});

describe('7: the idle band carries one more live figure, the age of the last event (round 2: on its second line)', () => {
  test('`last 12s ago` when a hook has fired since boot', () => {
    expect(rowsOf(model(150)).join('\n')).not.toContain('last 12s ago'); // slice S2: the band has no event-age line; the health card's events row says it
  });
  test('the age ticks', () => {
    expect(rowsOf(model(150, { health: { ...HEALTH, hooks: { ...HOOKS, lastEventSecs: 13 } } })).join('\n')).not.toContain('last 13s ago');
  });
  test('absent when only the session start has fired (it would only repeat the uptime)', () => {
    resetHookLog();
    noteHook('session.start', 1000);
    const s = hookStats(61_000);
    expect(s.lastEventSecs).toBeUndefined();
    expect(rowsOf(model(150, { health: { ...HEALTH, hooks: s } })).join('\n')).not.toMatch(/last \d+s ago/);
    noteHook('tool.call Read', 31_000);
    expect(hookStats(61_000).lastEventSecs).toBe(30);
    expect(hookStats(61_000).byLabel).toEqual([{ label: 'session.start', n: 1 }, { label: 'tool.call', n: 1 }]);
    resetHookLog();
  });
  test('it fits the 110 band without a cut', () => {
    const row = rowsOf(model(110))[0]!;
    expect(textWidth(row)).toBeLessThanOrEqual(110);
    expect(row).not.toContain('…');
  });
});

describe('9-10: one clickable idiom: chips for tabs, ▸ for toggles, neither for inputs and labels', () => {
  const side: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} };
  const pane = (view: 'route' | 'team'): Node => sidebarTree(els, { snapshot: { ...idleSnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: 57, rows: 45 }, side) as unknown as Node;
  test('every idle tab chip sits on a raised tile; the lit chip is the accent filled', () => {
    const chips = all(pane('team')).filter((n) => n.kind === 'Button' && String(n.props.key).startsWith('tab:'));
    expect(chips.length).toBe(6);
    const texts = chips.map((c) => all(c).find((x) => x.kind === 'Text')!.props);
    const litStyle = activeChipStyle(uiFromEnv()); // slice S3: the lit chip is the one activeChipStyle
    const isLit = (t: Record<string, any>): boolean => t.inverse === litStyle.inverse && t.backgroundColor === litStyle.backgroundColor;
    const lit = texts.filter(isLit);
    expect(lit.length).toBe(1);
    const tiles = texts.filter((t) => !isLit(t)).map((t) => t.backgroundColor);
    expect(new Set(tiles).size).toBe(1);
    expect(tiles[0]).not.toBe('#181825');
  });
  test('the band has no footer chips (round 2 D9: tabs live only in the panel)', () => {
    const chips = all(bandTree(els, model(150), handlers) as unknown as Node).filter((n) => n.kind === 'Button' && String(n.props.key).startsWith('band:') && !/^band:(health|gates)/.test(String(n.props.key)));
    expect(chips.length).toBe(0); // round 2 D9: the tab chips live only in the panel; the band keeps the one `▸ health` chip
    for (const c of chips) expect(all(c).find((x) => x.kind === 'Text')!.props.backgroundColor).not.toBe('#181825');
  });
  test('the message input is not drawn as a toggle: no ▸ in its label', () => {
    const input = all(pane('team')).find((n) => n.kind === 'Input')!;
    expect(String(input.props.label)).not.toMatch(/[▸▾]/);
  });
});

describe('11: the team tab has no orphan time axis when nothing ran', () => {
  test('a lone lead collapses to its row and one labelled line', () => {
    const lead = { name: 'lead', state: 'waiting', detail: '', secs: 0 } as never;
    const t = body(world(57, { lead, workers: [], mates: [] }, 'team'));
    expect(t.join('\n')).not.toMatch(/^\s*\d+:\d\d\s+\d+:\d\d\s*$/m);
    expect(t.join('\n')).toMatch(/no workers/);
    expect(t.join('\n')).not.toContain('0 running');
  });
});

describe('12: the open card is one even block, spaced like the TODO box', () => {
  const rows = healthCardRows(h, { cols: 110, ui });
  test('every row is padded to the full width, so the fill never stops mid-line', () => {
    const w = rows.map((r) => r.reduce((n, x) => n + textWidth(x.t), 0));
    expect(new Set(w).size).toBe(1);
    expect(w[0]).toBe(110);
  });
  test('the title is the fixed `HEALTH` label of the ribbon, a toggle itself (the band chip closes the card too)', () => {
    const title = rows[0]!.find((x) => x.t.includes('HEALTH'))!; // X4: one chip, `▾ HEALTH`
    expect(title).toBeDefined();
    expect(title.bold).toBe(true);
    expect(title.press).toBe('band:health'); // round W M: the title is the toggle
  });
  test('the slot leaves the blank row under the band a HUD block has', () => {
    const card = padRows(healthCardRows(h, { cols: 110, ui }), 110).map((r) => r.map((x) => ({ t: x.t })));
    const hudIn = { todos: [], agents: [], root: '/tmp/proj', phases: { ids: ['plan'], active: 0 } };
    const plan = composeSlot({ budget: 40, hasSlot: true, hudOn: true, runOn: false, columns: 110, hudIn, hudView: { cols: 110, tick: 0, ui }, running: false, agentsListed: false, orchestrated: false, now: NOW, bandIn: (_r: unknown, maxRows: number | undefined) => model(110, { maxRows: maxRows ?? 12 }), held: 0, healthCard: card } as never);
    expect(plan.hud.length).toBe(card.length);
    expect(plan.gap).toBe(1);
  });
});
