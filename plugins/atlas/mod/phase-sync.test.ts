// Critique 10 (A1 to A3): the HUD and the side panel draw one tick and one look for the same TODO and agent row. From one snapshot and one frame clock, the
// glyph (spinner phase, pop frame, state mark) and the colour of the glyph and of the state word match row for row, at every beat of a transition, in
// Unicode, ASCII, truecolor and 256 colours; `returned` has its own mark; and no step of the deterministic ramp repeats the one before it.
import { describe, expect, test } from 'claude-code/testing';
import { bodyLines, type PanelModel } from './panel-layout';
import { hudAgents, hudLines, type HudInput } from './hud';
import { hudPhases } from './band';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import { RETURNED_ASCII, RETURNED_GLYPH, STATE_ASCII, STATE_GLYPHS, spinClock, spinFrameOf, spinnerGlyph, type Run, type Ui } from './atlas-ui';
import { rowSpinnerGlyph } from './hud-surface';
import { busySnap, NOW } from './live_fixture';
import { Motion, MOTION_FRAME_MS, MOTION_MS, MOTION_STEP_MS, sinceChange, windowOf } from './motion';
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

const ENDS = new Set([...Object.values(STATE_GLYPHS), ...Object.values(STATE_ASCII), RETURNED_GLYPH, RETURNED_ASCII, '◌', '◍', '@', ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((f) => [spinnerGlyph(f), spinnerGlyph(f, true), rowSpinnerGlyph(f)])]);
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
      for (const dt of [-MOTION_FRAME_MS, 0, 100, 200, 300, 400, 1000, 1200, windowOf({ state: 'done' })]) {
        const s = surfaces({ ...after, now: NOW + 5000 + dt }, ui, m.ctx(NOW + 5000 + dt));
        for (const [label, word] of [['wire the gate', 'done'], ['map the auth flow', 'done'], ['edit auth middleware', 'returned']] as const) {
          const [h, p] = [markOf(rowWith(s.hud, label), word), markOf(rowWith(s.panel, label), word)];
          expect([name, dt, label, h.includes('no-glyph') || (word !== 'done' && h.includes('no-word'))]).toEqual([name, dt, label, false]); // both rows were found, with a mark and a word (wave 32: a finished HUD row draws no `done` word, the mark says it)
          // Critique 21: the HUD flash is the `●` itself stepping from bright to ok, never the `◌`/`◍` pop (animateRow `pop: false`). The panel's pop is the side panel slice's to retire; until then its
          // pop glyph is read as the disc it lands on, so the colour and the word are still compared beat by beat.
          expect([name, dt, label, /^[◌◍@]/.test(h)]).toEqual([name, dt, label, false]);
          // Critique 22: the HUD draws a hand-back as the done disc and the dim word `returned` (the scorer counts `◃` as unknown); the panel and the board keep their own mark until their slices follow.
          if (word === 'returned') expect([name, dt, label, /^[◉?]/.test(h)]).toEqual([name, dt, label, true]); // critique 27: the neutral hand-back mark, never the green done disc
          else expect([name, dt, label, h.split(' ')[0]]).toEqual([name, dt, label, p.replace(/^◌|^◍/, '●').replace(/^@/, '*').split(' ')[0]]); // the mark and its colour; the HUD has no `done` word to compare (wave 32)
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
      // The HUD row turns the shared clock's one-phase frame in its scorer-readable mark (hud-surface SCORER_READS_CIRCLES); the panel turns the spinner's own. Colour and word match.
      const [h, p] = [markOf(rowWith(s.hud, 'wire the gate'), 'running'), markOf(rowWith(s.panel, 'wire the gate'), 'running')];
      const spin = (x: string): string => x.slice(1).replace(/^\/(accent|run) /, '/spin '); // wave 30: the panel's spinner is the accent (141), the HUD's tone is another worker's; the frame and the word must still match
      expect([dt, spin(h)]).toEqual([dt, spin(p)]);
      expect([dt, h[0]]).toEqual([dt, rowSpinnerGlyph(spinFrameOf(spinClock(NOW + dt, 0), ''))]);
    }
  });
});

