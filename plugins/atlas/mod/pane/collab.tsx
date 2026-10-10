// Command Center Tab 5 'Collab': live claims, path conflicts and the
// handoff/blocked feed (plan §3.2 + §5). Left column groups each owner's
// active file claims under an animated mini-sprite persona chip; overlaps are
// flagged in fail red naming both owners. Right column is the newest-first
// feed of blocked (amber) and handoff (teal) notes — clicking a blocked entry
// prefills a reply to its sender in the composer below. Intents go out through
// surface.post; no Raster/Image here.
import { BRAND } from '../contract';
import type { AtlasSnapshot } from '../contract';
import type { ClientSurface, RenderElement } from 'claude-code';
import { activeClaims, collabEvents, collabSummary, findConflicts } from '../data/collab';
import { personaColor } from '../data/personas';
import { spriteFor } from '../sprites';
import { frameToRuns } from '../sprites/grid';
import { parseMessage } from './channel';

type CollabProps = { snapshot: AtlasSnapshot; columns: number; rows: number };
type CollabState = { tick: number; text: string; replyTo: string | null };

const FPS = 6;
const MINI_W = 4; // 4 px wide mini sprite = 4 half-block cells
const MINI_H = 2; // 4 px tall mini sprite = 2 half-block rows

// Feed line hit zones, recomputed each render, read by onPointer (board.tsx pattern).
let feedGeo: { y: number; x0: number; from: string }[] = [];

