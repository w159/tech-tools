// channel-chat.ts: the channel tab of the redesigned side panel (approved mockup `chat`): the channel as a chat. A header with the online count, a `today` divider, messages grouped under one header per sender (name bold in the role's colour,
// HH:MM:SS flush right on every message, body wrapped under a 3-cell indent, `from -> to` for a note to someone), centred dim system events, the user's own messages as right-aligned bubbles on the accent tint, a `<name> is typing` line, then the bordered input and the `@name` chips.
// The newest message stays visible: the log is cut from the top, never from the bottom. Pure: the compose row is a `compose` press the pane paints as the field (pane/sidebar-paint.tsx).
import { stateRun, type MarkState, type Run } from '../../design/atlas-ui';
import { tileOf } from '../../input/clickable';
import { roleOf } from '../../design/theme';
import { BLANK, nameOf, noteState, oneLine, r, type PanelLine, type PanelModel, type PanelNote, type PanelWorker } from './panel-shared';
import { clipUi, g, roleRun, row, usable, w } from './tab-kit';
import { channelLabel } from './panel-tabs';
import { bodyRows, hms, speakerColours, speakerHeader, userBlock } from './channel-bubbles';

const TYPING_MS = 10_000;
const isHuman = (from: string): boolean => /^(human|you|user)$/i.test(from);
const isLeadNote = (n: PanelNote): boolean => n.lead === true || /^lead(-[0-9a-f]{4,})?$/i.test(n.from);

type Item = { ms: number; idx: number; kind: 'msg' | 'event'; from: string; to?: string; text: string; nkind?: string; at: string; lead: boolean };

/** The channel's items in time order: its notes as messages, each worker's start and finish as a system event (a finish the worker already posted is left out). */
function itemsOf(m: PanelModel): Item[] {
  const posted = new Set(m.notes.filter((n) => n.kind === 'done' || n.kind === 'handoff').map((n) => n.from));
  let last = 0;
  let idx = 0;
  const msgs = m.notes.map((n): Item => { last = n.ms ?? last; return { ms: last, idx: idx++, kind: 'msg', from: n.from, ...(n.to ? { to: n.to } : {}), text: oneLine(n.text), ...(n.kind ? { nkind: n.kind } : {}), at: n.at, lead: isLeadNote(n) }; });
  const starts = (m.starts ?? []).map((n): Item => ({ ms: n.ms ?? 0, idx: idx++, kind: 'event', from: n.from, text: 'dispatched', at: n.at, lead: false }));
  const finishes = (m.finishes ?? []).filter((f) => !posted.has(f.from)).map((n): Item => ({ ms: n.ms ?? 0, idx: idx++, kind: 'event', from: n.from, text: 'finished', at: n.at, lead: false }));
  return [...msgs, ...starts, ...finishes].sort((a, b) => a.ms - b.ms || a.idx - b.idx);
}

/** The name the TEAM list shows for a worker (nameOf), so a post and its worker's row read the same label; a sender that is no listed worker reads as posted. */
const labelOf = (m: PanelModel, from: string): string => ((x: PanelWorker | undefined) => (x ? nameOf(x) : from))(m.workers.find((x) => x.name === from));

const roleOfName = (m: PanelModel, name: string, lead: boolean): string => (lead ? 'orchestrator' : ((x: PanelWorker | undefined) => (x?.role && x.role !== 'unknown' ? x.role : roleOf(undefined, name)))(m.workers.find((x) => x.name === name)));

type Block = PanelLine[];
function blocks(m: PanelModel, items: readonly Item[]): Block[] {
  const ui = m.ui;
  const U = usable(m);
  const out: Block[] = [];
  const colours = speakerColours(ui, items.filter((x) => !isHuman(x.from) && !x.lead).map((x) => x.from).concat(m.workers.map((x) => x.name)));
  for (const it of items) {
    if (it.kind === 'event') {
      const t = it.text === 'dispatched' ? [r('lead dispatched ', 'muted'), r(labelOf(m, it.from), 'sub')] : [r(labelOf(m, it.from), 'sub'), r(' finished', 'muted')];
      const runs = [r(g(ui, '⇢', '->') + ' ', 'muted'), ...t, ...(hms(it.at) ? [r(`  ${g(ui, '·', '|')}  ${hms(it.at)}`, 'dim')] : [])];
      const pad = Math.max(1, Math.floor((U - w(runs)) / 2) + 1);
      out.push([BLANK, { runs: [r(' '.repeat(pad)), ...runs] }]);
      continue;
    }
    if (isHuman(it.from)) {
      out.push(userBlock(ui, U, it.text, it.at));
      continue;
    }
    // One header per message (no grouping): every message row carries its own HH:MM:SS and, for a note to someone, `-> recipient`.
    const st = noteState({ at: it.at, from: it.from, ...(it.nkind ? { kind: it.nkind } : {}), text: it.text });
    const tone = st.state === 'failed' ? 'bad' : st.state === 'blocked' ? 'warn' : 'text';
    const mark: Run[] = st.state ? ((mk) => [{ ...mk, t: `${mk.t} `, ...(st.state === 'done' ? { bold: true } : {}) }])(stateRun(st.state as MarkState, ui)) : [];
    const to = it.to && it.to !== 'all' && it.to !== it.from ? it.to : undefined;
    const name = it.lead ? 'lead' : labelOf(m, it.from);
    out.push([BLANK, speakerHeader(ui, U, name, colours.get(it.from), to, it.at, it.lead), ...bodyRows(ui, U, it.text, tone, mark)]);
  }
  return out;
}