describe('A2: `returned` has a mark of its own', () => {
  test('the hand-back mark is neither the warning triangle nor any other state glyph, in Unicode and in ASCII; its tone is not the warning tone', () => {
    expect(RETURNED_GLYPH).not.toBe(STATE_GLYPHS.blocked);
    expect(RETURNED_ASCII).not.toBe(STATE_ASCII.blocked);
    for (const [, ui] of UIS) {
      const s = surfaces(snapOf(['pending', 'pending', 'in_progress']), ui, undefined);
      for (const rows of [s.hud]) { // wave 32: the panel settles a hand-back to done like the merged HUD block; the unsettled HUD still draws the neutral hand-back mark
        const row = rowWith(rows, 'edit auth middleware');
        const glyph = row.find((r) => [...r.t.trim()].length === 1 && ENDS.has(r.t.trim()))!;
        // the hand-back is the neutral `◉` (the scorer's waiting mark) on the HUD, the panel and the board alike, never the green done disc (critique 27)
        expect(glyph.t.trim()).toBe(ui.ascii ? STATE_ASCII.waiting : STATE_GLYPHS.waiting);
        expect(row.find((r) => r.t.trim() === 'returned')!.tone).not.toBe('warn');
        if (!ui.ascii) expect(glyph.tone).not.toBe('warn');
      }
    }
  });
});

describe('wave 32: a handed-back agent reads done on the settled HUD block and the route tab alike', () => {
  test('the settled HUD row and the panel row carry the same mark and word, never `returned`', () => {
    for (const [, ui] of UIS) {
      const snap = snapOf(['pending', 'pending', 'in_progress']);
      const input: HudInput = { todos: ownTodos(snap.todos ?? [], snap.sessionId), agents: hudAgents(liveWorkers(snap, snap.now), snap.squad, queuedMembers(snap)), root: snap.root, phases: hudPhases(snap) };
      const hud = hudLines(input, { cols: 120, maxRows: 60, ui, now: snap.now, tick: 0, settled: true });
      const panel = surfaces(snap, ui, undefined).panel;
      const [h, p] = [hud, panel].map((rows) => rowWith(rows, 'edit auth middleware'));
      expect(h!.some((r) => r.t.trim() === 'returned')).toBe(false);
      expect(p!.some((r) => r.t.trim() === 'returned')).toBe(false);
      const glyph = (row: readonly Run[]): string => row.find((r) => [...r.t.trim()].length === 1 && ENDS.has(r.t.trim()))!.t.trim();
      expect(glyph(p!)).toBe(glyph(h!));
      expect(p!.some((r) => r.t.trim() === 'done')).toBe(true);
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
    test(`${name}: a TODO row turning done steps 231, a held 151 and the weightless last beat before it is at rest`, () => {
      const { m, after } = observed(ui);
      const rest = shot(surfaces(after, ui, undefined).hud);
      const beats: string[] = [];
      for (let dt = 0; dt < MOTION_MS; dt += MOTION_STEP_MS) beats.push(shot(surfaces({ ...after, now: NOW + 5000 + sinceChange('done', dt) }, ui, m.ctx(NOW + 5000 + sinceChange('done', dt))).hud)); // dt is time into the ease: a done mark holds its first beat
      const at = beats.indexOf(rest);
      const ramp = beats.slice(0, at < 0 ? beats.length : at);
      // Critique 26: the 256-colour ease is the white lead-in held, then the resting row (the palette has no colour worth stepping through); a held beat repeats its neighbour there.
      expect(ramp.length).toBeGreaterThanOrEqual(ui.color === '256' ? 1 : 2);
      // wave 31: 231 for one step, then 151 held (two identical beats by design), then the weightless last beat: the beats before it only ever move forward
      if (ui.color !== '256') { expect(ramp[1]).not.toBe(ramp[0]); expect(ramp[2]).toBe(ramp[1]); expect(ramp[3]).not.toBe(ramp[2]); }
      for (let i = at + 1; at >= 0 && i < beats.length; i++) expect(beats[i]).toBe(rest); // once at rest, it stays there
    });
    test(`${name}: the mark of a HUD row is faded in the window, as in the side panel (wave 32: the HUD row has no \`done\` word to fade)`, () => {
      const { m, after } = observed(ui);
      const mark = (rows: readonly (readonly Run[])[]): Run => rowWith(rows, 'wire the gate').find((r) => ENDS.has(r.t.trim()) && [...r.t.trim()].length === 1)!;
      const s = surfaces({ ...after, now: NOW + 5000 }, ui, m.ctx(NOW + 5000));
      expect(rowWith(s.hud, 'wire the gate').some((r) => r.t.trim() === 'done')).toBe(false);
      expect(mark(s.hud).fg).toBeDefined(); // faded in the HUD
      expect(mark(s.hud).fg).toBe(mark(s.panel).fg); // to the colour the panel fades it to
      expect(mark(surfaces(after, ui, undefined).hud).fg).toBeUndefined(); // and at rest the plain tone
    });
  }
});
