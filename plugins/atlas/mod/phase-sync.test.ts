// Critique 10 (A1 to A3): the HUD and the side panel draw one tick and one look for the same TODO and agent row. From one snapshot and one frame clock, the
// glyph (spinner phase, pop frame, state mark) and the colour of the glyph and of the state word match row for row, at every beat of a transition, in
// Unicode, ASCII, truecolor and 256 colours; `returned` has its own mark; and no step of the deterministic ramp repeats the one before it.
import { describe, expect, test } from 'claude-code/testing';
import { bodyLines, type PanelModel } from './panel-layout';
import { hudAgents, hudLines, type HudInput } from './hud';
import { hudPhases } from './band';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import { RETURNED_ASCII, RETURNED_GLYPH, STATE_ASCII, STATE_GLYPHS, spinnerGlyph, type Run, type Ui } from './atlas-ui';
import { busySnap, NOW } from './live_fixture';
import { Motion, MOTION_FRAME_MS, MOTION_MS, MOTION_STEP_MS } from './motion';
import { motionFeed } from './motion-feed';
import { panelModelOf } from './pane/sidebar-model';
import type { TodoItem } from './contract';
import type { LiveSnapshot } from './orchestra-types';

const todo = (id: string, content: string, status: string, owner?: string): TodoItem => ({ id, content, status, session_id: 's', origin: 'session', ...(owner ? { owner } : {}) }) as TodoItem;
/** Three plan rows: one with no owner, one owned by a running agent, one owned by an agent that ended (`returned`). */
const snapOf = (statuses: readonly [string, string, string]): LiveSnapshot =>
  busySnap({
    todos: [todo('T1', 'wire the gate', statuses[0]), todo('T2', 'map the auth flow', statuses[1], 'explorer-1'), todo('T3', 'edit auth middleware', statuses[2], 'impl-auth')],
    squad: busySnap().squad.map((a) => (a.name === 'impl-auth' ? { ...a, state: 'finished' as const } : a)),
    activity: { ...busySnap().activity, 'impl-auth': { ...busySnap().activity['impl-auth']!, mood: 'done' as const } },
  });

const ENDS = new Set([...Object.values(STATE_GLYPHS), ...Object.values(STATE_ASCII), RETURNED_GLYPH, RETURNED_ASCII, '◌', '◍', '@', ...[0, 1, 2, 3].flatMap((f) => [spinnerGlyph(f), spinnerGlyph(f, true)])]);
const paint = (r: Run): string => `${r.fg ?? r.tone}`;
/** What a row draws as its mark and its state word: the glyph character and colour, the word and its colour. */
function markOf(runs: readonly Run[], word: string): string {
  const g = runs.find((r) => r.t.trim() !== '' && [...r.t.trim()].length === 1 && ENDS.has(r.t.trim()));
  const w = runs.find((r) => r.t.trim() === word);
  return `${g ? `${g.t.trim()}/${paint(g)}` : 'no-glyph'} ${w ? `${w.t.trim()}/${paint(w)}` : 'no-word'}`;
}

function surfaces(snap: LiveSnapshot, ui: Ui, motion: ReturnType<Motion['ctx']>) {
  const input: HudInput = { todos: ownTodos(snap.todos ?? [], snap.sessionId), agents: hudAgents(liveWorkers(snap, snap.now), snap.squad, queuedMembers(snap)), root: snap.root, phases: hudPhases(snap) };
  const hud = hudLines(input, { cols: 120, maxRows: 60, ui, now: snap.now, tick: 0, motion });
  const model: PanelModel = panelModelOf({ snapshot: snap, gates: [], core: null, ui: { recipient: null, expanded: null, draft: '', view: 'route' }, look: ui, columns: 121, rows: 40, tick: 0, ...(motion ? { motion } : {}) }, ui);
  return { hud, panel: bodyLines(model).map((l) => l.runs) };
}
const rowWith = (rows: readonly (readonly Run[])[], text: string): readonly Run[] => rows.find((r) => r.some((x) => x.t.includes(text))) ?? [];

const UIS: readonly [string, Ui][] = [
  ['truecolor', { theme: 'mocha', ascii: false, color: 'truecolor' }],
  ['256 colours', { theme: 'mocha', ascii: false, color: '256' }],
  ['ascii', { theme: 'mocha', ascii: true, color: 'none' }],
];

