// Idle polish, round 2: what the second hostile critic found in the idle and empty states at 110 and 150. One describe per defect.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandRowCount, bandTree, type BandHandlers, type BandModel } from './band';
import { busySnap, NOW } from './live_fixture';
import { uiFromEnv } from './atlas-ui';
import { healthCardRows } from './hud-surface';
import { hudLines } from './hud';
import { bodyLines, headerRows, lineText, ribbonRow, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { textWidth } from './theme';
import type { Health } from './idle-health';
import { shouldDock } from './register';
import { todoRows, agentRows } from './hud-surface';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const leaves = (n: Node): Node[] => (kids(n).length ? kids(n).flatMap(leaves) : [n]);
const textOf = (n: Node): string => (n.kind === 'Text' || typeof n.props.children === 'string' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const handlers: BandHandlers = { openView() {}, toggleTodos() {}, toggleHealth() {} };
const green = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as any;
const GATES = [green('completion'), green('tripwire'), green('routing'), green('header')];
const HOOKS = { total: 6, byLabel: [{ label: 'tool.call', n: 3 }, { label: 'session.measure', n: 2 }, { label: 'session.start', n: 1 }], recent: [{ label: 'tool.call Bash', ageSecs: 12 }, { label: 'session.measure', ageSecs: 40 }, { label: 'session.start', ageSecs: 70 }], lastEventSecs: 12 };
const ONE = { total: 1, byLabel: [{ label: 'session.start', n: 1 }], recent: [{ label: 'session.start', ageSecs: 7 }], lastEventSecs: 7 };
const HEALTH = { upSecs: 724, version: '17.21.1', branch: 'main', tokens: 42_000, window: 1_000_000, hooks: HOOKS, open: false };
const idleSnap = () => busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 18 } as never);
const model = (columns: number, health: Record<string, unknown> = {}): BandModel => ({ snapshot: idleSnap(), live: [], gates: GATES, columns, tick: 0, maxRows: 12, ui, health: { ...HEALTH, ...health } as never });
const rowsOf = (b: BandModel): string[] => kids(bandTree(els, b, handlers) as unknown as Node).map(textOf);

const h: Health = {
  gates: { total: 4, green: 4, checks: ['completion', 'tripwire', 'routing', 'header'].map((id) => ({ id, ok: true, lines: 3, pass: 3, note: 'Last Stop allowed' })) },
  ctxPct: 6, tokens: 63_000, window: 1_000_000, upSecs: 16, branch: 'master', version: '17.21.1', hooks: HOOKS,
};
const world = (cols: number, over: Partial<PanelModel> = {}, tab: 'route' | 'team' = 'route'): PanelModel =>
  panelWorld(tab, cols, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], run: { kind: 'idle', secs: 0, startMs: NOW }, health: h, ...over } as never);
const body = (m: PanelModel): string[] => bodyLines(m).map(lineText);
const working = { kind: 'working' as const, secs: 1, startMs: NOW, frame: 0 };

describe('1: the work state with no agent draws the health rows at every pane width', () => {
  for (const cols of [37, 57, 80]) {
    test(`at ${cols}: hooks, gates, session and last run; none of the old placeholders`, () => {
      const t = body(world(cols, { run: working })).join('\n');
      for (const k of ['hooks', 'gates', 'session']) expect(t, k).toContain(k);
      expect(t).not.toContain('last run'); // the live run's clock is the phase row's: a `last run` row would be the same run twice
      expect(t).not.toMatch(/no agents yet|no events yet|Completion gate|Dispatch tripwire|Header contract/);
    });
  }
});

describe('2: the idle band at 110 says more than one line of figures when no panel is up', () => {
  test('an unasked pane docks from 144 columns, never at 110: the mod cannot show the panel there', () => {
    expect(shouldDock({ isFullscreen: true, columns: 110 })).toBe(false);
    expect(shouldDock({ isFullscreen: true, columns: 150 })).toBe(true);
  });
  for (const cols of [110, 150]) {
    test(`at ${cols} with no panel: a second line holds the last run, the events and their age`, () => {
      const rows = rowsOf(model(cols));
      expect(rows[1]).toMatch(/^\s+last run none · 6 events · last 12s ago/);
      expect(rows[0]).toContain('gates 4/4');
    });
  }
  test('with the panel up the band is the state and the button only', () => {
    const rows = rowsOf(model(150, { panel: true }));
    expect(rows[0]).toContain('▸ health');
    expect(rows.join('\n')).not.toMatch(/gates 4\/4|up 12:04|context|last run|events/);
  });
});

