// Command Center Tab 4 'Squad': the persona roster (plan §3.2 + §5).
// One character-select card per snapshot persona plus the armada and unknown
// tokens: an animated 16x16 half-block portrait on a 6 fps frame clock, the
// pinned model and effort, the live agent count and token spend. Below the
// cards, the task-type routing matrix — hovering a task row highlights the
// persona card it routes to — and the drift panel: header misses this session
// plus a cost warning for every persona pinned to 'inherit'.
import { BRAND } from '../contract';
import type { AtlasSnapshot, SquadAgent } from '../contract';
import type { ClientSurface, RenderElement } from 'claude-code';
import { ROUTING_MATRIX, personaColor } from '../data/personas';
import type { RoutingRow } from '../data/personas';
import { spriteFor } from '../sprites';
import { frameToRuns } from '../sprites/grid';

type SquadProps = { snapshot: AtlasSnapshot; columns: number; rows: number };
type SquadState = { tick: number; ptrY: number | null };

const CARD_W = 28; // cells per card
const SPRITE_W = 8; // 16 px wide portrait = 8 half-block cells
const SPRITE_H = 8; // 16 px tall = 8 half-block cells
const GAP_Y = 1; // rows between card grid lines
const FPS = 6;

/** States that still count a persona's agents as "live" on the roster. */
const LIVE: Partial<Record<SquadAgent['state'], true>> = { spawning: true, running: true, idle: true, input: true, stuck: true, parked: true };
/** States that animate the card's portrait with the working loop. */
const ON_DUTY: Partial<Record<SquadAgent['state'], true>> = { spawning: true, running: true, input: true };

