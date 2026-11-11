// motion.ts: the one motion model of the ATLAS surfaces (design rev 4 section 6, round 2). Pure and host free: what a row did
// (changed state, appeared) is a function of a clock reading, and a frame is the resting Runs with an overlay.
//
//   state change  the row is drawn in the new state's accent, brightened, and eases back to its resting tones over MOTION_MS;
//                 a row that turned done pops its glyph (open diamond, filled diamond, disc) across the same window
//   new row       reveals left to right over REVEAL_MS
//   idle          nothing animates: no timer is needed, and past the window a row is the resting Runs themselves (same reference,
//                 so byte equal to a render without motion)
//   reduced       ATLAS_REDUCED_MOTION=1 or NO_COLOR draws the resting render only
//
// The surfaces call `animateRow(runs, key, accent, ctx, ui)` on rows they already built; the host calls `Motion.observe` from its
// tick (never from a render) and writes redraw state only while `Motion.animating` says so. No Date.now() here: callers pass the clock.
import { cells, contrast, easeOutCubic, fitHex, hostEnv, luminance, markToken, PALETTES, stable256, stateGlyph, surfaceHex, type MarkState, type Run, type Ui, type UiEnv } from './atlas-ui';

/** A frame every 100 ms, the spinner's rate: the motion timer's period and the length of one beat of a transition. */
export const MOTION_FRAME_MS = 100;
/** The beats a transition draws. Every beat is a frame of its own: a 256-colour run steps one palette colour per beat (at most
 * MAX_STEPS_256) and is at rest after its last, the glyph pops one frame per beat, and a 24-bit ease gets five distinct colours. No two
 * neighbouring frames of a ramp are alike (critique 10: a 900 ms window held 231 for five frames and 193 for four). */
const MAX_BEATS = 5;
/** A state change eases back to rest over this long (MAX_BEATS frames). */
export const MOTION_MS = MAX_BEATS * MOTION_FRAME_MS;
/** A new row reveals left to right over this long. */
export const REVEAL_MS = 300;
/** How far toward white the lead-in starts from the accent. */
const LEAD_WHITE = 0.35;

export type Entry = { state: string; changed: number; born: number };
export type MotionItem = { key: string; state: string };
/** What a row builder needs: the clock reading and the entry of a key. */
export type MotionCtx = { now: number; entry(key: string): Entry | undefined };

/** ATLAS_REDUCED_MOTION=1|true|yes|on, or NO_COLOR set and non-empty. */
export function reducedMotion(env: UiEnv = hostEnv()): boolean {
  if (env.NO_COLOR) return true;
  return /^(1|true|yes|on)$/i.test((env.ATLAS_REDUCED_MOTION ?? '').trim());
}

/** Keys for `names` on a surface, in order; a repeated name gets `#2`, `#3`, so two rows with one label stay two entries. */
export function keysOf(surface: string, names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = `${surface}:${n}`;
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? k : `${k}#${c}`;
  });
}

// ---- the tracker (pure steps over a Map) ------------------------------------------------------------------

export type Track = ReadonlyMap<string, Entry>;

/** The track after seeing `items` at `now`. `prev` undefined is a first sight: every row is simply there (at rest). A key not seen before
 * is born now; a key whose state moved is changed now; a key that is gone is dropped. An unchanged track returns `prev` itself. */
export function stepTrack(prev: Track | undefined, items: readonly MotionItem[], now: number): Track {
  const rest = now - MOTION_MS;
  const next = new Map<string, Entry>();
  let same = prev !== undefined && prev.size === items.length;
  for (const it of items) {
    const old = prev?.get(it.key);
    const e: Entry = !prev ? { state: it.state, changed: rest, born: rest } : !old ? { state: it.state, changed: now, born: now } : old.state === it.state ? old : { state: it.state, changed: now, born: old.born };
    if (e !== old) same = false;
    next.set(it.key, e);
  }
  return same && prev ? prev : next;
}

/** Whether any entry of `track` is still inside its window at `now`. */
export const trackBusy = (track: Track | undefined, now: number): boolean => {
  if (!track) return false;
  for (const e of track.values()) if (now < e.changed + MOTION_MS || now < e.born + REVEAL_MS) return true;
  return false;
};

/** The stateful holder a host keeps: one Track per surface. Observation is the host tick's job; a render only reads `ctx`. */
export class Motion {
  private tracks = new Map<string, Track>();
  constructor(readonly enabled: boolean = !reducedMotion()) {}