describe('2b: the band drops its tab chips while the side panel shows its own strip', () => {
  const chipRow = (rows: string[]) => rows.filter((r) => /status\s+team\s+channel/.test(r));
  for (const cols of [110, 150]) {
    test(`at ${cols} with the panel open: no chip row and no blank row left`, () => {
      const open = rowsOf(model(cols, { panel: true }));
      expect(chipRow(open)).toEqual([]);
      expect(open.at(-1)?.trim()).not.toBe('');
      expect(bandRowCount(model(cols, { panel: true }), true)).toBe(1); // the health row alone: the chip row is gone and no blank stands in for it
    });
    test(`at ${cols} with the panel closed: the chip row is drawn`, () => {
      expect(chipRow(rowsOf(model(cols))).length).toBe(1);
    });
  }
});

describe('3: the idle panel is one finished card: the rule and the footer close the fixed slots', () => {
  test('the last two rows are the rule and `atlas version · hooks loaded` (slice S3: under the reserved slots, not at the pane foot; the pane\'s own surface fills the rest)', () => {
    const m = world(57);
    const t = body(m);
    expect(t.length).toBeLessThan(m.rows - headerRows(m).length - 1);
    expect(t.at(-1)).toMatch(/^\s+atlas 17\.21\.1 · hooks loaded$/);
    expect(t.at(-2)).toMatch(/^\s+─{20,}$/);
  });
  test('no invented footer: with no version and no hooks stats the pane ends in the rule alone', () => {
    const t = body(world(57, { health: { ...h, version: undefined, hooks: undefined } }));
    expect(t.filter((l) => l.trim() !== '').at(-1)).toMatch(/^\s+─{20,}$/);
  });
});

describe('4: no run, no plan, no agent: one line, not two empty boxes', () => {
  test('the HUD holds a single `no plan yet · 0 agents` row with no gates figure', () => {
    const rows = hudLines({ todos: [], agents: [] } as never, { cols: 110, maxRows: 12, ui, reserve: true, healthLine: '● gates 4/4 · ctx 18%' }).map((r) => r.map((x) => x.t).join(''));
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('no plan yet · 0 agents');
    expect(rows[0]).not.toMatch(/gates|appear here|ctx/);
  });
  test('a box that does wait for data (one side empty) no longer repeats the gates figure', () => {
    const o = { cols: 110, ui, reserve: true, healthLine: '● gates 4/4 · ctx 18%' };
    for (const rows of [todoRows([], o as never, { spacers: false, extras: false }), agentRows([], o as never, { spacers: false, extras: false })]) expect(rows.map((r) => r.map((x) => x.t).join('')).join('\n')).not.toMatch(/gates|ctx/);
  });
  test('the TODO and SUBAGENTS ribbons keep their markers when they hold data', () => {
    const o = { cols: 110, ui, reserve: true };
    expect(todoRows([], o as never, { spacers: false, extras: false })[0]!.map((x) => x.t).join('')).toContain('◖ ◆ ATLAS ◗ ▸ TODO');
    expect(agentRows([], o as never, { spacers: false, extras: false })[0]!.map((x) => x.t).join('')).toContain('◖ ◆ ATLAS ◗ ▸ SUBAGENTS');
  });
});

describe('5: each fact once across the band, the card and the panel', () => {
  const one: Health = { ...h, hooks: ONE };
  test('the panel: `session.start` once, no `last 7s ago` on the hooks row beside the recent list, no `1 event` AND `session.start 1`', () => {
    const t = body(world(57, { health: one, expanded: 'health:events' })).join('\n');
    expect(t.match(/session started/g)?.length).toBe(1); // in words (idle polish 3), once
    expect(t).not.toMatch(/last \d+s ago/);
    expect(t.match(/up 0:16/g)?.length).toBe(1);
  });
  test('the card with the panel up holds only what opening a row adds: no `last run none`, no hooks line that the recent list says', () => {
    const t = healthCardRows({ ...one, panel: true }, { cols: 110, ui }).map((r) => r.map((x) => x.t).join('')).join('\n');
    expect(t).not.toMatch(/last run|session\.start|session started/);
    expect(t).toContain('atlas 17.21.1'); // idle polish 3: the card is one schema at every width, version included
    expect(t).toContain('● completion 3/3');
  });
  test('the card with no panel leaves the last run and the events to the band`s second line, and keeps the version', () => {
    const t = healthCardRows(one, { cols: 110, ui }).map((r) => r.map((x) => x.t).join('')).join('\n');
    expect(t).not.toMatch(/last run none|session\.start/);
    expect(t).toContain('atlas 17.21.1');
    expect(rowsOf(model(110, { hooks: ONE }))[1]).toMatch(/last run none · 1 event · last 7s ago/);
  });
  test('the band with the panel up repeats none of the panel`s figures', () => {
    expect(rowsOf(model(150, { panel: true, hooks: ONE }))[0]).not.toMatch(/gates|up \d|context|event/);
  });
});

describe('6: the team tab with only the lead draws no dead sparkline', () => {
  test('lead row has no braille run and the line under it is `no workers yet`', () => {
    const rows = body(world(57, { lead: { name: 'lead', state: 'waiting', secs: 0 } as never }, 'team'));
    const top = rows.slice(0, rows.findIndex((l) => l.includes('no workers yet')) + 1).join('\n'); // slice S3: the pulse summary under the line has its own sparks
    expect(top).not.toMatch(/[⣀⣄⣤⣶⣿▁]/u);
    expect(top).toContain('lead');
    expect(top).toContain('no workers yet');
  });
});

