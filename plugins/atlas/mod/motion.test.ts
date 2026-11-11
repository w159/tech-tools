// The motion model (mod/motion.ts) with an injected clock: frames at t=0, mid and end, the end equal to the resting render
// byte for byte, idle scheduling nothing, a new row revealing left to right, a done row popping its glyph, reduced motion.
import { describe, expect, test } from 'claude-code/testing';
import { cells, easeOutCubic, runsCells, runsString, sgrColor, type Run, type Ui } from './atlas-ui';
import { animateRow, keysOf, mixHex, Motion, MotionDriver, MOTION_MS, reducedMotion, REVEAL_MS, revealRuns, stepTrack, trackBusy, type MotionItem } from './motion';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const row = (state: 'running' | 'done' = 'done'): Run[] => [
  { t: '▸', tone: 'accent', bold: true }, { t: ' ', tone: 'text' }, { t: state === 'done' ? '●' : '◐', tone: state === 'done' ? 'ok' : 'run' }, { t: ' ', tone: 'text' },
  { t: 'wire the gate', tone: state === 'done' ? 'sub' : 'text', ...(state === 'done' ? { strike: true } : {}) }, { t: '          ', tone: 'text' }, { t: state, tone: 'muted' }, { t: '    ', tone: 'text' },
];
const items = (s: string): MotionItem[] => [{ key: 'todo:a', state: s }];
const paint = (runs: readonly Run[], u: Ui = ui): string => runs.map((r) => `${r.fg ?? r.tone}|${r.t}|${sgrColor(r.fg ?? '#000000', 38, u.color)}`).join('');

/** A Motion that saw `a` queued at t=0 (a first sight) and then running at t=1000. */
function changed(): Motion {
  const m = new Motion(true);
  m.observe('todo', items('queued'), 0);
  m.observe('todo', items('running'), 1000);
  return m;
}

describe('stepTrack', () => {
  test('a first sight is at rest: nothing animates', () => {
    const t = stepTrack(undefined, items('running'), 5000);
    expect(trackBusy(t, 5000)).toBe(false);
  });
  test('a state change opens a window of MOTION_MS; a new key opens a reveal too', () => {
    const t0 = stepTrack(undefined, items('queued'), 0);
    const t1 = stepTrack(t0, items('running'), 1000);
    expect(trackBusy(t1, 1000)).toBe(true);
    expect(trackBusy(t1, 1000 + MOTION_MS - 1)).toBe(true);
    expect(trackBusy(t1, 1000 + MOTION_MS)).toBe(false);
    const t2 = stepTrack(t1, [...items('running'), { key: 'todo:b', state: 'queued' }], 5000);
    expect(t2.get('todo:b')!.born).toBe(5000);
    expect(trackBusy(t2, 5000 + REVEAL_MS - 1)).toBe(true);
    expect(trackBusy(t2, 5000 + MOTION_MS)).toBe(false);
  });
  test('an unchanged observation returns the same track, a vanished key is dropped', () => {
    const t0 = stepTrack(undefined, items('queued'), 0);
    expect(stepTrack(t0, items('queued'), 99)).toBe(t0);
    expect(stepTrack(t0, [], 99).size).toBe(0);
  });
  test('keysOf numbers a repeated name', () => {
    expect(keysOf('todo', ['a', 'b', 'a'])).toEqual(['todo:a', 'todo:b', 'todo:a#2']);
  });
});