type Card = {
  keyName: string;
  label: string;
  sprite: string;
  color: string;
  model: string;
  effort: string;
  description: string;
  live: number;
  spawned: number;
  tokens: number;
  working: boolean;
  warn: boolean;
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

const fmtTokens = (n: number): string => (n < 1000 ? String(n) : `${Math.round(n / 100) / 10}k`);

/** Card keys a routing row points at: 'atlas:<name>' / 'armada-*' / 'main thread' → card keyName. */
const rowCardKeys = (row: RoutingRow): string[] =>
  row.persona
    .split(';')
    .map((tok) => tok.trim())
    .filter(Boolean)
    .map((tok) => {
      const bare = tok.replace(/^atlas:/, '');
      if (bare.startsWith('armada')) return 'armada';
      if (bare === 'main thread' || bare === 'main' || bare === 'lead') return 'lead';
      return bare;
    });

export default function Squad(props: SquadProps, surface: ClientSurface<SquadState>): RenderElement {
  const { snapshot, columns, rows } = props;
  const { Box, Text } = surface.elements;

  if (surface.state === undefined) {
    surface.every(Math.round(1000 / FPS), () => {
      const s = surface.state as SquadState;
      surface.setState({ tick: s.tick + 1, ptrY: s.ptrY });
    });
    surface.onPointer((e) => {
      const s = surface.state as SquadState;
      surface.setState({ tick: s.tick, ptrY: e.type === 'leave' ? null : e.y });
    });
  }
  const { tick, ptrY } = surface.state ?? { tick: 0, ptrY: null };

  // ---- persona cards (snapshot.personas + armada + unknown) ----
  const byPerson = new Map<string, SquadAgent[]>();
  for (const a of snapshot.squad) {
    const list = byPerson.get(a.persona);
    if (list) list.push(a);
    else byPerson.set(a.persona, [a]);
  }
  const stats = (mine: SquadAgent[]) => ({
    live: mine.filter((a) => LIVE[a.state]).length,
    spawned: mine.length,
    tokens: mine.reduce((n, a) => n + (a.tokens ?? 0), 0),
    working: mine.some((a) => ON_DUTY[a.state]),
  });

  const cards: Card[] = snapshot.personas.map((p) => {
    const mine = byPerson.get(p.name) ?? [];
    return {
      keyName: p.name, label: p.name, sprite: p.name,
      color: personaColor(p.color),
      model: p.model, effort: p.effort, description: p.description,
      ...stats(mine),
      warn: p.model === 'inherit',
    };
  });
  const armadaAgents = snapshot.squad.filter((a) => a.persona.startsWith('armada-'));
  cards.push({
    keyName: 'armada', label: 'armada', sprite: 'armada',
    color: BRAND.subagent, model: 'inherit', effort: 'inherit',
    description: 'department swarm: herdr panes owned by armada-<dept> workers',
    ...stats(armadaAgents),
    warn: true,
  });
  const known = new Set(snapshot.personas.map((p) => p.name));
  const unknownAgents = snapshot.squad.filter(
    (a) => a.persona === 'unknown' || (!a.persona.startsWith('armada-') && !known.has(a.persona)),
  );
  cards.push({
    keyName: 'unknown', label: 'unknown', sprite: 'unknown',
    color: BRAND.idle, model: '—', effort: '—',
    description: 'agents whose persona could not be classified',
    ...stats(unknownAgents),
    warn: false,
  });

  // ---- layout: title | card grid | routing matrix | drift panel ----
  const col = columns > 0 ? columns : 80;
  const perRow = Math.max(1, Math.floor((col - 2) / (CARD_W + 2)));
  const gridRows = Math.ceil(cards.length / perRow);
  const warnLines = cards.filter((c) => c.warn).length;
  const withRole = (roleRows: number): number =>
    1 + gridRows * (2 + SPRITE_H + roleRows) + (gridRows - 1) * GAP_Y + 1 + 1 + ROUTING_MATRIX.length + 1 + 1 + warnLines;
  const roleRows = rows > 0 && withRole(2) > rows ? 0 : 2;
  const cardH = 2 + SPRITE_H + roleRows;
  const mTop = 1 + gridRows * cardH + (gridRows - 1) * GAP_Y + 1;
  const hoverRow =
    ptrY === null ? null : ptrY < mTop + 1 ? null : ptrY - mTop - 1 < ROUTING_MATRIX.length ? Math.floor(ptrY - mTop - 1) : null;
  const hlSet = hoverRow === null ? new Set<string>() : new Set(rowCardKeys(ROUTING_MATRIX[hoverRow] as RoutingRow) as string[]);

  // ---- portrait: spriteFor(<persona>) 16x16 idle/working frame as half-block runs ----
  const blankSprite = (): RenderElement[] =>
    Array.from({ length: SPRITE_H }, () => Text({ children: ' '.repeat(SPRITE_W) }));
  const portraitLines = (c: Card, offset: number): RenderElement[] => {
    const set = spriteFor(c.sprite);
    const frames = set?.portrait[c.working ? 'working' : 'idle'] ?? [];
    if (!set || frames.length === 0) return blankSprite();
    const frame = frames[(tick + offset) % frames.length] ?? frames[0];
    if (!frame) return blankSprite();
    return frameToRuns(frame, set.palette)
      .slice(0, SPRITE_H)
      .map((runs) => Text({ children: runs.map((r) => Text({ color: r.color, backgroundColor: r.backgroundColor, children: r.text })) }));
  };

  const card = (c: Card, gi: number): RenderElement =>
    Box({
      width: CARD_W,
      backgroundColor: BRAND.surface,
      flexDirection: 'column',
      children: [
        Text({ backgroundColor: hlSet.has(c.keyName) ? BRAND.focus : c.color, children: ' '.repeat(CARD_W) }),
        Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          children: [
            Text({ color: c.color, bold: true, children: c.label.slice(0, CARD_W - 9) }),
            Text({ color: c.live > 0 ? BRAND.ok : BRAND.dim, children: `● ${c.live}/${c.spawned}` }),
          ],
        }),
        Box({
          flexDirection: 'row',
          children: [
            Box({ width: SPRITE_W, flexDirection: 'column', children: portraitLines(c, gi * 3) }),
            Box({
              flexDirection: 'column',
              paddingLeft: 1,
              children: [
                Text({ wrap: 'truncate-end', color: c.warn ? BRAND.input : BRAND.dim, children: (c.warn ? '⚠ ' : '') + c.model }),
                Text({ wrap: 'truncate-end', color: BRAND.dim, children: `e ${c.effort}` }),
                Text({ wrap: 'truncate-end', color: BRAND.dim, children: `tok ${fmtTokens(c.tokens)}` }),
              ],
            }),
          ],
        }),
        ...(roleRows > 0
          ? [
              Text({ wrap: 'truncate-end', color: BRAND.dim, children: c.description.slice(0, CARD_W - 1) || ' ' }),
              Text({ wrap: 'truncate-end', color: BRAND.dim, children: c.description.slice(CARD_W - 1, (CARD_W - 1) * 2) || ' ' }),
            ]
          : []),
      ],
    });

  // ---- routing matrix: one line per task type, hover highlights its persona card ----
  const wTask = clamp(col - 62, 16, 44);
  const wPerson = clamp(col - wTask - 26, 14, 36);
  const personaByName = new Map(snapshot.personas.map((p) => [p.name, p]));
  const rowColor = (row: RoutingRow): string => {
    for (const key of rowCardKeys(row)) {
      const p = personaByName.get(key);
      if (p) return personaColor(p.color);
      if (key === 'armada') return BRAND.subagent;
    }
    return BRAND.idle;
  };
  const matrixLine = (row: RoutingRow, i: number): RenderElement => {
    const hovered = hoverRow === i;
    const hover = hovered ? { color: BRAND.bg, backgroundColor: BRAND.accent } : {};
    return Box({
      flexDirection: 'row',
      children: [
        Text({ wrap: 'truncate-end', color: BRAND.text, ...hover, children: row.task.padEnd(wTask).slice(0, wTask) }),
        Text({ wrap: 'truncate-end', ...(hovered ? hover : { color: rowColor(row) }), children: row.persona.padEnd(wPerson).slice(0, wPerson) }),
        Text({ wrap: 'truncate-end', color: BRAND.dim, ...hover, children: ` ${row.model}/${row.effort}` }),
      ],
    });
  };

  const liveCount = snapshot.squad.filter((a) => LIVE[a.state]).length;

  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          Text({ color: BRAND.accent, bold: true, children: '⬢ SQUAD — persona roster' }),
          Text({
            color: BRAND.dim,
            children: `${liveCount} live · ${snapshot.squad.length} spawned · ${fmtTokens(snapshot.tokens)} tok · $${snapshot.costUsd.toFixed(2)}`,
          }),
        ],
      }),
      Box({
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: GAP_Y,
        columnGap: 2,
        children: cards.map((c, i) => card(c, i)),
      }),
      Text({ children: ' ' }),
      Text({ color: BRAND.dim, children: 'ROUTING — task type → persona' }),
      ...ROUTING_MATRIX.map(matrixLine),
      Text({ children: ' ' }),
      Text({ color: BRAND.dim, children: 'DRIFT' }),
      Text({
        color: snapshot.headerMisses > 0 ? BRAND.fail : BRAND.ok,
        children: `header misses this session: ${snapshot.headerMisses}`,
      }),
      ...cards
        .filter((c) => c.warn)
        .map((c) => Text({ color: BRAND.input, children: `⚠ ${c.label}: model '${c.model}' — unpinned, inherits the orchestrator (cost)` })),
    ],
  });
}