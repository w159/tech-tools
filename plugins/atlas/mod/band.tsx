// The band: the always-on Atlas strip above the prompt (plan §3.1).
// Client surface module: no $, no Node, no timers — surface.every is the clock,
// surface.post the only way back to the hooks module. No Raster/Image here.
//
// Row 1 contract track, row 2 starfield + titan, row 3 squad conveyor.
// Hovering a phase node reveals an absolute card via a hover scope group;
// clicking a squad glyph or the mail count posts an Intent.

import type { ClientModule } from 'claude-code';
import { BRAND, type AgentState, type AtlasSnapshot, type Intent, type PhaseId } from './contract';
import { bar, blink, dim, glyph, phaseColor, stateColor } from './theme';

/** Per-figure unknown-ness: null = not measured yet (session.measure has not
 * carried a value), 0 is a legitimate measured value. Absent prop = snapshot
 * fallback (measured-or-0) for callers that predate the prop. */
export interface UsageUnknown {
  tokens: number | null;
  costUsd: number | null;
  contextPct: number | null;
}

export interface BandProps {
  snapshot: AtlasSnapshot;
  columns: number;
  maxRows: number;
  usage?: UsageUnknown;
}

interface Seg {
  text: string;
  color?: string;
  bg?: string;
  bold?: boolean;
  dimmed?: boolean;
  /** Names the hover group this Text joins (phase nodes; reveals their card). */
  hoverScope?: string;
}

interface Zone {
  x0: number;
  x1: number;
  y: number;
  act: Intent;
}

interface Refs {
  tick: number;
  zones: Zone[];
}

const TITAN = '▟█▙';
const LIVE_STATES: { readonly [k in AgentState]?: true } = { spawning: true, running: true, idle: true, input: true, stuck: true };

/** Per-instance mutable refs (tick + click zones), keyed by surface. */
const refsFor = new WeakMap<object, Refs>();

function phasesOf(snap: AtlasSnapshot): PhaseId[] {
  const phases: PhaseId[] = [];
  for (const p of snap.contract.todoPhases) {
    if (p !== 'done' && !phases.includes(p)) phases.push(p);
  }
  phases.push('done');
  return phases;
}

/** Row 1: ⬢ATLAS + phase nodes (done diamonds, current capsule, hollow rest) joined by rails. */
export function buildTrack(snap: AtlasSnapshot, glow: string, flash: boolean): {
  segs: Seg[];
  phases: PhaseId[];
  nodeX: number[];
} {
  const segs: Seg[] = [{ text: `${glyph.hex}ATLAS `, color: BRAND.accent, bold: true }];
  const phases = phasesOf(snap);
  const nodeX: number[] = [];
  const blocked = snap.phase === 'blocked';
  const curIdx = blocked ? -1 : phases.indexOf(snap.phase);
  const nodeColor = (finished: boolean) =>
    blocked ? (finished ? BRAND.fail : dim(BRAND.fail, 0.55)) : finished ? BRAND.accent : BRAND.dim;

  phases.forEach((p, i) => {
    const c = snap.counts.byPhase[p] ?? { done: 0, total: 0 };
    const finished = (c.total > 0 && c.done === c.total) || (curIdx >= 0 && i < curIdx);
    nodeX.push(segs.reduce((n, s) => n + s.text.length, 0));
    if (i === curIdx) {
      const label = c.total > 0 ? `${p.toUpperCase()} ${c.done}/${c.total}` : p.toUpperCase();
      segs.push({
        text: `⟦${label}⟧`,
        color: BRAND.bg,
        bg: glow,
        bold: true,
        hoverScope: `phase-${p}`,
      });
    } else if (finished) {
      segs.push({ text: `${glyph.diamond} ${p}`, color: nodeColor(true), hoverScope: `phase-${p}` });
    } else {
      segs.push({ text: `${glyph.hollow} ${p}`, color: nodeColor(false), hoverScope: `phase-${p}` });
    }
    if (i < phases.length - 1) {
      segs.push(
        finished
          ? { text: glyph.rail.repeat(3), color: blocked ? BRAND.fail : BRAND.accent }
          : { text: glyph.dash.repeat(3), color: BRAND.dim, dimmed: true },
      );
    }
  });

  if (blocked) {
    segs.push({
      text: '⟦BLOCKED⟧',
      color: flash ? BRAND.bg : BRAND.fail,
      bg: flash ? BRAND.fail : BRAND.surface,
      bold: true,
    });
  }
  return { segs, phases, nodeX };
}

