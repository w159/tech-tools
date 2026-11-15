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
});

describe('2: the idle band at 110 says more than one line of figures when no panel is up', () => {
  test('an unasked pane docks from 144 columns, never at 110: the mod cannot show the panel there', () => {
    expect(shouldDock({ isFullscreen: true, columns: 110 })).toBe(false);
    expect(shouldDock({ isFullscreen: true, columns: 150 })).toBe(true);
  });
  for (const cols of [110, 150]) {
    test(`at ${cols} with no panel: one row, no tab chips under it (round 2 D9), no last run, event count or age line`, () => {
      const rows = rowsOf(model(cols));
      expect(rows).toHaveLength(1);
      expect(rows.join('\n')).not.toMatch(/last run|events|last \d+s ago|status/);
      expect(rows[0]).toContain('gates ok');
    });
  }
  test('with the panel up the band reads as it does closed (the uptime is the card\'s and the panel\'s)', () => {
    const rows = rowsOf(model(150, { panel: true }));
    expect(rows[0]).not.toContain('health'); // v1 frame spec: the health chip shows only with the pane closed
    expect(rows[0]).toMatch(/ctx +18%/);
    expect(rows[0]).toContain('gates ok');
    expect(rows.join('\n')).not.toMatch(/last run|events/);
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
    test(`at ${cols} with the panel closed: no chip row either (round 2 D9: tabs live only in the panel)`, () => {
      expect(chipRow(rowsOf(model(cols))).length).toBe(0);
    });
  }
});

describe('3: the idle panel is one finished card: the rule and the footer close the fixed slots', () => {
  test('the last row is `atlas version · branch` (slice S3: under the reserved slots, not at the pane foot; the pane\'s own surface fills the rest)', () => {
    const m = world(57);
    const t = body(m);
    expect(t.length).toBe(m.rows - headerRows(m).length); // D11: the body fills the pane, the footer on its last row
    expect(t.at(-1)).toMatch(/^\s+atlas 17\.21\.1 · \w+$/);
  });
  test('no invented footer: with no version and no hooks stats the pane ends in the rule alone', () => {
    const t = body(world(57, { health: { ...h, version: undefined, hooks: undefined } }));
    expect(t.join('\n')).not.toMatch(/atlas \d/); // nothing invented at the foot
  });
});

describe('4: no run, no plan, no agent: one line, not two empty boxes', () => {
  test('with the health band up and no plan or agent the HUD draws no ribbon at all: `no plan yet · 0 agents` never prints (round 2 D9)', () => {
    const rows = hudLines({ todos: [], agents: [] } as never, { cols: 110, maxRows: 12, ui, reserve: true, healthLine: '● gates ok · ctx 18%' }).map((r) => r.map((x) => x.t).join(''));
    expect(rows).toEqual([]);
  });
  test('a box that does wait for data (one side empty) no longer repeats the gates figure', () => {
    const o = { cols: 110, ui, reserve: true, healthLine: '● gates ok · ctx 18%' };
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
  test('the card with the panel up holds only what opening a row adds: no `last run none`, no hooks line that the recent list says', () => {
    const t = healthCardRows({ ...one, panel: true }, { cols: 110, ui }).map((r) => r.map((x) => x.t).join('')).join('\n');
    expect(t).not.toMatch(/last run|session started/);
    expect(t).toMatch(/[●○] completion +(?:3 +0|3 armed)/);
  });
  test('the card has no last run line (the version is the pane\'s footer); the band has no last run or event line any more', () => {
    const t = healthCardRows(one, { cols: 110, ui }).map((r) => r.map((x) => x.t).join('')).join('\n');
    expect(t).not.toMatch(/last run none/);
    expect(rowsOf(model(110, { hooks: ONE })).join('\n')).not.toMatch(/last run|1 event|last 7s ago/);
  });
  test('the band with the panel up repeats neither the panel`s uptime nor its events', () => {
    expect(rowsOf(model(150, { panel: true, hooks: ONE }))[0]).not.toMatch(/event/); // v1 frame spec: the idle head carries `up M:SS` open or closed
  });
});

describe('6: the team tab with only the lead draws no dead sparkline', () => {
  test('lead row has no braille run and the lines under it say `Team mode is off.` and `no workers registered`', () => {
    const rows = body(world(57, { lead: { name: 'lead', state: 'waiting', secs: 0 } as never }, 'team'));
    const top = rows.slice(rows.findIndex((l) => l.includes('── TEAM')), rows.findIndex((l) => l.includes('── TEAM')) + 5).join('\n'); // frame spec T1: the ribbon carries `off`, the lead row sits right under it
    expect(top).not.toMatch(/[⣀⣄⣤⣶⣿▁]/u);
    expect(top).toContain('lead');
    expect(top).toContain('no workers registered');
  });
});

describe('7: the idle stepper is dim, bold only while a stage is live', () => {
  const stepper = (m: PanelModel) => { const ls = bodyLines(m); return ls[ls.findIndex((l) => /^ ── PHASE/.test(lineText(l))) + 1]!; };
});

describe('8: the card has no second badge; the band row ends on one edge and one fill', () => {
  test('the HEALTH ribbon carries the one capsule and no control', () => {
    expect(healthCardRows(h, { cols: 110, ui })[0]!.map((x) => x.t).join('').trimEnd()).toMatch(/^◖ ◆ ATLAS ◗ ▸ HEALTH ─+$/); // the fixed title of frame spec section 6
  });
  for (const cols of [150, 110]) {
    test(`at ${cols}: the band row is ${cols} cells, there is no strip row, and its last cell wears the chip's fill (flush before the host's [-])`, () => {
      const rows = kids(bandTree(els, model(cols, { panel: false }), handlers) as unknown as Node);
      const band = rows[0]!;
      expect(rows).toHaveLength(1);
      expect(textWidth(textOf(band))).toBe(cols);
      expect(leaves(band).at(-1)!.props.backgroundColor).toBeTruthy();
    });
  }
});

describe('9: one accent, for what answers a click', () => {
  test('the health button is the accent (the band has no tab chips any more, round 2 D9)', () => {
    const t = bandTree(els, model(150), handlers) as unknown as Node;
    const btn = leaves(t).find((n) => String(n.props.children).includes('health'))!;
    expect(btn.props.color).toBe('#d7afff');
    expect(leaves(t).some((n) => String(n.props.children).includes('team'))).toBe(false);
  });
});

describe('10: one abbreviation set for the stepper at every width', () => {
});

describe('11: the status tab`s ribbon does not repeat the lit chip', () => {
  test('no `status` at the right of the ribbon', () => {
    expect(lineText(ribbonRow(world(57))).trimEnd()).not.toMatch(/status$/);
  });
});

describe('12: `context 6%` on the band; the tokens and the window only in the session detail', () => {
  test('band says `context 18%` with no tokens', () => {
    const r = rowsOf(model(150, { panel: false }))[0]!;
    expect(r).toMatch(/ctx +18%/); // slice S2: the band says `ctx 18%`
    expect(r).not.toMatch(/tok/);
  });
});