describe('7: the idle stepper is dim, bold only while a stage is live', () => {
  const stepper = (m: PanelModel) => { const ls = bodyLines(m); return ls[ls.findIndex((l) => lineText(l).trim() === 'phase') + 1]!; };
  test('idle: no bold run in the stepper and the first stage is not the body tone', () => {
    const l = stepper(world(57));
    expect(l.runs.some((x) => x.bold)).toBe(false);
    expect(l.runs.find((x) => x.t.includes('research'))!.tone).not.toBe('text');
  });
  test('working: the lit stage is bold body text', () => {
    const l = stepper(world(57, { run: working, phase: 'research' }));
    expect(l.runs.find((x) => x.t.includes('research'))).toMatchObject({ tone: 'text', bold: true });
  });
});

describe('8: the card has no second badge; the band row and the chip strip end on one edge and one fill', () => {
  test('HEALTH ribbon carries no `◖ ◆ ATLAS ◗`', () => {
    expect(healthCardRows(h, { cols: 110, ui })[0]!.map((x) => x.t).join('')).toMatch(/^── ▾ HEALTH ─+ ▾ hide ──$/); // slice S4: a flat ribbon with its close chip
  });
  for (const cols of [150, 110]) {
    test(`at ${cols}: both rows are ${cols} cells and their last cells wear the same fill`, () => {
      const rows = kids(bandTree(els, model(cols, { panel: false }), handlers) as unknown as Node);
      const band = rows[0]!;
      const strip = rows.find((r) => textOf(r).includes('status'))!;
      expect(textWidth(textOf(band))).toBe(cols);
      expect(textWidth(textOf(strip))).toBe(cols);
      const last = (r: Node) => leaves(r).at(-1)!.props.backgroundColor;
      expect(last(strip)).toBe(last(band));
    });
  }
});

describe('9: one accent, for what answers a click', () => {
  test('the health button and the lit-or-idle tab chips are the accent; the strip tile is raised off the band fill', () => {
    const t = bandTree(els, model(150), handlers) as unknown as Node;
    const btn = leaves(t).find((n) => String(n.props.children).includes('health'))!;
    expect(btn.props.color).toBe('#af87ff');
    const chip = leaves(t).find((n) => String(n.props.children).includes('team'))!;
    expect(chip.props.color).toBe('#af87ff');
    expect(chip.props.backgroundColor).not.toBe(leaves(t).at(-1)!.props.backgroundColor); // a chip is a tile on the strip, the only raised fill of the two rows
  });
  test('the panel`s row labels and chevrons are the same accent', () => {
    const l = bodyLines(world(57)).find((x) => lineText(x).includes('gates'))!;
    expect(l.runs.find((x) => x.t.includes('gates'))).toMatchObject({ tone: 'accent' });
  });
});

describe('10: one abbreviation set for the stepper at every width', () => {
  for (const cols of [37, 44, 57, 80, 110]) {
    test(`at ${cols}: one glyph per stage, names whole where they fit, else the three-letter set`, () => {
      const rows = body(world(cols));
      const t = rows[rows.findIndex((l) => l.trim() === 'phase') + 1]!;
      expect(t).not.toMatch(/[›·]/);
      expect(t.match(/[○●◐◓◑◒]/g)!.length).toBe(world(cols).phases.length);
      expect(/research/.test(t) ? /\bres\b/.test(t) : /\bres\b/.test(t)).toBe(!/research/.test(t)); // whole names, or the three-letter set, never a mix
    });
  }
});

describe('11: the status tab`s ribbon does not repeat the lit chip', () => {
  test('no `status` at the right of the ribbon', () => {
    expect(lineText(ribbonRow(world(57))).trimEnd()).not.toMatch(/status$/);
  });
});

describe('12: `context 6%` on the band; the tokens and the window only in the session detail', () => {
  test('band says `context 18%` with no tokens', () => {
    const r = rowsOf(model(150, { panel: false }))[0]!;
    expect(r).toContain('context 18%');
    expect(r).not.toMatch(/tok/);
  });
  test('the context row says the gauge and `63k of 1M`', () => {
    expect(body(world(57, { rows: 24 })).find((l) => l.includes('context'))).toMatch(/▕.*▏ 63k of 1M/); // a short pane: the context row (slice S4: framed gauge and `63k of 1M`), its detail the exact tokens
    expect(body(world(57, { rows: 24 })).find((l) => l.includes('context'))).not.toMatch(/tok/);
    expect(body(world(57)).join('\n')).toMatch(/context {1,2}▕[█▏▎▍▌▋▊▉░]+▏ 63k of 1M/); // slice S3: one context row on the grid, the gauge and `63k of 1M`; the exact tokens are the card's
  });
});
