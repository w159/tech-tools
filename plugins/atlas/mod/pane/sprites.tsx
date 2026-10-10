// Command Center 'Sprites' gallery pane: every SPRITES entry as an animated
// portrait tile. A 4 fps clock advances each tile's frame; the walk moves
// through the eight contract states one state per second — a living catalog of
// the sprite art for eyeballing palettes and idle/working/failed loops.
import { BRAND } from '../contract';
import type { SpriteState } from '../contract';
import type { ClientSurface, RenderElement } from 'claude-code';
import { SPRITES } from '../sprites';
import { STATES, frameToRuns } from '../sprites/grid';

type SpritesProps = { columns: number; rows: number };
type SpritesState = { tick: number };

const SPRITE_W = 8; // 16 px wide portrait = 8 half-block cells
const SPRITE_H = 8; // 16 px tall = 8 half-block cells
const CARD_W = 12; // tile width: sprite + label headroom
const GAP_Y = 1; // rows between tile grid lines
const TILE_H = SPRITE_H + 1 + GAP_Y; // sprite rows + label row + gap
const FPS = 4; // portrait frame clock
const TICKS_PER_STATE = 4; // 1 s per state at 4 fps (250 ms ticks)

export default function Sprites(props: SpritesProps, surface: ClientSurface<SpritesState>): RenderElement {
  const { columns, rows } = props;
  const { Box, Text } = surface.elements;

  if (surface.state === undefined) {
    surface.every(Math.round(1000 / FPS), () => {
      const s = surface.state as SpritesState;
      surface.setState({ tick: s.tick + 1 });
    });
  }
  const { tick } = surface.state ?? { tick: 0 };

  // one state per second, one frame per tick (4 fps), looping both
  const stateIdx = Math.floor(tick / TICKS_PER_STATE) % STATES.length;
  const state = STATES[stateIdx] as SpriteState;

  const blankRows = (): RenderElement[] =>
    Array.from({ length: SPRITE_H }, () => Text({ children: ' '.repeat(SPRITE_W) }));

  const tile = (key: string): RenderElement => {
    const set = SPRITES[key];
    if (!set) return Text({ color: BRAND.fail, children: key.slice(0, CARD_W) });
    const frames = set.portrait[state] ?? [];
    const frame = frames.length === 0 ? undefined : frames[tick % frames.length] ?? frames[0];
    const sprite = frame
      ? frameToRuns(frame, set.palette)
          .slice(0, SPRITE_H)
          .map((runs) => Text({ children: runs.map((r) => Text({ color: r.color, backgroundColor: r.backgroundColor, children: r.text })) }))
      : blankRows();
    return Box({
      width: CARD_W,
      backgroundColor: BRAND.surface,
      flexDirection: 'column',
      children: [
        ...sprite,
        Text({ wrap: 'truncate-end', color: BRAND.text, children: key.slice(0, CARD_W).padEnd(CARD_W) }),
      ],
    });
  };

  // ---- layout: title | tile grid wrapped to the pane ----
  const col = columns > 0 ? columns : 80;
  const perRow = Math.max(1, Math.floor((col - 2) / (CARD_W + 2)));
  const gridRowsFit = rows > 0 ? Math.max(1, Math.floor((rows - 1) / TILE_H)) : Math.ceil(Object.keys(SPRITES).length / perRow);
  const keys = Object.keys(SPRITES);
  const visible = Math.min(keys.length, Math.max(perRow, gridRowsFit * perRow));

  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          Text({ color: BRAND.accent, bold: true, children: '⬢ SPRITES — sprite atlas' }),
          Text({ color: BRAND.dim, children: `${visible}/${keys.length} sets · ${state} @ ${FPS}fps` }),
        ],
      }),
      Box({
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: GAP_Y,
        columnGap: 2,
        children: keys.slice(0, visible).map((k) => tile(k)),
      }),
    ],
  });
}