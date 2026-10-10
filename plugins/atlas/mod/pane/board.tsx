// Command Center Tab 3 'Board': the session kanban (plan §3.2 + §5).
// One column per snapshot.contract.todoPhases plus Done; every header carries a
// mini ▰▱ progress bar fed from snapshot.counts.byPhase and the column matching
// snapshot.phase is lit. Cards show the owner's mini sprite, the truncated
// content, the session age and an evidence tick. Cards drag with pointer
// down/move/up over cell-precision hit testing (hosts without fine pointer
// coordinates still report cells; the cell math below is the fallback): dropping
// on another column posts {t:'todo.phase'}, the agent chip strip along the
// bottom posts {t:'todo.claim'}, and dropping on Done opens an evidence Input
// that posts {t:'todo.complete'} only for non-empty evidence. Card moves stay
// optimistic until new props arrive; arrow keys move a selection; the frame
// clock runs only while dragging.
import { BRAND, type AtlasSnapshot, type PhaseCount, type PhaseId, type TodoItem } from '../contract';
import type { ClientSurface, RenderElement } from 'claude-code';
import { personaColor } from '../data/personas';
import { spriteFor } from '../sprites';
import { frameToRuns } from '../sprites/grid';
import { bar, glyph, phaseColor } from '../theme';

type BoardProps = { snapshot: AtlasSnapshot; columns: number; rows: number };
type ColId = PhaseId | 'done';
type Hover = { kind: 'col'; pid: ColId } | { kind: 'chip'; name: string } | null;

type BoardState = {
  tick: number; // drag clock step, only advanced while dragging
  now: number; // live wall clock (epoch ms) carried forward between drag ticks; 0 before
  sel: { col: number; row: number } | null;
  drag: { id: string; x: number; y: number; hover: Hover } | null;
  prompt: string | null; // todo id the evidence Input is collecting for
  promptText: string; // the evidence Input's controlled text
};

// ---- cross-render state the once-registered callbacks need ----
// setState is callback-only for a Client module, so data a later render
// produces but an early callback must read lives here, refreshed on each draw.
// ponytail: module-level geo/seen/optimistic state; revisit if two Board
// instances ever draw in one tree.
type CardRect = { x0: number; x1: number; y0: number; y1: number; id: string; col: number; row: number };
type Geo = {
  cols: { pid: ColId; x0: number; x1: number }[];
  cells: CardRect[];
  chipY: number;
  chips: { name: string; x0: number; x1: number }[];
  colLens: number[]; // per column, the visible card count selection clamps to
};
let geo: Geo = { cols: [], cells: [], chipY: -1, chips: [], colLens: [] };
let byId = new Map<string, TodoItem>();
let fallbackCol: ColId = 'research';
let phaseList: PhaseId[] = [];
const firstSeen = new Map<string, number>();
const overrides = new Map<string, { phase?: PhaseId; done?: true; owner?: string }>();
let lastSnap: AtlasSnapshot | null = null;

/** States that count as claimable agents on the chip strip. */
const LIVE: Record<string, true> = { spawning: true, running: true, idle: true, input: true, stuck: true, parked: true };

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const seed = (): BoardState => ({ tick: 0, now: 0, sel: { col: 0, row: 0 }, drag: null, prompt: null, promptText: '' });

/** Display column of a todo: ledger completion first, then the override, then the ledger phase. */
const phaseOf = (it: TodoItem | undefined): ColId => {
  if (!it) return 'done'; // a todo that vanished mid-drag has nowhere to draw
  if (it.status === 'completed' || overrides.get(it.id)?.done) return 'done';
  const p: PhaseId = overrides.get(it.id)?.phase ?? it.phase ?? 'research';
  return p === 'done' || p === fallbackCol || phaseList.includes(p) ? p : fallbackCol;
};

/** Effective owner for the card's display and the claim guard. */
const ownerOf = (it: TodoItem): string => overrides.get(it.id)?.owner ?? it.owner ?? 'lead';

/** Owner dispatch name -> sprite persona: agent names map through the squad, personas stay. */
const ownerPersona = (owner: string | undefined, squadOf: Map<string, string>): string => {
  if (!owner) return 'unknown';
  if (owner === 'lead') return 'lead';
  return squadOf.get(owner) ?? owner;
};

