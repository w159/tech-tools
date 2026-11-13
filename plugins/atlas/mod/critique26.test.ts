// Critique 26 (round2/after/critique-26.md, live captures of a5fa582a): "the mods just look incredibly cheap and have zero taste". Each test here failed on a5fa582a.
//   1  every colour on screen is an Atlas palette index, rendered in 256-colour mode (not only the source literals palette.test.ts reads)
//   2  one duration source and one format (`0:14`) on the card, the toast, the board, the panel, the HUD and the band
//   3  one text grey: a card does not recolour with age
//   4  no side panel row is nameless, wrapped or loses the agent's name to the task text
//   5  one spinner frame for every surface of a render, even when two renders overlap
//   6  an idle band's `△` and its words are dim, amber only while working or blocked
import { describe, expect, test } from 'claude-code/testing';
import { bandTree } from './band';
import { bandLines } from './mission-layout';
import { hudAgents, hudRows } from './hud';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import { busySnap, NOW } from './live_fixture';
import { Motion } from './motion';
import { hostTo256, holdSpinFrame, spinClock, spinFrameOf, withSpinFrame } from './atlas-ui';
import { sidebarTree } from './pane/sidebar';
import { boardTimeline } from './board-model';
import { notificationTree } from './transcript/cards';
import { outcomeText } from './transcript/outcome';
import { worldGates, worldIdleSnapshot } from '../contracts/world-live';
import { els, fadeSurfaces, indicesOf, on, PALETTE_INDICES, scene, sidebarModel, surfaces, textOf, UI256 } from './surface_indices';

/** The text of any tree the surfaces return: element trees, Segment rows and Run records alike. */
function flat(n: unknown): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(flat).join('');
  if (n === null || typeof n !== 'object') return '';
  const o = n as Record<string, unknown>;
  if (typeof o.t === 'string') return o.t;
  const kids = o.props && typeof o.props === 'object' && 'children' in (o.props as object) ? (o.props as { children: unknown }).children : o.children;
  const text = flat(kids);
  const row = (o.props as { flexDirection?: string } | undefined)?.flexDirection === 'row' || o.kind === 'Button';
  return Array.isArray(kids) && !row ? (kids as unknown[]).map(flat).join('\n') : text;
}
const NAMES = /(alpha|beta|gamma|ghost)-explorer|lead/;

