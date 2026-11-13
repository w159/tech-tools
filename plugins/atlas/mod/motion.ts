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
import { cells, contrast, drawnHex, easeOutCubic, fitHex, hostEnv, LEAD_FRAMES, luminance, markToken, PALETTES, RETURNED, SPINNER_MS, stable256, stateGlyph, surfaceHex, xtermHex, UI_STATES, type MarkState, type Run, type Ui, type UiEnv } from './atlas-ui';

/** The ONE spinner tick (wave 37): the braille frame index (0..9, an index into the lead spinner's ten frames) at the clock reading `now` (ms). Every braille spinner (band lead, HUD rows, SUBAGENTS header and rows) reads this one clock, and the
 * HUD's circles `◐◓◑◒` step on the same beat (`sharedSpinFrame(now) % 4` would restart at the wrap, so they count the same beats unwrapped: `Math.floor(now / SPINNER_MS)`). */
export const sharedSpinFrame = (now: number): number => ((Math.floor(now / SPINNER_MS) % LEAD_FRAMES.length) + LEAD_FRAMES.length) % LEAD_FRAMES.length;

/** State 38: the spinner frame and the clock seconds the band just drew, so a second surface (the host's own status row, the run card) can print the same pair on the same render. The band render notes them; a reader gets
 * the last pair, or null before the band was ever drawn. `secs` is null where the band drew no clock. Plain module state: no `$`, no timer. */
let bandNote: { frame: number; secs: number | null } | null = null;
export function noteBandFrame(frame: number, secs: number | null): void { bandNote = { frame, secs: secs !== null && Number.isFinite(secs) ? Math.max(0, Math.floor(secs)) : null }; }
export function bandFrame(): { frame: number; secs: number | null } | null { return bandNote === null ? null : { ...bandNote }; }
export const forgetBandFrame = (): void => { bandNote = null; };

/** A frame every 100 ms, the spinner's rate: the motion timer's period and the length of one beat of a transition. */
export const MOTION_FRAME_MS = 100;
/** The beats a transition draws. Every beat is a held step of its own: a 256-colour run steps one palette colour per beat (at most
 * MAX_STEPS_256) and is at rest after its last, the glyph pops one frame per beat, and a 24-bit ease gets five distinct colours. No two
 * neighbouring frames of a ramp are alike (critique 10: a 900 ms window held 231 for five frames and 193 for four). */
const MAX_BEATS = 4;
/** How long one beat is held (critique 11: a 200 ms ramp against a 0.5 s capture period showed on 15 of 51 live frames). Each of the
 * MAX_BEATS steps of the staircase and of the glyph pop stays on screen this long, so a capture or an eye sees every step. */
export const MOTION_STEP_MS = 200;
/** A state change eases back to rest over this long: MAX_BEATS held steps, 800 ms. The frame sampled at 600 ms is still a beat of the ramp, so it differs from
 * the resting row (critique 14: with a 600 ms window the 600 ms frame equalled the final frame). */
export const MOTION_MS = MAX_BEATS * MOTION_STEP_MS;
/** The done mark holds its white first step this long (wave 31, critique 29: 231 for 200 ms, then 151 held to 800 ms, then the resting 114; the 600 ms hold of 151 is what a 0.5 s capture sees).
 * At most one redraw per MOTION_FRAME_MS (10 a second) is spent on it. */
export const DONE_HOLD_MS = MOTION_STEP_MS;
/** How long an entry's window lasts: the ease, and for a done mark the hold in front of it. */
export const windowOf = (e: { state: string }): number => (e.state === 'done' ? MOTION_MS + DONE_HOLD_MS - MOTION_STEP_MS : MOTION_MS);
/** The real time since the change at which `ease` ms of the ease have passed: the inverse of easedMs, so a sampler can step the beats of a done mark (the hold sits in front of beat 1). */
export const sinceChange = (state: string, ease: number): number => (state === 'done' && ease >= MOTION_STEP_MS ? ease + DONE_HOLD_MS - MOTION_STEP_MS : ease);
/** Time into the ease: 0 for the whole hold of a done mark (its first beat is held DONE_HOLD_MS, the later beats MOTION_STEP_MS each), real time since the change otherwise. */
export const easedMs = (e: { state: string; changed: number }, now: number): number => {
  const d = Math.max(0, now - e.changed);
  return e.state === 'done' ? (d < DONE_HOLD_MS ? 0 : d - (DONE_HOLD_MS - MOTION_STEP_MS)) : d;
};
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
  const rest = now - (MOTION_MS + DONE_HOLD_MS);
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
  for (const e of track.values()) if (now < e.changed + windowOf(e) || now < e.born + REVEAL_MS) return true;
  return false;
};