describe('animateRow', () => {
  test('frames at t=0, mid and end: the colour eases from a bright accent to the resting tones; the end is the resting render itself', () => {
    const m = changed();
    const resting = row('running');
    const f0 = animateRow(resting, 'todo:a', 'running', m.ctx(1000), ui);
    const mid = animateRow(resting, 'todo:a', 'running', m.ctx(1000 + MOTION_MS / 2), ui);
    const end = animateRow(resting, 'todo:a', 'running', m.ctx(1000 + MOTION_MS), ui);
    expect(runsString(f0)).toBe(runsString(resting));
    expect(f0.find((r) => r.t === 'wire the gate')!.fg).not.toBe(mid.find((r) => r.t === 'wire the gate')!.fg);
    expect(paint(f0)).not.toBe(paint(mid));
    expect(end).toBe(resting); // same reference: byte equal to a render without motion
    expect(JSON.stringify(end)).toBe(JSON.stringify(resting));
  });
  test('the colour passes through at least 5 distinct steps in truecolor', () => {
    const m = changed();
    const seen = new Set<string>();
    for (let dt = 0; dt < MOTION_MS; dt += 100) seen.add(animateRow(row('running'), 'todo:a', 'running', m.ctx(1000 + dt), ui).find((r) => r.t === 'wire the gate')!.fg!);
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
  test('the first frame leads from the state accent, brightened; the last frames land on the resting tone', () => {
    const m = changed();
    const r0 = animateRow(row('running'), 'todo:a', 'running', m.ctx(1000), ui).find((r) => r.t === 'wire the gate')!;
    const lead = mixHex('#89b4fa', '#ffffff', 0.35);
    expect(r0.fg).toBe(lead);
    const late = animateRow(row('running'), 'todo:a', 'running', m.ctx(1000 + MOTION_MS - 1), ui).find((r) => r.t === 'wire the gate')!;
    expect(late.fg).toBe(mixHex(lead, '#cdd6f4', easeOutCubic((MOTION_MS - 1) / MOTION_MS)));
  });
  test('256-colour keeps stepping through palette entries; no colour skips the ease', () => {
    const m = changed();
    const c256: Ui = { ...ui, color: '256' };
    const f = animateRow(row('running'), 'todo:a', 'running', m.ctx(1000 + 100), c256);
    expect(f.some((r) => r.fg !== undefined)).toBe(true);
    const none: Ui = { ...ui, color: 'none' };
    expect(animateRow(row('running'), 'todo:a', 'running', m.ctx(1000 + 100), none).some((r) => r.fg !== undefined)).toBe(false);
  });
  test('a row that turned done pops its glyph across the window: a light-shade cell, then the disc', () => {
    const m = new Motion(true);
    m.observe('todo', items('running'), 0);
    m.observe('todo', items('done'), 2000);
    const glyph = (dt: number): string => runsString(animateRow(row('done'), 'todo:a', 'done', m.ctx(2000 + dt), ui)).slice(2, 3);
    expect([glyph(0), glyph(MOTION_MS * 0.45), glyph(MOTION_MS * 0.8), glyph(MOTION_MS)]).toEqual(['◌', '◍', '●', '●']);
    const a: Ui = { ...ui, ascii: true };
    const ar: Run[] = [{ t: '*', tone: 'text' }, { t: ' x', tone: 'text' }];
    expect([0, 0.45, 0.8].map((f) => runsString(animateRow(ar, 'todo:a', 'done', m.ctx(2000 + f * MOTION_MS), a))[0])).toEqual(['@', '@', '*']);
  });
  test('a new row reveals left to right over REVEAL_MS and keeps its width', () => {
    const m = new Motion(true);
    m.observe('todo', [], 0);
    m.observe('todo', items('queued'), 3000);
    const resting = row('running');
    const w = runsCells(resting);
    const shown = (dt: number): number => runsString(animateRow(resting, 'todo:a', 'queued', m.ctx(3000 + dt), ui, { pop: false })).trimEnd().length;
    const widths = [0, 80, 160, 240, REVEAL_MS - 1].map(shown);
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]!);
    expect(new Set(widths).size).toBeGreaterThanOrEqual(3);
    expect(runsCells(animateRow(resting, 'todo:a', 'queued', m.ctx(3000 + 100), ui))).toBe(w);
    expect(shown(0)).toBe(0);
  });
  test('no ctx, no entry or a key that was never observed leaves the row alone', () => {
    const r = row();
    expect(animateRow(r, 'todo:a', 'done', undefined, ui)).toBe(r);
    expect(animateRow(r, 'todo:zzz', 'done', changed().ctx(1000), ui)).toBe(r);
  });
});