describe('1: every surface lands on the palette in 256 colours', () => {
  for (const cols of [59, 36]) {
    test(`${cols} columns: panel tabs, HUD, band, cards, chips, toasts and every fade frame emit only palette indices`, () => {
      const bad: string[] = [];
      for (const s of [...surfaces(UI256, cols), ...fadeSurfaces(UI256, cols)]) {
        for (const [i, p] of indicesOf(s.tree)) if (!PALETTE_INDICES.has(i)) bad.push(`${s.name}: ${i} via ${p}`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('2: one duration source and one format', () => {
  test('a worker that ran 14.6 s reads `0:14` on the finish card text, never `15s`', () => {
    expect(outcomeText({ status: 'completed', line: 'STATUS: DONE', durationMs: 14_600 })).toBe('finished · 0:14');
  });
  test('the panel, the HUD, the band and the board timeline print the same clock for one agent, and none prints `14s`', () => {
    const s = scene('running');
    const live = liveWorkers(s, s.now);
    const hudIn = { todos: ownTodos(s.todos, s.sessionId), agents: hudAgents(live, s.squad, queuedMembers(s)), root: s.root };
    const panel = flat(withSpinFrame(1, () => sidebarTree(els, sidebarModel(s, 'team', 60, UI256), on)));
    const hud = flat(hudRows(hudIn, { cols: 120, tick: 0, ui: UI256, now: s.now, maxRows: 40 }));
    const band = flat(bandTree(els, { snapshot: s, live, gates: [], columns: 120, tick: 0, maxRows: 12, ui: UI256 } as never));
    const board = boardTimeline([{ name: 'alpha-explorer', state: 'running', secs: 14 }], { cols: 60, ui: UI256 }).map((l) => l.runs.map((r) => r.t).join('')).join('\n');
    for (const [name, text] of [['panel', panel], ['hud', hud], ['band', band], ['board', board]] as const) {
      expect([name, text.includes('0:14')]).toEqual([name, true]);
      expect([name, /(^|[^\w:.])\d{1,3}s\b/.test(text)]).toEqual([name, false]);
    }
  });
});

describe('3: one text grey on every card', () => {
  test('an aged card is drawn exactly as a fresh one', () => {
    const fresh = notificationTree('alpha-explorer', 'explorer', 'finished · 0:14', false, UI256, false);
    const aged = notificationTree('alpha-explorer', 'explorer', 'finished · 0:14', false, UI256, true);
    expect(aged).toEqual(fresh);
  });
});

describe('4: no side panel row is nameless or wrapped', () => {
  test('a row that has just appeared (its reveal under way) still names its agent, in every tab and width', () => {
    const after = scene('running');
    const items = after.squad.flatMap((a) => [{ key: `worker:${a.name}`, state: 'running' as const }, { key: `agent:${a.name}`, state: 'running' as const }]);
    const todoItems = after.todos.map((t) => ({ key: `task:${t.id}`, state: 'running' as const }));
    const mo = new Motion(true);
    mo.observe('x', [], NOW - 5000);
    mo.observe('x', [...items, ...todoItems], NOW);
    for (const cols of [60, 37]) {
      for (const view of ['route', 'team'] as const) {
        for (const dt of [0, 60, 120, 240]) {
          const text = flat(withSpinFrame(1, () => sidebarTree(els, sidebarModel(after, view, cols, UI256, mo.ctx(NOW + dt)), on)));
          for (const l of text.split('\n').filter((x) => /\brunning\b/.test(x) && !/^\s*(phase|agents|todo|workers)\b/.test(x))) expect([cols, view, dt, l, NAMES.test(l)]).toEqual([cols, view, dt, l, true]);
        }
      }
    }
  });
  test('at 36 and 59 columns each task is one row that keeps the agent name whole and ends in its state; a killed worker reads `killed` on its own row', () => {
    for (const kind of ['running', 'killed'] as const) {
      for (const cols of [37, 60]) {
        const rows = textOf(withSpinFrame(1, () => sidebarTree(els, sidebarModel(scene(kind), 'route', cols, UI256), on))).map((l) => l.trimEnd());
        for (const r of rows) expect([cols, r, [...r].length <= cols - 1]).toEqual([cols, r, true]);
        for (const id of ['T1', 'T2', 'T3']) {
          const own = rows.filter((l) => new RegExp(`\\b${id} `).test(l));
          expect([kind, cols, id, own.length]).toEqual([kind, cols, id, 1]);
          expect(own[0]).toMatch(/-explorer/); // the name, never the task, is what the cut takes
          expect(own[0]).toMatch(/\b(running|done|failed|queued|[a-z]+-explorer)$/); // the state closes the row, or the owner column after it
        }
        expect(rows.filter((l) => /^\s+(closed|worker killed|killed|failed)\b/.test(l))).toEqual([]);
        if (kind === 'killed') expect(rows.find((l) => /\bT3 /.test(l))).toMatch(/failed$/);
      }
    }
  });
});

describe('5: one spinner frame per render', () => {
  test('a render that starts while another draws turns the frame the first one holds', () => {
    const outer = holdSpinFrame(5);
    const inner = holdSpinFrame(6);
    try {
      expect(spinFrameOf(spinClock(0, 0))).toBe(5);
      expect(spinFrameOf(spinClock(NOW, 99))).toBe(5);
    } finally {
      inner();
      outer();
    }
    expect(spinFrameOf(spinClock(0, 3))).toBe(3); // outside a render the clock is the pure now + tick
  });
  test('the panel, the HUD and the band turn the same braille and the same circle in one render', () => {
    const s = scene('running');
    const live = liveWorkers(s, s.now);
    const hudIn = { todos: ownTodos(s.todos, s.sessionId), agents: hudAgents(live, s.squad, queuedMembers(s)), root: s.root };
    const seen = (text: string, set: string): string[] => [...new Set([...text].filter((c) => set.includes(c)))];
    for (const frame of [3, 4, 9]) {
      const [panel, hud, band] = withSpinFrame(frame, () => [
        flat(sidebarTree(els, sidebarModel(s, 'route', 60, UI256), on)),
        flat(hudRows(hudIn, { cols: 120, tick: 0, ui: UI256, now: s.now, maxRows: 40 })),
        flat(bandTree(els, { snapshot: s, live, gates: [], columns: 120, tick: 0, maxRows: 12, ui: UI256 } as never)),
      ]) as [string, string, string];
      const braille = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
      const circles = '◐◓◑◒';
      expect([frame, seen(panel + hud + band, braille)]).toEqual([frame, [braille[frame % 10]!]]);
      expect([frame, seen(panel + hud + band, circles)]).toEqual([frame, [circles[frame % 4]!]]);
    }
  });
});

describe('6: the gate warning is one colour in every state', () => {
  test('wave 31: `△` and its words keep the warn tone in every quiet state (idle phases and done; a working band shows no warning)', () => {
    const base = { cols: 150, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'plan', 'build', 'verify', 'done'] as const, total: 7, workers: [], checks: [{ id: 'routing', ok: false, name: 'routing' }], ui: { theme: 'mocha', ascii: false, color: '256' } as const };
    for (const [phase, done, busy] of [['research', 3, false], ['plan', 3, false], ['done', 7, false]] as const) {
      const runs = bandLines({ ...base, phase, done, busy } as never)[0]!.runs;
      const hits = runs.filter((r) => /△|to check|gate/.test(r.t));
      expect([phase, hits.length > 0]).toEqual([phase, true]);
      for (const h of hits) expect([phase, h.t, h.tone]).toEqual([phase, h.t, 'warn']);
    }
  });
});
