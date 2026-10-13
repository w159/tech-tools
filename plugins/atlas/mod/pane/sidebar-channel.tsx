// Sidebar Channel view: an IRC-style log of the board notes plus the message input.
import type { ClientElements, RenderElement } from 'claude-code';
import type { ChannelNote } from '../contract';
import { rowOf, type Segment } from '../runs';
import { personaStyle } from '../sprites/api';
import { chartRoom as C, fitText, textWidth } from '../theme';
import { liveWorkers } from '../data/live';
import { pad, type SidebarHandlers, type SidebarModel } from './sidebar-types';

const isLead = (n: string | undefined): boolean => !!n && (n === 'lead' || n.startsWith('lead-'));
const HANDOFF = new Set(['handoff', 'done']);

/** Direction/kind glyph and its colour: blocked and handoff notes override the direction arrows. */
function markOf(n: ChannelNote): { t: string; color?: string } {
  if (n.kind === 'blocked') return { t: '⚠', color: C.warn };
  if (n.kind && HANDOFF.has(n.kind)) return { t: '✓', color: C.ok };
  if (isLead(n.owner)) return { t: '─▶', color: C.muted };
  return { t: !n.to || n.to === 'all' || isLead(n.to) ? '▶' : '↔', color: C.muted };
}

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function noteRow(els: ClientElements, n: ChannelNote, persona: (name: string) => string, nickW: number, inner: number): RenderElement {
  const mark = markOf(n);
  const to = n.to && n.to !== 'all' ? `${n.to} ` : '';
  const parts: Segment[] = [
    ...(inner >= 50 ? [{ t: `${hhmm(n.ts)} `, color: C.muted }] : []),
    { t: pad(fitText(n.owner, nickW), nickW) + ' ', color: personaStyle(persona(n.owner)).color, bold: true },
    { t: `${mark.t} `, color: mark.color },
    ...(to ? [{ t: to, color: C.muted }] : []),
    { t: n.text.replace(/\s+/g, ' ') },
  ];
  return rowOf(els, parts, inner);
}

export function channelRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] {
  const s = m.snapshot;
  const notes = s.notes;
  const lastLead = notes.map((n) => isLead(n.owner)).lastIndexOf(true);
  const unread = notes.length - 1 - lastLead;
  // Host-spawned workers never join the board roster: a worker that is live counts as a nick too.
  const live = liveWorkers(s, s.now).filter((w) => w.state !== 'done').map((w) => w.name);
  const nicks = new Set([...notes.map((n) => n.owner), ...s.members.filter((x) => !x.ended_at).map((x) => x.name), ...live]).size;
  const persona = (name: string): string => (isLead(name) ? 'lead' : s.squad.find((a) => a.name === name)?.persona ?? 'unknown');
  const log = notes.slice(-Math.max(1, m.rows - 4));
  const nickW = Math.min(10, Math.max(4, ...log.map((n) => textWidth(n.owner))));
  const to = m.ui.recipient ?? 'lead';
  return [
    rowOf(els, [{ t: `#${s.channel ?? 'channel'}  `, bold: true }, { t: `${nicks} nicks${unread ? `  ${unread} unread` : ''}`, color: C.muted }], inner),
    ...log.map((n) => noteRow(els, n, persona, nickW, inner)),
    els.Input({
      key: 'msg',
      label: `▸ to ${to}`,
      placeholder: 'message · Enter sends',
      value: m.ui.draft,
      onInput: (v: string) => on.draftChange(v),
      onSubmit: (v: string) => on.send(v),
    }),
  ];
}