export default function Collab(props: CollabProps, surface: ClientSurface<CollabState>): RenderElement {
  const { snapshot, columns, rows } = props;
  const { Box, Text, Input } = surface.elements;

  if (surface.state === undefined) {
    surface.every(Math.round(1000 / FPS), () => {
      const s = surface.state as CollabState;
      surface.setState({ tick: s.tick + 1, text: s.text, replyTo: s.replyTo });
    });
    surface.onPointer((e) => {
      if (e.type !== 'down') return;
      const s = surface.state as CollabState;
      const hit = feedGeo.find((z) => e.y === z.y && e.x >= z.x0);
      if (hit) surface.setState({ tick: s.tick, text: `@${hit.from} `, replyTo: hit.from });
    });
  }
  const st = surface.state ?? { tick: 0, text: '', replyTo: null };

  const notes = snapshot.notes;
  const summary = collabSummary(notes, snapshot.squad);
  const claims = activeClaims(notes, snapshot.squad);
  const conflicts = findConflicts(claims);

  // Feed: blocked + handoff notes, newest first. sinceSeq 0 = the whole
  // 500-note window, matching the header counts which span the same notes.
  const feed = collabEvents(notes, 0)
    .filter((ev) => ev.kind === 'blocked' || ev.kind === 'handoff')
    .sort((a, b) => b.seq - a.seq);

  const col = columns > 0 ? columns : 80;
  const row = rows > 0 ? rows : 24;
  const leftW = Math.min(48, Math.max(24, Math.floor(col / 2) - 1));
  const feedX0 = leftW + 2;
  const maxFeed = Math.max(0, row - 5); // header + spacer + feed heading + composer + slack

  const agentByName = new Map(snapshot.squad.map((a) => [a.name, a]));
  const personaOf = (owner: string): string => agentByName.get(owner)?.persona ?? owner;
  const working = (owner: string): boolean => {
    const state = agentByName.get(owner)?.state;
    return state === 'running' || state === 'spawning' || state === 'input';
  };

  // mini 4x4 sprite, animated on the 6 fps clock (squad portrait pattern)
  const miniLines = (who: string): RenderElement[] => {
    const set = spriteFor(personaOf(who));
    const frames = set?.mini[working(who) ? 'working' : 'idle'] ?? [];
    const frame = frames.length > 0 ? (frames[(st.tick + who.length) % frames.length] ?? frames[0]) : undefined;
    if (!set || !frame) {
      return [Text({ children: ' '.repeat(MINI_W) }), Text({ children: ' '.repeat(MINI_W) })];
    }
    return frameToRuns(frame, set.palette)
      .slice(0, MINI_H)
      .map((runs) =>
        Text({ children: runs.map((r) => Text({ color: r.color, backgroundColor: r.backgroundColor, children: r.text })) }),
      );
  };

  // ---- left: active file claims grouped by owner, then conflicts ----
  const claimBlocks: RenderElement[] = claims.map((c, i) =>
    Box({
      key: `c${i}`,
      flexDirection: 'row',
      children: [
        Box({ width: MINI_W, flexShrink: 0, flexDirection: 'column', children: miniLines(c.owner) }),
        Box({
          flexDirection: 'column',
          paddingLeft: 1,
          children: [
            Text({ wrap: 'truncate-end', bold: true, color: personaColor(personaOf(c.owner)), children: c.owner }),
            ...c.paths.map((p) => Text({ wrap: 'truncate-end', color: BRAND.dim, children: `  ${p}` })),
          ],
        }),
      ],
    }),
  );
  const conflictLines: RenderElement[] = conflicts.map((cf) =>
    Text({
      wrap: 'truncate-end',
      color: BRAND.fail, // #ff7570
      children: `${cf.a} × ${cf.b}: ${cf.path}`,
    }),
  );

  // ---- right: handoff/blocked feed, newest first; blocked rows are clickable ----
  const shown = feed.slice(0, maxFeed);
  feedGeo = shown.map((ev, i) => ({ y: 3 + i, x0: feedX0, from: ev.from }));
  const feedLines: RenderElement[] = shown.map((ev) => {
    const blocked = ev.kind === 'blocked';
    const arrow = ev.to ? `${ev.from}→${ev.to}` : ev.from;
    return Text({
      wrap: 'truncate-end',
      color: blocked ? BRAND.input : BRAND.accent, // #f2aa40 / #2fbd9f
      children: `${blocked ? '■' : '»'} ${arrow}: ${ev.text}`,
    });
  });

  const composer: RenderElement = snapshot.channel
    ? Input({
        key: 'composer',
        label: st.replyTo ? `→${st.replyTo}` : 'note',
        placeholder: st.replyTo ? `replying to ${st.replyTo}` : '@nick message, plain text broadcasts',
        value: st.text,
        onInput: (v) => {
          const s = surface.state;
          if (s) surface.setState({ ...s, text: v });
        },
        onSubmit: (v) => {
          const channel = snapshot.channel;
          if (!channel) return;
          const { to, text } = parseMessage(v);
          if (!text) return;
          surface.post({ t: 'note', channel, to, text });
          const s = surface.state;
          if (s) surface.setState({ ...s, text: '', replyTo: null });
        },
      })
    : Text({ color: BRAND.dim, children: 'no channel — notes unavailable' });

  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          Text({ color: BRAND.accent, bold: true, children: '⬢ COLLAB — claims & handoffs' }),
          Text({
            color: BRAND.dim,
            children: `claims ${summary.claims} · conflicts ${summary.conflicts} · blocked ${summary.blocked} · handoffs ${summary.handoffs}`,
          }),
        ],
      }),
      Text({ children: ' ' }),
      Box({
        flexDirection: 'row',
        flexGrow: 1,
        overflow: 'hidden',
        children: [
          Box({
            width: leftW,
            flexShrink: 0,
            flexDirection: 'column',
            overflow: 'hidden',
            children: [
              Text({ color: BRAND.dim, children: 'ACTIVE CLAIMS' }),
              ...(claims.length > 0 ? claimBlocks : [Text({ color: BRAND.dim, children: '  none' })]),
              Text({ children: ' ' }),
              Text({ color: BRAND.fail, children: `CONFLICTS ${conflicts.length}` }),
              ...(conflicts.length > 0 ? conflictLines : [Text({ color: BRAND.dim, children: '  none' })]),
            ],
          }),
          Box({
            flexDirection: 'column',
            paddingLeft: 2,
            flexGrow: 1,
            overflow: 'hidden',
            children: [
              Text({ color: BRAND.dim, children: 'FEED — newest first · click ■ blocked to reply' }),
              ...(shown.length > 0 ? feedLines : [Text({ color: BRAND.dim, children: '  quiet' })]),
            ],
          }),
        ],
      }),
      composer,
    ],
  });
}
