// Sidebar gates view: one summary row per gate group (`✗ tripwire  2 failing`), expandable into its lines.
// Red and green mark state only, each beside its word.
import type { ClientElements, RenderElement } from 'claude-code';
import { groupOpenCount } from '../gates';
import { fitRuns, type Segment } from '../runs';
import { TONE_HEX as T } from '../mission-layout';
import { DONE_GLYPH, fitText, textWidth } from '../theme';
import { scrub } from './chrome';
import type { GateGroup, GateLine, SidebarHandlers, SidebarModel } from './sidebar-types';

const okMark = (ok: boolean): { g: string; color: string } => (ok ? { g: DONE_GLYPH, color: T.ok } : { g: '✗', color: T.bad });

/** A dimmed detail line under an expanded item. */
const noteLine = (els: ClientElements, text: string, cols: number): RenderElement =>
  els.Box({ flexShrink: 0, children: els.Text({ color: T.muted, children: fitText(`     ${text}`, cols) }) });

const WRAP_LINES = 2;
/** Greedy word wrap into at most `max` lines of `width` cells; the last line is cut with an ellipsis only if text is still left. */
function wrap(text: string, width: number, max = WRAP_LINES): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next) <= width) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = word;
  }
  if (cur) out.push(cur);
  if (out.length <= max) return out.map((l) => fitText(l, width));
  const kept = out.slice(0, max);
  kept[max - 1] = fitText(`${kept[max - 1]} ${out.slice(max).join(' ')}`, width);
  return kept;
}

function lineRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, ln: GateLine, cols: number): RenderElement[] {
  const key = `gate:${ln.id}`;
  const isOpen = m.ui.expanded === key;
  const mark = okMark(ln.ok);
  const parts: Segment[] = [{ t: `  ${mark.g} `, color: mark.color }, { t: scrub(ln.label), color: T.text }];
  const onPress = () => (isOpen && ln.fix ? on.copy(ln.fix) : on.toggle(key));
  const extra = isOpen ? [ln.detail, ln.fix ? `fix: ${ln.fix} (press to copy)` : undefined].filter((x): x is string => !!x) : [];
  const [first = '', ...more] = wrap(scrub(ln.label), Math.max(8, cols - 4)); // a long label wraps; it is never cut to its first word
  return [
    els.Button({ key, plain: true, onPress, children: fitRuns(els, [parts[0]!, { t: first, color: T.text }], cols) }),
    ...more.map((t) => noteLine(els, t, cols)),
    ...extra.map((t) => noteLine(els, scrub(t), cols)),
  ];
}

const groupOk = (g: GateGroup): boolean => groupOpenCount(g) === 0;
const groupKey = (g: GateGroup): string => `group:${g.id}`;
const oneLine = (t: string | undefined): string => (t ? scrub(t).replace(/\s+/g, ' ') : '');

/** `✗ completion  2 failing  <first fix>` / `✓ header  passing  <detail>`; an unavailable source says so instead.
 * A tail that does not fit the row wraps onto up to two muted rows below it, so the key words survive a narrow pane. */
function groupRow(els: ClientElements, on: SidebarHandlers, g: GateGroup, cols: number): RenderElement[] {
  const bad = groupOpenCount(g);
  const mark = okMark(groupOk(g));
  const first = g.lines.find((ln) => !ln.ok) ?? g.lines[0];
  const tail = g.error ? `unavailable: ${oneLine(g.error)}` : oneLine(bad ? first?.fix ?? first?.label : first?.detail);
  const headParts: Segment[] = [
    { t: `${mark.g} `, color: mark.color },
    { t: scrub(g.title), color: T.text },
    { t: bad ? `  ${bad} failing` : '  passing', color: bad ? T.bad : T.ok },
  ];
  const headW = headParts.reduce((n, p) => n + textWidth(p.t), 0);
  const fits = !tail || headW + 2 + textWidth(tail) <= cols;
  const press = () => on.toggle(groupKey(g));
  return [
    els.Button({
      key: groupKey(g), plain: true, onPress: press,
      children: fitRuns(els, fits ? [...headParts, { t: tail ? `  ${tail}` : '', color: T.muted }] : headParts, cols),
    }),
    ...(fits ? [] : wrap(tail, Math.max(8, cols - 5)).map((t) => noteLine(els, t, cols))),
  ];
}

/** The group is open while it or one of its lines is the expanded key. */
const groupIsOpen = (expanded: string | null, g: GateGroup): boolean =>
  expanded === groupKey(g) || g.lines.some((ln) => expanded === `gate:${ln.id}`);

/** One group: a summary row that opens into every line Button. */
function groupRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, g: GateGroup, cols: number): RenderElement[] {
  const isOpen = groupIsOpen(m.ui.expanded, g);
  return [...groupRow(els, on, g, cols), ...(isOpen ? g.lines.flatMap((ln) => lineRows(els, m, on, ln, cols)) : [])];
}

/** One row per gate group; Enter expands a group to all its lines. */
export function gateRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] {
  return m.gates.flatMap((g) => groupRows(els, m, on, g, inner));
}
