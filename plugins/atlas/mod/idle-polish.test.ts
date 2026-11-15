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
      expect(rows[0]).toContain('● gates 4/4');
      expect(rows.join('\n')).not.toMatch(/checks|4\/4 green|completion/);
    });
    test(`at ${cols}, a gate not green brings the checks row back`, () => {
      const rows = rowsOf(model(cols, { gates: [...GATES.slice(0, 3), green('header', false)] }));
      expect(rows.join('\n')).toMatch(/checks .*header/);
    });
  }
});

describe('2: the expanded card adds per-gate detail, never the band again', () => {
  const card = healthCardRows(h, { cols: 110, ui }).map((r) => r.map((x) => x.t).join(''));
  test('no line restates the band (`gates 4/4`, the four names on one row, `up`, `ctx`)', () => {
    const t = card.join('\n');
    expect(t).not.toMatch(/4\/4/);
    expect(t).not.toMatch(/completion.*tripwire.*routing/);
    expect(t).not.toMatch(/\bup \d/);
  });
  test('each gate has its own line: state, passing checks and its own words', () => {
    for (const id of ['completion', 'tripwire', 'routing', 'header']) expect(card.some((l) => new RegExp(`${id} green 3/3 pass\\s*│?$`).test(l)), id).toBe(true); // one schema per check: its note is a line of its own, never glued on
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
  test('hooks with no events and no version has no detail: it is not a toggle and wears no chevron', () => {
    expect(ih.healthDetail(noHooks, 'hooks')).toEqual([]);
    const ls = bodyLines(world(57, { health: noHooks }));
    const row = ls.find((l) => lineText(l).includes('hooks'))!;
    expect(row.press).toBeUndefined();
    expect(lineText(row)).not.toMatch(/[▸▾]/);
  });
  test('hooks with events opens to the count by event kind, and the version line is gone', () => {
    const t = body(world(57, { expanded: 'health:hooks' })).join('\n');
    expect(t).toMatch(/tool call 3 {3}context measured 2/);
    expect(t).not.toContain('hooks module loaded, mod drawing');
    expect(t.match(/atlas 17\.21\.1/g)?.length).toBe(1); // round 2: the version is said once, in the pinned footer (the session row's detail no longer repeats it)
  });
  test('the session row never prints what its detail says: the branch and the version only show when it opens', () => {
    expect(body(world(80)).find((l) => l.includes('session'))).not.toContain('branch');
    const open = body(world(57, { rows: 24, expanded: 'health:session' })).join('\n'); // a short pane keeps the figures in the session row's detail (a tall one draws them as rows)
    expect(open).toContain('branch master');
    expect(open.match(/atlas 17\.21\.1/g)?.length).toBe(1); // the pinned footer is where the version lives
  });
  test('session opens to the context against its window; last run to each agent`s end state', () => {
    expect(body(world(57, { rows: 24, expanded: 'health:session' })).join('\n')).toContain('63,000 of 1,000,000 tokens in the window');
    const last = body(world(57, { expanded: 'health:last' })).join('\n');
    expect(last).toMatch(/alpha done 0:42/);
    expect(last).toMatch(/beta failed 0:07/);
  });
  test('a last run row with no agents to list is not a toggle', () => {
    const none: Health = { ...h, last: undefined };
    expect(ih.healthRows(none, ui).find((r) => r.id === 'last')!.detail).toEqual([]);
  });
});

describe('4: the idle panel ends finished, with live content from real events', () => {
  test('a recent list of the hook events with their ages, then a closing rule', () => {
    const t = body(world(57));
    const i = t.findIndex((l) => l.includes('recent'));
    expect(i).toBeGreaterThan(0);
    expect(t.slice(i + 1, i + 3).map((l) => l.trim())).toEqual(['12s ago  tool call Bash', '40s ago  context measured']);
    const tail = t.filter((l) => l.trim() !== '');
    expect(tail.at(-2)).toMatch(/^\s+─{20,}$/); // round 2: the rule, then the pinned footer
    expect(tail.at(-1)).toMatch(/^\s+atlas 17\.21\.1 · hooks loaded$/);
  });
  test('with no events the panel still ends in the rule and prints no recent heading', () => {
    const t = body(world(57, { health: { ...h, hooks: undefined } }));
    expect(t.join('\n')).not.toContain('recent');
    const tail = t.filter((l) => l.trim() !== '');
    expect(tail.at(-2)).toMatch(/^\s+─{20,}$/);
    expect(tail.at(-1)).toMatch(/^\s+atlas 17\.21\.1$/); // no hooks stats: the footer holds only the version
  });
});

describe('5: rows fit by dropping the lowest-value field, never by cutting', () => {
  for (const cols of [57, 44]) {
    test(`at ${cols}: no ellipsis in the health rows`, () => {
      const t = body(world(cols, { health: { ...h, last: { ...h.last!, secs: 2, agents: 0, failed: 0, total: 5, done: 5 } } })).filter((l) => /^\s+[▸▾]?\s*(session|last run) +\S/.test(l));
      expect(t.length).toBe(2);
      for (const l of t) expect(l, l).not.toContain('…');
      expect(t[0]).toContain('up 0:16');
      expect(t[1]).toContain('0:02');
    });
  }
  test('the branch is never in the value; `0 agents` and `0 failed` never print at all', () => {
    const t = body(world(57));
    expect(t.find((l) => l.includes('session'))).not.toContain('branch');
    const last = t.find((l) => l.includes('last run'))!;
    expect(last).not.toContain('0 failed');
    expect(last).toContain('ended 10m ago');
  });
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
    expect(row).toContain('context 18%');
    expect(row).not.toContain('42k tok');
  });
  test('the panel session row reads the same words', () => {
    expect(body(world(57, { rows: 24 })).find((l) => l.includes('session'))).toContain('context 6%'); // a tall pane draws the gauge row instead (idle-polish3)
  });
  test('the detail says what the figure is', () => {
    expect(ih.healthDetail(h, 'session')).toContain('measured on the last response, not a session total');
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
    expect(rowsOf(model(150))[1]).toContain('last 12s ago');
  });
  test('the age ticks', () => {
    expect(rowsOf(model(150, { health: { ...HEALTH, hooks: { ...HOOKS, lastEventSecs: 13 } } }))[1]).toContain('last 13s ago');
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

describe('8: a narrow pane names the stages, it does not print bare dots', () => {
  for (const [cols, names] of [[54, /research.*theory.*test.*implement.*verify/], [46, /research 1\/5/]] as const) {
    test(`the idle phase chain at ${cols} cells reads ${cols === 54 ? 'whole names (round 2: no dot marks, so they fit)' : 'the current stage and n/5'}`, () => {
      const t = body(world(cols, { phases: ['research', 'theory', 'test', 'implement', 'verify'], phase: 'research' })).find((l) => l.includes('research'))!;
      expect(t).toMatch(names);
      expect(t).not.toContain('· · ·');
      expect(textWidth(t)).toBeLessThanOrEqual(cols);
    });
  }
});

describe('9-10: one clickable idiom: chips for tabs, ▸ for toggles, neither for inputs and labels', () => {
  const side: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} };
  const pane = (view: 'route' | 'team'): Node => sidebarTree(els, { snapshot: { ...idleSnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: 57, rows: 45 }, side) as unknown as Node;
  test('every idle tab chip sits on a raised tile; the lit chip is the accent filled', () => {
    const chips = all(pane('team')).filter((n) => n.kind === 'Button' && String(n.props.key).startsWith('tab:'));
    expect(chips.length).toBe(6);
    const texts = chips.map((c) => all(c).find((x) => x.kind === 'Text')!.props);
    const lit = texts.filter((t) => t.inverse === true);
    expect(lit.length).toBe(1);
    const tiles = texts.filter((t) => t.inverse !== true).map((t) => t.backgroundColor);
    expect(new Set(tiles).size).toBe(1);
    expect(tiles[0]).not.toBe('#181825');
  });
  test('the band footer chips sit on the same raised tile', () => {
    const chips = all(bandTree(els, model(150), handlers) as unknown as Node).filter((n) => n.kind === 'Button' && String(n.props.key).startsWith('band:') && n.props.key !== 'band:health');
    expect(chips.length).toBe(6);
    for (const c of chips) expect(all(c).find((x) => x.kind === 'Text')!.props.backgroundColor).not.toBe('#181825');
  });
  test('the message input is not drawn as a toggle: no ▸ in its label', () => {
    const input = all(pane('team')).find((n) => n.kind === 'Input')!;
    expect(String(input.props.label)).not.toMatch(/[▸▾]/);
  });
  test('the `phase` label row is plain text, not a control', () => {
    const phase = bodyLines(world(57)).find((l) => lineText(l).includes('phase'))!;
    expect(phase.press).toBeUndefined();
    expect(lineText(phase)).not.toMatch(/[▸▾]/);
  });
});

describe('11: the team tab has no orphan time axis when nothing ran', () => {
  test('a lone lead collapses to its row and one labelled line', () => {
    const lead = { name: 'lead', state: 'waiting', detail: '', secs: 0 } as never;
    const t = body(world(57, { lead, workers: [], mates: [] }, 'team'));
    expect(t.join('\n')).not.toMatch(/^\s*\d+:\d\d\s+\d+:\d\d\s*$/m);
    expect(t.join('\n')).toContain('no workers yet');
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
  test('the title is bold body text, not dimmed', () => {
    const title = rows[0]!.find((x) => x.t === 'HEALTH')!;
    expect(title.tone).toBe('text');
    expect(title.bold).toBe(true);
  });
  test('the slot leaves the blank row under the band a HUD block has', () => {
    const card = padRows(healthCardRows(h, { cols: 110, ui }), 110).map((r) => r.map((x) => ({ t: x.t })));
    const hudIn = { todos: [], agents: [], root: '/tmp/proj', phases: { ids: ['plan'], active: 0 } };
    const plan = composeSlot({ budget: 20, hasSlot: true, hudOn: true, runOn: false, columns: 110, hudIn, hudView: { cols: 110, tick: 0, ui }, running: false, agentsListed: false, orchestrated: false, now: NOW, bandIn: (_r: unknown, maxRows: number | undefined) => model(110, { maxRows: maxRows ?? 12 }), held: 0, healthCard: card } as never);
    expect(plan.hud.length).toBe(card.length);
    expect(plan.gap).toBe(1);
  });
});