describe('A1: the HUD and the route tab draw the same mark and colour for the same row in the same frame', () => {
  for (const [name, ui] of UIS) {
    test(`${name}: every TODO row, at every beat of the transition and at rest`, () => {
      const before = snapOf(['pending', 'in_progress', 'in_progress']);
      const after = snapOf(['completed', 'completed', 'in_progress']);
      const m = new Motion(true);
      for (const [k, v] of Object.entries(motionFeed(before, [], null, ui))) m.observe(k, v, NOW);
      for (const [k, v] of Object.entries(motionFeed(after, [], null, ui))) m.observe(k, v, NOW + 5000);
      const seen = new Set<string>();
      for (const dt of [-MOTION_FRAME_MS, 0, 100, 200, 300, 400, MOTION_MS]) {
        const s = surfaces({ ...after, now: NOW + 5000 + dt }, ui, m.ctx(NOW + 5000 + dt));
        for (const [label, word] of [['wire the gate', 'done'], ['map the auth flow', 'done'], ['edit auth middleware', 'returned']] as const) {
          const [h, p] = [markOf(rowWith(s.hud, label), word), markOf(rowWith(s.panel, label), word)];
          expect([name, dt, label, h.includes('no-')]).toEqual([name, dt, label, false]); // both rows were found, with a mark and a word
          expect([name, dt, label, h]).toEqual([name, dt, label, p]);
          seen.add(h);
        }
      }
      if (ui.color !== 'none') expect(seen.size).toBeGreaterThan(3); // the frames really move: marks and colours differ from beat to beat
    });
  }
  test('a running row with no owner turns the same spinner frame in both (the item id, not the label, is its phase)', () => {
    const ui = UIS[0]![1];
    for (const dt of [0, 100, 200, 300]) {
      const s = surfaces({ ...snapOf(['in_progress', 'pending', 'in_progress']), now: NOW + dt }, ui, undefined);
      expect([dt, markOf(rowWith(s.hud, 'wire the gate'), 'running')]).toEqual([dt, markOf(rowWith(s.panel, 'wire the gate'), 'running')]);
    }
  });
});

describe('A2: `returned` has a mark of its own', () => {
  test('the hand-back mark is neither the warning triangle nor any other state glyph, in Unicode and in ASCII; its tone is not the warning tone', () => {
    expect(RETURNED_GLYPH).not.toBe(STATE_GLYPHS.blocked);
    expect(RETURNED_ASCII).not.toBe(STATE_ASCII.blocked);
    for (const [, ui] of UIS) {
      const s = surfaces(snapOf(['pending', 'pending', 'in_progress']), ui, undefined);
      for (const rows of [s.hud, s.panel]) {
        const row = rowWith(rows, 'edit auth middleware');
        const glyph = row.find((r) => [...r.t.trim()].length === 1 && ENDS.has(r.t.trim()))!;
        expect(glyph.t.trim()).toBe(ui.ascii ? RETURNED_ASCII : RETURNED_GLYPH);
        expect(row.find((r) => r.t.trim() === 'returned')!.tone).not.toBe('warn');
        if (!ui.ascii) expect(glyph.tone).not.toBe('warn');
      }
    }
  });
});

describe('A3: the deterministic ramp has no duplicate frames, and the HUD state word fades with its glyph', () => {
  /** The colour, weight and text of the row that changed (other rows keep turning their spinners); critique 18: the last beat changes the weight only, so it counts. */
  const shot = (rows: readonly (readonly Run[])[]): string => rowWith(rows, 'wire the gate').map((x) => `${x.fg ?? x.tone}|${x.bold ? 'b' : ''}|${x.t}`).join('');
  const observed = (ui: Ui): { m: Motion; after: LiveSnapshot } => {
    const m = new Motion(true);
    for (const [k, v] of Object.entries(motionFeed(snapOf(['in_progress', 'pending', 'pending']), [], null, ui))) m.observe(k, v, NOW);
    const after = snapOf(['completed', 'pending', 'pending']);
    for (const [k, v] of Object.entries(motionFeed(after, [], null, ui))) m.observe(k, v, NOW + 5000);
    return { m, after };
  };
  for (const [name, ui] of UIS.filter(([, u]) => u.color !== 'none')) {
    test(`${name}: every beat of a TODO row turning done differs from the one before, until it is at rest`, () => {
      const { m, after } = observed(ui);
      const rest = shot(surfaces(after, ui, undefined).hud);
      const beats: string[] = [];
      for (let dt = 0; dt < MOTION_MS; dt += MOTION_STEP_MS) beats.push(shot(surfaces({ ...after, now: NOW + 5000 + dt }, ui, m.ctx(NOW + 5000 + dt)).hud));
      const at = beats.indexOf(rest);
      const ramp = beats.slice(0, at < 0 ? beats.length : at);
      expect(ramp.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < ramp.length; i++) expect([name, i, ramp[i] === ramp[i - 1]]).toEqual([name, i, false]);
      for (let i = at + 1; at >= 0 && i < beats.length; i++) expect(beats[i]).toBe(rest); // once at rest, it stays there
    });
    test(`${name}: the state word of a HUD row is faded in the window, as in the side panel`, () => {
      const { m, after } = observed(ui);
      const word = (rows: readonly (readonly Run[])[]): Run => rowWith(rows, 'wire the gate').find((r) => r.t.trim() === 'done')!;
      const s = surfaces({ ...after, now: NOW + 5000 }, ui, m.ctx(NOW + 5000));
      expect(word(s.hud).fg).toBeDefined(); // faded in the HUD
      expect(word(s.hud).fg).toBe(word(s.panel).fg); // to the colour the panel fades it to
      expect(word(surfaces(after, ui, undefined).hud).fg).toBeUndefined(); // and at rest the plain tone
    });
  }
});