/** The members a message can be addressed to: the lead and every worker that is not finished. */
function recipients(m: PanelModel): string[] {
  const live = m.workers.filter((x) => x.state === 'running' || x.state === 'waiting' || x.state === 'blocked').map((x) => x.name);
  const names = ['lead', ...live];
  if (m.recipient && !names.includes(m.recipient)) names.push(m.recipient);
  return names;
}
/** The recipient chips, then the bordered input (five rows with the blank above). */
function footer(m: PanelModel): PanelLine[] {
  const ui = m.ui;
  const U = usable(m);
  const hint = m.recipient && m.recipient !== 'lead' ? `Message ${m.recipient}` : 'Message the lead, or @name an agent';
  const edge = (a: string, b: string): PanelLine => ({ runs: [r(' ' + g(ui, a, '+') + g(ui, '─', '-').repeat(Math.max(0, U - 2)) + g(ui, b, '+'), 'dim')], press: { kind: 'compose', key: 'compose:edge' } });
  const inner = Math.max(0, U - 2 - 3 - [...hint].length);
  const mid: PanelLine = { runs: [r(' ' + g(ui, '│', '|'), 'dim'), r(` ${g(ui, '›', '>')} `, 'accent', { bold: true }), r(clipUi(ui, hint, Math.max(4, U - 5)), 'muted'), r(' '.repeat(inner)), r(g(ui, '│', '|'), 'dim')], press: { kind: 'compose', key: 'compose' } };
  const tile = tileOf(ui);
  const active = m.recipient ?? 'lead';
  const chips: Run[] = [];
  const send = ui.ascii ? 'enter send' : '⏎ send';
  let used = 1;
  for (const name of recipients(m)) {
    const t = ` @${name} `;
    if (used + [...t].length + 1 > U + 1 - ([...send].length + 3) && chips.length) break;
    const on = name === active;
    chips.push(r(' '), { ...r(t, on ? 'ink' : 'sub', on ? { bg: 'accent', bold: true } : { ...(tile ? { bgHex: tile } : {}) }), press: `to:${name}`, hover: true });
    used += 1 + [...t].length;
  }
  const chipRow: PanelLine = { runs: [r(' '), ...chips, ...(U - used >= [...send].length + 3 ? [r(' '.repeat(U - used - [...send].length + 1)), r(send, 'muted')] : [])] };
  return [BLANK, chipRow, edge('╭', '╮'), mid, edge('╰', '╯')]; // the compose field is the last row of the pane
}

export function chatRows(m: PanelModel, room: number): PanelLine[] {
  const ui = m.ui;
  const U = usable(m);
  const items = itemsOf(m);
  const title = row(m, [r(channelLabel(m.channel), 'text', { bold: true })], [r(`${g(ui, '●', '*')} `, 'ok'), r(`${m.people} online`, 'ok')]);
  const foot = footer(m);
  const all = blocks(m, items);
  // typing: a running worker whose last call is under 10 s old
  const typer = m.now === undefined ? undefined : m.workers.find((x) => x.state === 'running' && x.calls?.length && m.now! - x.calls[x.calls.length - 1]! >= 0 && m.now! - x.calls[x.calls.length - 1]! < TYPING_MS);
  const typing: PanelLine[] = typer ? [{ runs: [r('   '), roleRun(nameOf(typer), roleOfName(m, typer.name, false), ui), r(' is typing ', 'muted'), r(g(ui, '\u2022\u2022\u2022', '...'), 'warn')] }] : [];
  const fixed = 3 + foot.length + typing.length; // title, blank, divider
  let keep = all.length;
  const rowsOf = (from: number): number => all.slice(from).reduce((n, b) => n + b.length, 0);
  if (room > 0) while (keep > 1 && rowsOf(all.length - keep) + fixed > room) keep--;
  const shown = all.slice(all.length - keep);
  const dropped = all.length - keep;
  const label = dropped ? `${g(ui, '↑', '^')} ${dropped} earlier` : 'today';
  const half = Math.max(1, Math.floor((U - label.length - 2) / 2));
  const divider: PanelLine = items.length
    ? { runs: [r(' '), r(g(ui, '─', '-').repeat(half) + ' ', 'dim'), r(label, 'muted'), r(' ' + g(ui, '─', '-').repeat(Math.max(1, U - half - label.length - 2)), 'dim')] }
    : BLANK;
  const log: PanelLine[] = items.length
    ? [...shown.flat(), ...typing]
    : [BLANK, row(m, [r('no messages yet', 'muted')], [], undefined, 1), row(m, [r('write to the lead below, or @name an agent', 'dim')], [], undefined, 1)];
  const body = [title, BLANK, divider, ...log];
  const pad = room > 0 ? Math.max(0, room - body.length - foot.length) : 0;
  return [...body, ...Array.from({ length: pad }, () => BLANK), ...foot];
}