  observe(surface: string, items: readonly MotionItem[], now: number): void {
    if (!this.enabled) return;
    const prev = this.tracks.get(surface);
    const next = stepTrack(prev, items, now);
    if (next !== prev) this.tracks.set(surface, next);
  }

  private stamped = 0;
  /** The frame clock: the reading the driver took at its last tick. Every surface draws a frame from this one number (`ctx()` with no
   * argument), so the HUD and the side panel are never a render apart: the same row is on the same beat of its transition in both. */
  stamp(now: number): void {
    this.stamped = now;
  }
  get frameAt(): number {
    return this.stamped;
  }

  /** The view a builder reads at `now` (default: the frame clock); undefined when motion is off, so builders return the resting render untouched. */
  ctx(now: number = this.stamped): MotionCtx | undefined {
    if (!this.enabled) return undefined;
    return { now, entry: (key) => { for (const t of this.tracks.values()) { const e = t.get(key); if (e) return e; } return undefined; } };
  }

  /** True while any row is in a window: the host keeps its redraw tick going. False when idle: it writes nothing. */
  animating(now: number): boolean {
    if (!this.enabled) return false;
    for (const t of this.tracks.values()) if (trackBusy(t, now)) return true;
    return false;
  }

  reset(): void {
    this.tracks = new Map();
  }
}

// ---- colour and frames -------------------------------------------------------------------------------------

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
/** `a` toward `b` by `t` (0..1), as #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * Math.min(1, Math.max(0, t))).toString(16).padStart(2, '0')).join('')}`;
}

/** Progress of the colour ease (0 at the change, 1 at rest) and of the reveal. */
export const easeProgress = (e: Entry, now: number): number => Math.min(1, Math.max(0, (now - e.changed) / MOTION_MS));
export const revealProgress = (e: Entry, now: number): number => Math.min(1, Math.max(0, (now - e.born) / REVEAL_MS));

/** The glyph pop: a dotted ring, then a half-filled one, across the first two thirds of the window, then the state's own disc lands. No
 * frame is drawn anywhere else in Atlas or the host: not a state mark, a spinner frame, a bar track (`░`), the focus mark, the capsule,
 * a role eye or the middle dot (the host's separator), so it never reads as another state, a gauge or a separator
 * (mod/glyph-unique.test.ts lists every table). ASCII: `@` (not a state mark, spinner frame, gauge character or box corner). */
export const POP_UNICODE = ['◌', '◍'] as const;
export const POP_ASCII = ['@', '@'] as const;

/** Whole steps of the 256-colour ease. A 24-bit ease is smooth; in 256 colours the palette is coarse, so the ease is a staircase of
 * palette colours that both Atlas's and the host's downsampler map to the same index, at least this many before the resting tone. */
export const MIN_STEPS_256 = 2;
/** At most this many steps: more only crowd the 900 ms window with neighbours the eye cannot tell apart. */
export const MAX_STEPS_256 = 3;
/** Least CIE76 distance between two neighbours of the staircase (and from the last step to the resting tone). Palette neighbours such
 * as 194, 193, 187 are under 6 apart and read as one colour on the panel; 157, 114, 151 are well over this. */
export const MIN_STEP_DE = 20;

