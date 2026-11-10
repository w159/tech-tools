// Sidebar Channel view: a log of the board notes plus the message input. Colour only for state: a blocked note is amber
// and a handoff green, each beside its word; names are plain bold text.
import type { ClientElements, RenderElement } from 'claude-code';
import type { ChannelNote } from '../contract';
import { rowOf, type Segment } from '../runs';
import { TONE_HEX as T } from '../mission-layout';
import { fitText, textWidth } from '../theme';
import { liveWorkers } from '../data/live';
import { pad, type SidebarHandlers, type SidebarModel } from './sidebar-types';

const isLead = (n: string | undefined): boolean => !!n && (n === 'lead' || n.startsWith('lead-'));
const HANDOFF = new Set(['handoff', 'done']);

/** Direction/kind mark and its colour. Blocked and handoff notes override the direction arrows and carry their word. */
function markOf(n: ChannelNote): { t: string; color: string } {
  if (n.kind === 'blocked') return { t: '⚠ blocked', color: T.warn };
  if (n.kind && HANDOFF.has(n.kind)) return { t: `✓ ${n.kind}`, color: T.ok };
  if (isLead(n.owner)) return { t: '─▶', color: T.muted };
  return { t: !n.to || n.to === 'all' || isLead(n.to) ? '▶' : '↔', color: T.muted };
}

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function noteRow(els: ClientElements, n: ChannelNote, nickW: number, inner: number): RenderElement {
  const mark = markOf(n);
  const to = n.to && n.to !== 'all' ? `${n.to} ` : '';
  const parts: Segment[] = [
    ...(inner >= 50 ? [{ t: `${hhmm(n.ts)} `, color: T.muted }] : []),
    { t: pad(fitText(n.owner, nickW), nickW) + ' ', color: T.text, bold: true },
    { t: `${mark.t} `, color: mark.color },
    ...(to ? [{ t: to, color: T.muted }] : []),
    { t: n.text.replace(/\s+/g, ' '), color: T.text },
  ];
  return rowOf(els, parts, inner);
}

export function channelRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] {
  const s = m.snapshot;
  const notes = s.notes;
  const lastLead = notes.map((n) => isLead(n.owner)).lastIndexOf(true);
  const unread = notes.length - 1 - lastLead;
  // Host-spawned workers never join the board roster: a worker that is live counts as a person too.
  const live = liveWorkers(s, s.now).filter((w) => w.state !== 'done').map((w) => w.name);
  const nicks = new Set([...notes.map((n) => n.owner), ...s.members.filter((x) => !x.ended_at).map((x) => x.name), ...live]).size;
  const log = notes.slice(-Math.max(1, m.rows - 4));
  const nickW = Math.min(10, Math.max(4, ...log.map((n) => textWidth(n.owner))));
  const to = m.ui.recipient ?? 'lead';
  return [
    rowOf(els, [{ t: `#${s.channel ?? 'channel'}  `, bold: true, color: T.text }, { t: `${nicks} ${nicks === 1 ? 'person' : 'people'}${unread ? ` · ${unread} unread` : ''}`, color: T.muted }], inner),
    ...log.map((n) => noteRow(els, n, nickW, inner)),
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