/** Row 2: deterministic parallax starfield; the titan's x is overall progress. */
function buildField(w: number, tick: number, progress: number): { stars: string; tx: number } {
  const drift = Math.floor(tick / 3);
  let stars = '';
  for (let x = 0; x < w; x++) {
    const n = (Math.imul(x + 1, 2654435761) ^ Math.imul(drift + 7, 40503)) >>> 0;
    const m = n % 13;
    stars += m < 2 ? glyph.star : m === 2 ? glyph.starDim : m === 3 ? glyph.spark : m === 4 ? glyph.dot : ' ';
  }
  const tx = Math.max(0, Math.min(w - TITAN.length, Math.round(progress * (w - TITAN.length))));
  return { stars, tx };
}

/** Row 3: live agents in persona colour, then mail, context gauge, tokens and cost. */
export function buildConveyor(snap: AtlasSnapshot, w: number, usage: UsageUnknown = {
  tokens: snap.tokens,
  costUsd: snap.costUsd,
  contextPct: snap.contextPct,
}): { segs: Seg[]; zones: Zone[] } {
  const zones: Zone[] = [];
  const segs: Seg[] = [];
  const live = snap.squad.filter(a => LIVE_STATES[a.state]);
  const ctx = usage.contextPct;
  const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);

  const tail = (withGauge: boolean, withTok: boolean): Seg[] => {
    const t: Seg[] = [
      { text: `✉${snap.unread}`, color: snap.unread > 0 ? BRAND.input : BRAND.dim, dimmed: snap.unread === 0 },
    ];
    if (withGauge) {
      t.push(ctx === null
        ? { text: `  ${glyph.dot} ctx --`, color: BRAND.dim, dimmed: true }
        : { text: `  ${glyph.dot} ctx ${bar(ctx, 10)} ${Math.round(ctx)}%`, color: BRAND.dim, dimmed: true });
    }
    if (withTok) {
      t.push(usage.tokens === null
        ? { text: `  ${glyph.dot} -- tok`, color: BRAND.dim, dimmed: true }
        : { text: `  ${glyph.dot} ${fmtK(usage.tokens)} tok`, color: BRAND.dim, dimmed: true });
    }
    t.push(usage.costUsd === null
      ? { text: `  ${glyph.dot} $--`, color: BRAND.dim, dimmed: true }
      : { text: `  ${glyph.dot} $${usage.costUsd.toFixed(2)}`, color: BRAND.dim, dimmed: true });
    return t;
  };
  const tailLen = (t: Seg[]) => t.reduce((n, s) => n + s.text.length, 0);

  let t = tail(true, true);
  if (tailLen(t) > w) t = tail(true, false);
  if (tailLen(t) > w) t = tail(false, false);
  const room = Math.max(0, w - tailLen(t) - 2);

  let x = 0;
  live.forEach((a, i) => {
    const persona = snap.personas.find(p => p.name === a.persona);
    const pc = persona?.color ?? BRAND.subagent;
    const sg =
      a.state === 'running' ? glyph.play : a.state === 'spawning' ? glyph.star : a.state === 'input' ? glyph.starDim : glyph.dot;
    const parts: Seg[] = [
      { text: glyph.dot.replace(glyph.dot, '◢'), color: pc, bold: true },
      { text: ` ${a.name}`, color: pc },
      { text: sg, color: stateColor(a.state) },
    ];
    const sep = i > 0 ? 2 : 0;
    const len = parts.reduce((n, s) => n + s.text.length, 0);
    if (x + sep + len > room) return;
    if (sep > 0) {
      segs.push({ text: '  ', color: BRAND.dim, dimmed: true });
      x += sep;
    }
    zones.push({
      x0: x,
      x1: x + len,
      y: 2,
      act: { t: 'inspect', agent: a.name },
    });
    for (const p of parts) {
      segs.push(p);
      x += p.text.length;
    }
  });

  if (segs.length === 0) segs.push({ text: 'no live agents', color: BRAND.dim, dimmed: true });
  segs.push({ text: '  ', color: BRAND.dim, dimmed: true });
  const m0 = segs.reduce((n, s) => n + s.text.length, 0);
  const mailSeg: Seg = t[0] ?? { text: `✉${snap.unread}`, color: BRAND.dim };
  segs.push(mailSeg);
  zones.push({ x0: m0, x1: m0 + mailSeg.text.length, y: 2, act: { t: 'tab', tab: 'channel' } });
  for (const s of t.slice(1)) segs.push(s);

  return { segs, zones };
}