/** The key of one agent's row on the HUD (`agent:<name>`, hud.ts) and on the side panel (`worker:<name>`, panel-layout.ts). */
const AGENT_KEY = /^(agent|worker):(.+)$/;
/** The entry a row is drawn from. An agent is one row on two surfaces, so both read ONE phase of its change: when the twin row has the same state, the earlier `changed`
 * and `born` of the two win (critique 19 B3: beta `◍`/193 in the panel and `◌`/231 in the HUD in one frame, the two surfaces having seen `done` on different ticks). */
export function sharedPhase(key: string, find: (key: string) => Entry | undefined): Entry | undefined {
  const e = find(key);
  const m = AGENT_KEY.exec(key);
  if (!e || !m) return e;
  const twin = find(`${m[1] === 'agent' ? 'worker' : 'agent'}:${m[2]!}`);
  if (!twin || twin.state !== e.state || (twin.changed >= e.changed && twin.born >= e.born)) return e;
  return { state: e.state, changed: Math.min(e.changed, twin.changed), born: Math.min(e.born, twin.born) };
}

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
  private shown = 0;
  /** The driver's last reading of the clock. */
  stamp(now: number): void {
    this.stamped = now;
  }
  /** Publish the stamped reading as the frame the surfaces draw. Done in step with the redraw it asks for (a frame, or a changed snapshot), never between: the
   * HUD and the side panel render at different instants of one redraw, and a stamp that landed between the two put the panel a beat ahead (critique 17 C4:
   * T3 `◍`/193 in the panel, `◌`/231 in the HUD, one frame). */
  commit(): void {
    this.shown = this.stamped;
  }
  /** The frame clock: the reading published at the last commit. Every surface draws a frame from this one number (`ctx()` with no
   * argument), so the HUD and the side panel are never a render apart: the same row is on the same beat of its transition in both. */
  get frameAt(): number {
    return this.shown;
  }

  /** The view a builder reads at `now` (default: the frame clock); undefined when motion is off, so builders return the resting render untouched. */
  ctx(now: number = this.shown): MotionCtx | undefined {
    if (!this.enabled) return undefined;
    const find = (key: string): Entry | undefined => { for (const t of this.tracks.values()) { const e = t.get(key); if (e) return e; } return undefined; };
    return { now, entry: (key) => sharedPhase(key, find) };
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
export const easeProgress = (e: Entry, now: number): number => Math.min(1, Math.max(0, easedMs(e, now) / MOTION_MS));
export const revealProgress = (e: Entry, now: number): number => Math.min(1, Math.max(0, (now - e.born) / REVEAL_MS));

/** The glyph pop: a dotted ring, then a half-filled one, across the first two thirds of the window, then the state's own disc lands. No
 * frame is drawn anywhere else in Atlas or the host: not a state mark, a spinner frame, a bar track (`░`), the focus mark, the capsule,
 * a role eye or the middle dot (the host's separator), so it never reads as another state, a gauge or a separator
 * (mod/glyph-unique.test.ts lists every table). ASCII: `@` (not a state mark, spinner frame, gauge character or box corner). */
export const POP_UNICODE = ['◌', '◍'] as const;
export const POP_ASCII = ['@', '@'] as const;

/** Steps of the 256-colour ease before the resting tone: one, white (231). A 24-bit ease is smooth; the 256-colour palette has no neighbours worth stepping through (critique 26: 194,
 * 151, 147, 211 on screen), so the ease is white, then rest. */
export const MIN_STEPS_256 = 1;
/** At most this many steps before the resting tone. */
export const MAX_STEPS_256 = 1;
/** Least CIE76 distance between the white lead-in and the resting tone for the fade to be drawn. */
export const MIN_STEP_DE = 14;

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
export const STRONG_STEP_DE = 22;
export const MIN_STEP_DL = 8;
const visible = (a: string, b: string): boolean => { const de = deltaE(a, b); return de >= MIN_STEP_DE && (de >= STRONG_STEP_DE || Math.abs(lab(a)[0] - lab(b)[0]) >= MIN_STEP_DL); };

const stepsCache = new Map<string, readonly string[]>();

/**
 * The 256-colour lead-in of an ease: ONE step, white (the theme's emphasis colour; ink on Latte), then the resting tone. Critique 26 (live-150-a5fa582a-1 f0082, f0083 and 63 more
 * frames): a staircase of `stable256` neighbours put 194, 151, 147, 211, 216, 247 on screen, colours no palette names. The fade now lands only on the brief's indices (141, 114, 179,
 * 203, 236, 240, 245, 252) and 231, the white it starts from. Empty when the white is not visibly apart from the resting tone (the row keeps its tone; only the glyph pops).
 * `accent` is kept for the callers: the state's hue is the resting tone's job, the lead-in is white for every state.
 */
export function easeSteps256(_accent: string, rest: string, theme: Ui['theme']): readonly string[] {
  const key = `${theme}|${rest}`;
  const hit = stepsCache.get(key);
  if (hit) return hit;
  const target = fitHex(rest, theme);
  const lead = fitHex(theme === 'latte' ? PALETTES.latte.ink : '#ffffff', theme);
  const steps = visible(lead, target) ? [lead] : [];
  stepsCache.set(key, steps);
  return steps;
}

const blankWidth = (r: Run): Run => ({ t: ' '.repeat(cells(r.t)), tone: 'text' });
/** `runs` cut to `n` cells from the left, the rest blanked in place (the row keeps its width). A wide glyph cut in half blanks. */
export function revealRuns(runs: readonly Run[], n: number, keep?: (run: Run) => boolean): Run[] {
  let used = 0;
  return runs.map((r) => {
    const w = cells(r.t);
    if (keep?.(r)) { used += w; return r; }
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

const STATE_WORDS: ReadonlySet<string> = new Set<string>([...UI_STATES, RETURNED]);
/** The runs a new row never hides while it reveals: the marks (focus, state glyph, spinner: one non-word cell) and the state word (and a chip). Only the
 * name and detail grow in, so no frame reads `ru` or `runni` for `running` (critique 11, from the HUD review). */
export const staysWhileRevealing = (r: Run): boolean => {
  if (r.chip) return true;
  const w = r.t.trim();
  return w !== '' && (STATE_WORDS.has(w.toLowerCase()) || (cells(w) === 1 && /[^\p{L}\p{N}]/u.test(w)));
};

export type AnimateOpts = {
  /** Draw the left-to-right reveal of a new row (default true). */
  reveal?: boolean;
  /** Pop the glyph of a row that turned done (default true). */
  pop?: boolean;
  /** Which runs take the tint (default: every run with text and no fill). */
  tint?: (run: Run, index: number) => boolean;
};

/** A run not already bold is drawn bold for the whole window and drops it at rest: emphasis only ever falls. A 256-colour palette gives two
 * distinct steps between a lead and a rest tone, so without this the last beats equalled the rest frame and the ramp read 400 ms, not 600
 * (critique 12). Critique 16 (motion-e4a8186a/todo-strip.ans:4-7): bold that arrives on the LAST beats read 231, 193, bold 193, bold 151,
 * 151, a brightness pop at 400-600 ms; held from the first beat it falls with the colour instead. */
const lift = (r: Run): Run => (r.bold !== true ? { ...r, bold: true } : r);
/** The weight of a beat: held bold while the colour moves, and back to the row's own weight on the LAST beat of the window, so the rest frame changes
 * colour at most and never weight (critique 17 C4: 231, 193, 151, 151 bold, then 151 plain, a weight pop at rest). */
const weighted = (r: Run, beat: number): Run => (beat >= MAX_BEATS - 1 ? r : lift(r));

/** Runs a row builder marked as not changing with the row's state (an agent's MODEL and TASK): `animateRow` leaves them at their tone, so a done row
 * flashes only what the change touched (critique 17 C4: MODEL and TASK flashed 231 though they never change). Identity, so mark the run `animateRow` receives. */
const calm = new WeakSet<Run>();
export const calmRun = (r: Run): Run => { calm.add(r); return r; };

/** The done fade's two steps (xterm 231 and 151). */
export const DONE_FADE = ['#ffffff', xtermHex(151)] as const; // xterm 231 then 151, named by index so no second hex literal is spelled

const rampCache = new Map<string, readonly string[]>();
/**
 * The colours a 256-colour run steps through, one per beat: white (the theme's emphasis colour) first when the palette has room for it, then
 * the staircase, then the resting colour itself (held bold, so it still differs from the rest frame). Lightness only moves toward rest, so no
 * beat is brighter than the one before. Empty when the palette has no staircase for the pair (the row keeps its tone; only the glyph pops).
 */
export function ramp256(accent: string, rest: string, theme: Ui['theme'], lifted: boolean): readonly string[] {
  const key = `${theme}|${accent}|${rest}|${lifted}`;
  const hit = rampCache.get(key);
  if (hit) return hit;
  const lead = easeSteps256(accent, rest, theme);
  const target = fitHex(rest, theme);
  // White, then the resting tone. A lifted run is bold while its colour moves and drops the weight on the very frame its colour lands on rest (critique 19: bold fell one step after 146 landed,
  // motion-232567af/todo-strip.ans:4-5), so a lifted run ends on the resting tone as its own beat; a plain run rests on the frame after the white.
  const ramp = lead.length ? (lifted ? [...lead, target] : [...lead]) : [];
  rampCache.set(key, ramp);
  return ramp;
}

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
    const beat = Math.max(0, Math.floor(easedMs(e, ctx.now) / MOTION_STEP_MS)); // one beat per held step: the staircase and the pop both step on it
    if (ui.color !== 'none' && accent === 'done' && e.state === 'done') {
      // Wave 31: the done fade is 231 for one step, then 151 held to the end of the window, then the resting tone (critique 29: 0 fade frames showed live).
      const fade = ctx.now - e.changed < MOTION_STEP_MS ? DONE_FADE[0] : DONE_FADE[1];
      const wantsDone = o.tint ?? ((r: Run) => r.bg === undefined && r.t.trim() !== '' && !calm.has(r));
      out = out.map((r, i) => (wantsDone(r, i) ? weighted({ ...r, fg: fade }, beat) : r)); // the weight falls on the last beat, the colour on the frame after it
    } else if (ui.color !== 'none') {
      const palette = PALETTES[ui.theme];
      const lead = mixHex(palette[markToken(accent)], '#ffffff', LEAD_WHITE);
      // The weight falls on the last beat (`weighted`): the colour holds the previous beat's mix then, so one frame never moves both (critique 18: bold dropped as the text stepped 151 to 146).
      const t = easeOutCubic(beat >= MAX_BEATS - 1 ? Math.min(1, Math.max(0, ((beat - 1) * MOTION_STEP_MS) / MOTION_MS)) : pc);
      const wants = o.tint ?? ((r: Run) => r.bg === undefined && r.t.trim() !== '' && !calm.has(r));
      out = out.map((r, i) => {
        if (!wants(r, i)) return r;
        const rest = r.fg ?? (r.tone === 'dim' ? (ui.theme === 'latte' ? palette.muted : '#585858') : palette[r.tone]);
        if (ui.color === '256') {
          const steps = ramp256(palette[markToken(accent)], rest, ui.theme, r.bold !== true);
          // No staircase for this pair: the row keeps its tone (the glyph pop still moves).
          if (!steps.length) return r;
          const at = Math.min(beat, steps.length - 1);
          const landed = at >= steps.length - 1; // the colour is at rest (a lifted ramp's last step): the weight falls with it, in this frame
          return landed ? { ...r, fg: steps[at]! } : lift({ ...r, fg: steps[at]! });
        }
        return weighted({ ...r, fg: mixHex(lead, rest, t) }, beat);
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
  if (pr < 1) out = revealRuns(out, Math.ceil(pr * lastInk(out)), staysWhileRevealing);
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
    const changed = source !== this.seen;
    if (changed) {
      this.seen = source;
      for (const [surface, items] of Object.entries(await feed())) this.motion.observe(surface, items, now);
    }
    if (changed || !this.timer) this.motion.commit(); // while a frame timer runs, only its frames publish the clock
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
    this.motion.stamp(now);
    this.motion.commit(); // before the redraw: every surface the redraw touches reads this one reading
    await this.redraw();
    if (!busy) this.stop();
  }
}