const lab = (hex: string): [number, number, number] => {
  const lin = rgb(hex).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  const [x, y, z] = [
    (0.4124564 * lin[0] + 0.3575761 * lin[1] + 0.1804375 * lin[2]) / 0.95047,
    0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2],
    (0.0193339 * lin[0] + 0.119192 * lin[1] + 0.9503041 * lin[2]) / 1.08883,
  ];
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
/** CIE76 distance between two #rrggbb colours: about 2.3 is a just-noticeable difference, 12 is plainly different. */
export const deltaE = (a: string, b: string): number => { const [p, q] = [lab(a), lab(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

/** Two neighbours tell apart on the panel when they are MIN_STEP_DE apart AND either plainly different in colour (STRONG_STEP_DE: white to
 * light green) or at least MIN_STEP_DL apart in CIE L* lightness. A pastel pair of one lightness and a small hue shift (194 to 193, 193 to 187
 * on panel 234) fails both, whatever its CIE76 distance. */
export const STRONG_STEP_DE = 30;
export const MIN_STEP_DL = 12;
const visible = (a: string, b: string): boolean => { const de = deltaE(a, b); return de >= MIN_STEP_DE && (de >= STRONG_STEP_DE || Math.abs(lab(a)[0] - lab(b)[0]) >= MIN_STEP_DL); };

/** `chain` thinned to steps that are MIN_STEP_DE apart from each other, from `target` and (the first one) from `from`, the tone the row
 * wore before the change, so the first frame already differs visibly; at most MAX_STEPS_256 of them (spread evenly). */
function spaced(chain: readonly string[], target: string, from: string): string[] {
  const out: string[] = [];
  for (const c of chain) if (out.length ? visible(out.at(-1)!, c) : deltaE(from, c) >= MIN_STEP_DE) out.push(c);
  while (out.length && deltaE(out.at(-1)!, target) < MIN_STEP_DE) out.pop();
  if (out.length <= MAX_STEPS_256) return out;
  return [0, 1, 2].map((i) => out[Math.round((i * (out.length - 1)) / 2)]!);
}
const LEAD_TRIES = [LEAD_WHITE, 0.6, 0.85, 0, 0.15] as const;
const stepsCache = new Map<string, readonly string[]>();

/**
 * The staircase from `accent` (brightened toward the theme's emphasis colour) to the resting `rest` colour, as stable xterm-256 colours:
 * distinct, lightness monotone toward `rest`, never past it, each keeping `rest`'s contrast on the panel. Empty when the palette cannot
 * give MIN_STEPS_256 such steps for this pair (the row then keeps its resting tone and only the glyph pops).
 */
export function easeSteps256(accent: string, rest: string, theme: Ui['theme']): readonly string[] {
  const key = `${theme}|${accent}|${rest}`;
  const hit = stepsCache.get(key);
  if (hit) return hit;
  const bg = surfaceHex('panel', { theme, color: '256' });
  const need = Math.min(4.5, contrast(rest, PALETTES[theme].panel));
  const target = fitHex(rest, theme);
  const before = fitHex(PALETTES[theme].text, theme); // a row changes state from its body tone
  const toward = theme === 'latte' ? PALETTES.latte.ink : '#ffffff';
  const dir = (a: string, b: string): number => Math.sign(luminance(b) - luminance(a));
  let best: string[] = [];
  for (const w of LEAD_TRIES) {
    const lead = mixHex(accent, toward, w);
    const d = dir(lead, target) || 1;
    const out: string[] = [];
    for (let k = 0; k < 24; k++) {
      const c = stable256(mixHex(lead, rest, k / 24), bg, need);
      if (c === target) break;
      const prev = out.at(-1);
      if (c === prev || (prev && dir(prev, c) !== d) || dir(c, target) !== d) continue;
      out.push(c);
    }
    const apart = spaced(out, target, before);
    if (apart.length > best.length) best = apart;
    if (best.length >= MIN_STEPS_256) break;
  }
  const steps = best.length >= MIN_STEPS_256 ? best : [];
  stepsCache.set(key, steps);
  return steps;
}

const blankWidth = (r: Run): Run => ({ t: ' '.repeat(cells(r.t)), tone: 'text' });
/** `runs` cut to `n` cells from the left, the rest blanked in place (the row keeps its width). A wide glyph cut in half blanks. */
export function revealRuns(runs: readonly Run[], n: number): Run[] {
  let used = 0;
  return runs.map((r) => {
    const w = cells(r.t);
    if (used + w <= n) { used += w; return r; }
    if (used >= n) { used += w; return blankWidth(r); }
    let out = '';
    let width = 0;
    for (const c of [...r.t]) {
      const cw = cells(c);
      if (used + width + cw <= n) { out += c; width += cw; } else break;
    }
    used += w;
    return { ...r, t: out + ' '.repeat(w - width), ...(r.chip ? { chip: false } : {}) };
  });
}

const lastInk = (runs: readonly Run[]): number => {
  let w = 0;
  let ink = 0;
  for (const r of runs) {
    for (const c of [...r.t]) { w += cells(c); if (c !== ' ') ink = w; }
  }
  return ink;
};

export type AnimateOpts = {
  /** Draw the left-to-right reveal of a new row (default true). */
  reveal?: boolean;
  /** Pop the glyph of a row that turned done (default true). */
  pop?: boolean;
  /** Which runs take the tint (default: every run with text and no fill). */
  tint?: (run: Run, index: number) => boolean;
};

/**
 * `runs` as drawn `ctx.now` ms into the row's window. `key` names the row's entry, `accent` is the state whose tone leads.
 * Returns `runs` itself (same reference) with no ctx, no entry, no colour, or past both windows: the resting render.
 */
export function animateRow(runs: Run[], key: string, accent: MarkState, ctx: MotionCtx | undefined, ui: Ui, o: AnimateOpts = {}): Run[] {
  if (!ctx) return runs;
  const e = ctx.entry(key);
  if (!e) return runs;
  const pc = easeProgress(e, ctx.now);
  const pr = o.reveal === false ? 1 : revealProgress(e, ctx.now);
  if (pc >= 1 && pr >= 1) return runs;
  let out = runs;
  if (pc < 1) {
    const beat = Math.max(0, Math.floor((ctx.now - e.changed) / MOTION_FRAME_MS)); // one beat per frame: the staircase and the pop both step on it
    if (ui.color !== 'none') {
      const palette = PALETTES[ui.theme];
      const lead = mixHex(palette[markToken(accent)], '#ffffff', LEAD_WHITE);
      const t = easeOutCubic(pc);
      const wants = o.tint ?? ((r: Run) => r.bg === undefined && r.t.trim() !== '');
      out = out.map((r, i) => {
        if (!wants(r, i)) return r;
        const rest = r.fg ?? (r.tone === 'dim' ? (ui.theme === 'latte' ? palette.muted : '#585b70') : palette[r.tone]);
        if (ui.color === '256') {
          const stairs = easeSteps256(palette[markToken(accent)], rest, ui.theme);
          return beat < stairs.length ? { ...r, fg: stairs[beat]! } : r; // past its last step a run is at rest
        }
        return { ...r, fg: mixHex(lead, rest, t) };
      });
    }
    if (o.pop !== false && accent === 'done' && e.state === 'done') {
      const disc = stateGlyph('done', ui);
      const step = Math.min(2, beat);
      const at = step < 2 ? out.findIndex((r) => r.t.trim() === disc) : -1;
      if (at >= 0) {
        const g = (ui.ascii ? POP_ASCII : POP_UNICODE)[step]!;
        out = out.map((r, i) => (i === at ? { ...r, t: r.t.replace(disc, g) } : r));
      }
    }
  }
  if (pr < 1) out = revealRuns(out, Math.ceil(pr * lastInk(out)));
  return out;
}

/** The count runs of a band cell need no reveal and no pop: tint only the run of one state's count. */
export const BAND_OPTS: AnimateOpts = { reveal: false, pop: false };

// ---- the driver (host side, kept apart from the host so it can be tested with a fake scheduler) -----------------------------------------

export type Cancel = { cancel(): void };

/**
 * Feeds a Motion and runs its frame timer. `step` is called from a tick (never a render): when `source` (the snapshot) is not the one
 * last seen it observes the feed; while any window is open it holds one frame timer whose callback redraws; the first frame that finds
 * every window closed redraws once more (the resting render) and cancels the timer. Idle: no observation work beyond one comparison,
 * no timer, no redraw.
 */
export class MotionDriver {
  private seen: unknown = undefined;
  private timer: Cancel | null = null;
  constructor(
    readonly motion: Motion,
    private readonly every: (ms: number, fn: () => void) => Cancel,
    private readonly redraw: () => Promise<void> | void,
    private readonly clock: () => Promise<number> | number,
  ) {}

  async step(source: unknown, feed: () => Promise<Record<string, readonly MotionItem[]>> | Record<string, readonly MotionItem[]>): Promise<void> {
    if (!this.motion.enabled) return;
    const now = await this.clock();
    this.motion.stamp(now);
    if (source !== this.seen) {
      this.seen = source;
      for (const [surface, items] of Object.entries(await feed())) this.motion.observe(surface, items, now);
    }
    if (!this.motion.animating(now) || this.timer) return;
    this.timer = this.every(MOTION_FRAME_MS, () => void this.frame().catch(() => undefined));
  }

  /** Whether the frame timer is armed. */
  get running(): boolean {
    return this.timer !== null;
  }

  stop(): void {
    this.timer?.cancel();
    this.timer = null;
  }

  private async frame(): Promise<void> {
    const now = await this.clock();
    const busy = this.motion.animating(now);
    this.motion.stamp(now); // before the redraw: every surface the redraw touches reads this one reading
    await this.redraw();
    if (!busy) this.stop();
  }
}