/** Trim a segment list to w cells (guards narrow bands against wrapping). */
function clipSegs(segs: Seg[], w: number): Seg[] {
  const out: Seg[] = [];
  let x = 0;
  for (const s of segs) {
    if (x >= w) break;
    const text = s.text.length > w - x ? s.text.slice(0, w - x) : s.text;
    out.push({ ...s, text });
    x += text.length;
  }
  return out;
}

const Band: ClientModule = (props, surface) => {
  const { Box, Text } = surface.elements;
  // SAFETY: register.tsx passes BandProps as this Client's props; the engine delivers
  // props typed as JsonValue, so the BandProps shape is trusted at this one boundary.
  const bp = props as unknown as BandProps;
  const snap = bp.snapshot;
  const w = Math.max(
    20,
    (Number.isFinite(bp.columns) && bp.columns > 0 ? Math.floor(bp.columns) : 0) || surface.columns || 80,
  );
  const full = (bp.maxRows ?? 3) >= 3;

  // Clock and pointer: registered once per instance. 10 fps with a live squad, 2 fps otherwise.
  // setState happens only in the tick callback — never between renders (render-loop rule).
  if (!refsFor.has(surface)) {
    refsFor.set(surface, { tick: 0, zones: [] });
    const live = snap.squad.some(a => a.state === 'running' || a.state === 'input');
    surface.every(live ? 100 : 500, () => {
      const r = refsFor.get(surface);
      if (r) {
        r.tick += 1;
        surface.setState({ tick: 0 });
      }
    });
    surface.onPointer(e => {
      if (e.type !== 'up' || e.button !== 'left') return;
      for (const z of refsFor.get(surface)?.zones ?? []) {
        if (e.y === z.y && e.x >= z.x0 && e.x < z.x1) surface.post(z.act);
      }
    });
  }
  const tick = refsFor.get(surface)?.tick ?? 0;
  const breath = blink(500) === 1;
  const glow = breath ? BRAND.focus : BRAND.accent;

  const track = buildTrack(snap, glow, breath);
  const tSegs = clipSegs(track.segs, w);
  const field = buildField(w, tick, snap.counts.total > 0 ? snap.counts.done / snap.counts.total : 0);
  const conv = buildConveyor(snap, w, bp.usage);
  const cSegs = clipSegs(conv.segs, w);
  const refs = refsFor.get(surface);
  if (refs) refs.zones = full ? conv.zones : [];

  // Hover cards: absolute over rows 2-3, revealed by the phase's hover scope group.
  const cards = full
    ? track.phases.map((p, i) => {
        const cx = track.nodeX[i] ?? 0;
        if (cx >= w) return null;
        const pool = snap.todos.filter(
          t => t.phase === p && !t.archived && (p === 'done' ? t.status === 'completed' : t.status !== 'completed'),
        );
        const items = pool.slice(0, 3);
        const cw = Math.min(46, Math.max(24, w - cx - 1));
        return (
          <Box
            key={`card-${p}`}
            position="absolute"
            top={1}
            left={cx}
            width={cw}
            display="none"
            hover={{ display: 'flex', scope: `phase-${p}` }}
            borderStyle="round"
            borderColor={phaseColor(p)}
            backgroundColor={BRAND.surface}
            flexDirection="column"
          >
            {items.length > 0
              ? items.map(t => (
                  <Text key={`ti-${t.id}`} color={BRAND.text} wrap="truncate-end">
                    {`${glyph.dot} ${t.content}${t.owner ? ` — ${t.owner}` : ''}`}
                  </Text>
                ))
              : (
                  <Text color={BRAND.dim}>no open items</Text>
                )}
          </Box>
        );
      })
    : [];

  return (
    <Box flexDirection="column" width={w}>
      <Box flexDirection="row">
        {tSegs.map((s, i) => (
          <Text
            key={`t${i}`}
            color={s.color}
            backgroundColor={s.bg}
            bold={s.bold}
            dimColor={s.dimmed}
            hover={s.hoverScope ? { scope: s.hoverScope } : undefined}
          >
            {s.text}
          </Text>
        ))}
      </Box>
      {full && (
        <Box height={1} position="relative">
          <Text color={BRAND.dim} dimColor>
            {field.stars}
          </Text>
          <Box position="absolute" top={0} left={field.tx}>
            <Text color={glow} bold>
              {TITAN}
            </Text>
          </Box>
        </Box>
      )}
      {full && (
        <Box flexDirection="row">
          {cSegs.map((s, i) => (
            <Text key={`c${i}`} color={s.color} dimColor={s.dimmed} bold={s.bold} wrap="truncate-end">
              {s.text}
            </Text>
          ))}
        </Box>
      )}
      {cards}
    </Box>
  );
};

export default Band;