const fmtAge = (id: string, now: number): string => {
  const t0 = firstSeen.get(id);
  if (t0 === undefined) return '';
  const m = Math.floor(Math.max(0, now - t0) / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

export default function Board(props: BoardProps, surface: ClientSurface<BoardState>): RenderElement {
  const { snapshot, columns, rows } = props;
  const { Box, Text, Input } = surface.elements;

  if (surface.state === undefined) {
    surface.every(120, () => {
      const s = surface.state;
      if (!s || !s.drag) return; // clock only while dragging
      surface.setState({ ...s, tick: (s.tick + 1) % 4, now: Date.now() });
    });
    surface.onKey((e) => {
      const s = surface.state;
      if (!s || s.prompt || s.drag) return; // the evidence Input owns the keys then
      if (e.key !== 'left' && e.key !== 'right' && e.key !== 'up' && e.key !== 'down') return;
      const nCols = geo.cols.length;
      if (nCols === 0) return;
      const curSel = s.sel ?? { col: 0, row: 0 };
      const nextCol = clamp(
        e.key === 'left' ? curSel.col - 1 : e.key === 'right' ? curSel.col + 1 : curSel.col,
        0,
        nCols - 1,
      );
      const nextRow = clamp(
        e.key === 'up' ? curSel.row - 1 : e.key === 'down' ? curSel.row + 1 : curSel.row,
        0,
        Math.max(0, (geo.colLens[nextCol] ?? 1) - 1),
      );
      if (nextCol !== curSel.col || nextRow !== curSel.row) surface.setState({ ...s, sel: { col: nextCol, row: nextRow } });
    });
    surface.onPointer((e) => {
      const s = surface.state;
      if (e.type === 'leave') {
        if (s?.drag && s.drag.hover) surface.setState({ ...s, drag: { ...s.drag, hover: null } });
        return;
      }
      if (e.type === 'enter') return;
      if (e.type === 'down') {
        const cell = geo.cells.find((c) => e.x >= c.x0 && e.x <= c.x1 && e.y >= c.y0 && e.y <= c.y1);
        if (cell && s) {
          surface.setState({ ...s, sel: { col: cell.col, row: cell.row }, drag: { id: cell.id, x: e.x, y: e.y, hover: null } });
        }
        return;
      }
      if (!s || !s.drag) return;
      const chipHit = e.y === geo.chipY ? (geo.chips.find((c) => e.x >= c.x0 && e.x <= c.x1) ?? null) : null;
      const colHit =
        e.y < 2 || e.y >= geo.chipY ? null : (geo.cols.find((c) => e.x >= c.x0 && e.x <= c.x1)?.pid ?? null);
      if (e.type === 'move') {
        const hover: Hover = chipHit ? { kind: 'chip', name: chipHit.name } : colHit ? { kind: 'col', pid: colHit } : null;
        surface.setState({ ...s, drag: { ...s.drag, x: e.x, y: e.y, hover } });
        return;
      }
      // up: resolve the drop against the fresh geo and ledger
      const { id } = s.drag;
      const it = byId.get(id);
      const end = { ...s, drag: null };
      if (chipHit) {
        const owner = chipHit.name;
        if (it && ownerOf(it) !== owner) {
          overrides.set(id, { owner });
          surface.post({ t: 'todo.claim', id, owner });
        }
        surface.setState(end);
        return;
      }
      const from = phaseOf(it);
      if (colHit === 'done' && from !== 'done' && it) {
        surface.setState({ ...end, prompt: id, promptText: (it.evidence ?? '').split('\n')[0] ?? '' });
        return;
      }
      if (colHit && colHit !== 'done' && colHit !== from && it) {
        overrides.set(id, { phase: colHit });
        surface.post({ t: 'todo.phase', id, phase: colHit });
      }
      surface.setState(end);
    });
    surface.setState(seed());
  }
  const st = surface.state ?? seed();
  const drag = st.drag;

  // ---- new snapshot? clear the optimism; this render's data is the truth ----
  if (snapshot !== lastSnap) {
    lastSnap = snapshot;
    overrides.clear();
  }
  const now = st.now > snapshot.now ? st.now : snapshot.now;
  byId = new Map(snapshot.todos.map((t) => [t.id, t]));
  const todoPhases = snapshot.contract.todoPhases.filter((p) => p !== 'done');
  const pids: ColId[] = [...todoPhases, 'done'];
  phaseList = todoPhases;
  fallbackCol = todoPhases[0] ?? 'research';
  for (const it of snapshot.todos) if (!firstSeen.has(it.id)) firstSeen.set(it.id, now);

  const squadOf = new Map(snapshot.squad.map((a) => [a.name, a.persona]));

  // ---- geometry (mirrored into `geo` for the pointer/key callbacks) ----
  const col = columns > 0 ? columns : 80;
  const row = rows > 0 ? rows : 24;
  const nCols = Math.max(1, pids.length);
  const colW = Math.max(12, Math.floor((col - (nCols - 1)) / nCols));
  const stride = 3; // 2-row card + 1 blank row
  const promptH = st.prompt ? 1 : 0;
  const maxCards = Math.max(0, Math.floor((row - 7 - promptH) / stride));
  const colBlockH = 2 + maxCards * stride + 1; // 2 header rows + card strides + trailing slot
  const chipY = 2 + colBlockH + 1;

  const groups = pids.map((pid) => snapshot.todos.filter((it) => phaseOf(it) === pid));

  // claim chips: lead first, then live squad agents, fitted to the width
  const chips: { name: string; persona: string; x0: number; x1: number }[] = [];
  let cx = 0;
  const leadFirst: { name: string; persona: string }[] = [{ name: 'lead', persona: 'lead' }];
  for (const a of snapshot.squad) {
    if (!LIVE[a.state]) continue;
    if (a.name === 'lead' || leadFirst.some((c) => c.name === a.name)) continue;
    leadFirst.push({ name: a.name, persona: a.persona });
  }
  for (const c of leadFirst) {
    const w = c.name.length + 3; // '▸ name '
    if (chips.length > 0 && cx + w > col) break;
    chips.push({ ...c, x0: cx, x1: cx + w - 1 });
    cx += w + 1;
  }

  geo = {
    cols: pids.map((pid, ci) => ({ pid, x0: ci * (colW + 1), x1: ci * (colW + 1) + colW - 1 })),
    cells: [],
    chipY,
    chips: chips.map((c) => ({ name: c.name, x0: c.x0, x1: c.x1 })),
    colLens: groups.map((g) => Math.min(g.length, maxCards)),
  };

  // ---- render helpers ----
  const mini = (persona: string, working: boolean, key: string): RenderElement => {
    const set = spriteFor(persona);
    const frames = set.mini[working ? 'working' : 'idle'] ?? [];
    const frame = frames[st.tick % frames.length] ?? frames[0] ?? [];
    const runs = frameToRuns(frame, set.palette);
    const rows2 = runs.length >= 2 ? runs.slice(0, 2) : [...runs, [], []].slice(0, 2);
    return (
      <Box key={key} flexDirection="column" width={2} flexShrink={0}>
        {rows2.map((line, r) => (
          <Text key={`r${r}`}>
            {line.length > 0
              ? line.map((run, i) => (
                  <Text key={`c${i}`} color={run.color} backgroundColor={run.backgroundColor}>
                    {run.text}
                  </Text>
                ))
              : ' '}
          </Text>
        ))}
      </Box>
    );
  };

  const headerOf = (pid: ColId): RenderElement => {
    const hov = drag?.hover;
    const hovered = hov?.kind === 'col' && hov.pid === pid;
    const lit = pid === snapshot.phase;
    const bg = hovered ? BRAND.focus : lit ? BRAND.accent : undefined;
    const fg = hovered || lit ? BRAND.bg : phaseColor(pid);
    const mark = pid === 'done' ? glyph.star : (snapshot.contract.phases.find((p) => p.id === pid)?.glyph ?? glyph.diamond);
    const label = `${mark} ${pid === 'done' ? 'done' : pid}`.padEnd(colW).slice(0, colW);
    const cnt: PhaseCount =
      pid === 'done'
        ? (snapshot.counts.byPhase.done ?? { done: snapshot.counts.done, total: snapshot.counts.total })
        : (snapshot.counts.byPhase[pid] ?? { done: 0, total: 0 });
    const barW = Math.max(1, colW - 8);
    const pct = cnt.total > 0 ? (cnt.done * 100) / cnt.total : 0;
    const filled = Math.round((clamp(pct, 0, 100) / 100) * barW);
    const gauge = bar(pct, barW);
    return (
      <Box key={pid} width={colW} flexShrink={0} flexDirection="column">
        <Box flexDirection="row" backgroundColor={bg}>
          <Text bold={!!bg} color={fg} wrap="truncate-end">
            {label}
          </Text>
        </Box>
        <Box flexDirection="row">
          <Text color={BRAND.ok}>{gauge.slice(0, filled)}</Text>
          <Text color={BRAND.dim}>{gauge.slice(filled)}</Text>
          <Text dimColor>{` ${cnt.done}/${cnt.total}`}</Text>
        </Box>
      </Box>
    );
  };

  const cardOf = (it: TodoItem, pid: ColId, ci: number, idx: number): RenderElement => {
    const lifted = drag?.id === it.id;
    const selected = !lifted && st.sel?.col === ci && st.sel?.row === idx;
    const owner = ownerOf(it);
    const body = it.content.replace(/\s+/g, ' ').slice(0, Math.max(1, colW - 4));
    const meta = [fmtAge(it.id, now), owner === 'lead' ? '' : `@${owner}`, it.evidence ? glyph.star : '']
      .filter(Boolean)
      .join(' ')
      .slice(0, Math.max(1, colW - 4));
    geo.cells.push({
      x0: ci * (colW + 1),
      x1: ci * (colW + 1) + colW - 1,
      y0: 4 + idx * stride,
      y1: 5 + idx * stride,
      id: it.id,
      col: ci,
      row: idx,
    });
    return (
      <Box key={`${pid}:${it.id}`} width={colW} flexShrink={0} flexDirection="row">
        {mini(ownerPersona(owner, squadOf), lifted || it.status === 'in_progress', `sp${it.id}`)}
        <Box flexDirection="column" paddingLeft={1}>
          <Text wrap="truncate-end" color={lifted ? BRAND.dim : selected ? BRAND.focus : BRAND.text}>
            {lifted ? `◌ ${body.slice(0, Math.max(1, colW - 6))}`.padEnd(Math.max(1, colW - 4)) : body}
          </Text>
          <Text wrap="truncate-end" color={BRAND.dim}>
            {(selected ? '▸ ' : '') + meta}
          </Text>
        </Box>
      </Box>
    );
  };

  const columnOf = (pid: ColId, ci: number): RenderElement => {
    const items = groups[ci] ?? [];
    const vis = items.slice(0, maxCards);
    const over = items.length - vis.length;
    const rows: RenderElement[] = [headerOf(pid)];
    for (let i = 0; i < vis.length; i++) {
      const it = vis[i];
      if (it) rows.push(cardOf(it, pid, ci, i));
      rows.push(<Text key={`g${pid}:${i}`}> </Text>);
    }
    rows.push(
      over > 0 ? (
        <Text key={`o${pid}`} dimColor>{`+${over} more`}</Text>
      ) : (
        <Text key={`b${pid}`}> </Text>
      ),
    );
    return (
      <Box key={pid} width={colW} flexShrink={0} flexDirection="column" height={colBlockH}>
        {rows}
      </Box>
    );
  };

  const promptRow = st.prompt ? (
    <Input
      key="evidence"
      label="evidence:"
      placeholder="what proves this todo done (empty Enter cancels)"
      value={st.promptText}
      autoFocus
      submitLabel="complete"
      onInput={(v) => {
        const s = surface.state;
        if (s) surface.setState({ ...s, promptText: v });
      }}
      onSubmit={(v) => {
        const s = surface.state;
        const id = s?.prompt ?? null;
        const text = v.trim();
        if (s && id && text) {
          overrides.set(id, { done: true });
          surface.post({ t: 'todo.complete', id, evidence: text });
        }
        if (s) surface.setState({ ...s, prompt: null, promptText: '' });
      }}
    />
  ) : null;

  const dragIt = drag ? byId.get(drag.id) : undefined;
  const floating =
    drag && dragIt ? (
      <Box
        position="absolute"
        left={clamp(drag.x - 2, 0, Math.max(0, col - colW))}
        top={clamp(drag.y - 1, 0, Math.max(0, row - 2))}
        width={colW}
        backgroundColor={BRAND.working}
        flexDirection="row"
      >
        {mini(ownerPersona(ownerOf(dragIt), squadOf), true, 'dragmini')}
        <Box flexDirection="column" paddingLeft={1}>
          <Text wrap="truncate-end" color={BRAND.bg}>
            {(dragIt.content.replace(/\s+/g, ' ') + '  ').slice(0, Math.max(1, colW - 4))}
          </Text>
          <Text wrap="truncate-end" color={BRAND.bg}>
            {`${fmtAge(dragIt.id, now)}${dragIt.evidence ? ` ${glyph.star}` : ''}`}
          </Text>
        </Box>
      </Box>
    ) : null;

  return (
    <Box flexDirection="column" width={col} height={row}>
      <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Text color={BRAND.accent} bold>
          {`${glyph.hex} BOARD — kanban`}
        </Text>
        <Text dimColor>
          {`${snapshot.counts.done}/${snapshot.counts.total} done · phase ${snapshot.phase}${drag ? ' · dragging' : ''}`}
        </Text>
      </Box>
      <Text> </Text>
      <Box flexDirection="row" columnGap={1} height={colBlockH} flexShrink={0}>
        {pids.map((pid, ci) => columnOf(pid, ci))}
      </Box>
      <Text> </Text>
      <Box flexDirection="row" flexShrink={0}>
        {chips.map((c) => {
          const hov = drag?.hover;
          const hovered = hov?.kind === 'chip' && hov.name === c.name;
          const w = c.x1 - c.x0 + 1;
          return (
            <Box key={c.name} width={w} flexShrink={0} backgroundColor={hovered ? BRAND.focus : undefined}>
              <Text color={hovered ? BRAND.bg : personaColor(c.persona)} bold={hovered}>
                {`▸ ${c.name}`.padEnd(w).slice(0, w)}
              </Text>
            </Box>
          );
        })}
      </Box>
      {promptRow}
      {floating}
    </Box>
  );
}