describe('revealRuns', () => {
  test('cuts at a cell count, blanking the rest in place; a wide glyph cut in half blanks', () => {
    const out = revealRuns([{ t: 'ab', tone: 'text' }, { t: '日本', tone: 'text' }], 3);
    expect(runsString(out)).toBe('ab    ');
    expect(cells(runsString(out))).toBe(cells('ab日本'));
  });
});

describe('Motion: idle is free, reduced motion draws the resting render', () => {
  test('idle: nothing animating before any change, after the window and with nothing observed', () => {
    const m = new Motion(true);
    expect(m.animating(0)).toBe(false);
    m.observe('todo', items('queued'), 0);
    expect(m.animating(10)).toBe(false);
    m.observe('todo', items('running'), 1000);
    expect(m.animating(1500)).toBe(true);
    expect(m.animating(1000 + MOTION_MS)).toBe(false);
  });
  test('an unchanged observation does not reopen a window', () => {
    const m = changed();
    m.observe('todo', items('running'), 1000 + MOTION_MS + 50);
    expect(m.animating(1000 + MOTION_MS + 51)).toBe(false);
  });
  test('disabled: no ctx, never animating, observe keeps nothing', () => {
    const m = new Motion(false);
    m.observe('todo', items('queued'), 0);
    m.observe('todo', items('running'), 1000);
    expect(m.ctx(1000)).toBeUndefined();
    expect(m.animating(1000)).toBe(false);
  });
  test('ATLAS_REDUCED_MOTION and NO_COLOR turn motion off', () => {
    expect(reducedMotion({})).toBe(false);
    expect(reducedMotion({ ATLAS_REDUCED_MOTION: '1' })).toBe(true);
    expect(reducedMotion({ ATLAS_REDUCED_MOTION: 'true' })).toBe(true);
    expect(reducedMotion({ ATLAS_REDUCED_MOTION: '0' })).toBe(false);
    expect(reducedMotion({ NO_COLOR: '1' })).toBe(true);
    expect(reducedMotion({ NO_COLOR: '' })).toBe(false);
  });
});

describe('MotionDriver: idle schedules nothing; a change runs one frame timer and ends on the resting render', () => {
  function rig(enabled = true) {
    const t = { now: 0, scheduled: 0, cancelled: 0, redraws: 0, fn: undefined as (() => void) | undefined };
    const d = new MotionDriver(
      new Motion(enabled),
      (_ms, fn) => { t.scheduled++; t.fn = fn; return { cancel: () => void (t.cancelled++, (t.fn = undefined)) }; },
      () => void t.redraws++,
      () => t.now,
    );
    return { t, d };
  }
  const feedOf = (state: string) => () => ({ todo: items(state) });
  const settle = () => (async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); })();

  test('idle: a first sight and unchanged snapshots schedule no timer and redraw nothing', async () => {
    const { t, d } = rig();
    const snap = {};
    await d.step(snap, feedOf('queued'));
    t.now = 5000;
    await d.step(snap, feedOf('queued'));
    await d.step({}, feedOf('queued')); // a new snapshot with the same states
    expect([t.scheduled, t.redraws, d.running]).toEqual([0, 0, false]);
  });
  test('a change arms one timer; frames redraw; the first frame past the window redraws once more and cancels', async () => {
    const { t, d } = rig();
    await d.step({}, feedOf('queued'));
    t.now = 1000;
    await d.step({}, feedOf('running'));
    await d.step({}, feedOf('running')); // another snapshot: still one timer
    expect([t.scheduled, d.running]).toEqual([1, true]);
    for (const dt of [100, 400, 800]) { t.now = 1000 + dt; t.fn?.(); await settle(); }
    expect([t.redraws, t.cancelled, d.running]).toEqual([3, 0, true]);
    t.now = 1000 + MOTION_MS;
    t.fn?.();
    await settle();
    expect([t.redraws, t.cancelled, d.running]).toEqual([4, 1, false]); // the resting render, then no timer
  });
  test('reduced motion: nothing is observed, scheduled or redrawn', async () => {
    const { t, d } = rig(false);
    await d.step({}, feedOf('queued'));
    t.now = 1000;
    await d.step({}, feedOf('running'));
    expect([t.scheduled, t.redraws]).toEqual([0, 0]);
  });
});
