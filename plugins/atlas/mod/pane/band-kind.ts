// band-kind.ts: the band's run state for the side panel (wave 31, critique 29: `phase ● done` under a working band). The band owns the derivation (mission-layout runStateOf);
// this asks the band for it and never re-derives it. band.tsx exports `bandKindOf` (the model's runStateOf kind); until that export exists the state is read back from the
// word the band's own first row prints, which is what the owner sees. Pure: no host calls.
import type { ClientElements, RenderElement } from 'claude-code';
import * as band from '../band';
import type { BandModel } from '../band';

export type BandKind = 'working' | 'idle' | 'done' | 'blocked';

/** A stand-in for the host's elements that keeps the tree as plain data: `{ type, props, children }`. */
const recorder = (): ClientElements => new Proxy({}, { get: (_t, type: string) => (props: Record<string, unknown> = {}) => ({ type, props, children: props.children }) }) as unknown as ClientElements;

const textOf = (n: unknown): string => {
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) return n.map(textOf).join('');
  const c = (n as { children?: unknown } | null)?.children;
  return c === undefined ? '' : textOf(c);
};

const WORD = /\b(working|done|idle|blocked)\b/;

/** The first row of the band's tree: the capsule, the state glyph and word, the clock. */
function firstRow(b: BandModel): string {
  const tree = band.bandTree(recorder(), { ...b, maxRows: b.maxRows ?? 12 }) as RenderElement;
  const rows = (tree as unknown as { children?: unknown[] }).children ?? [];
  return textOf(rows[0]);
}

export function bandKind(b: BandModel): BandKind {
  const direct = (band as unknown as { bandKindOf?: (m: BandModel) => BandKind }).bandKindOf;
  if (typeof direct === 'function') return direct(b);
  const w = WORD.exec(firstRow(b))?.[1];
  return w === 'working' || w === 'done' || w === 'blocked' ? w : 'idle';
}
