// band-kind.ts: the band's run state for the side panel (wave 31, critique 29: `phase ● done` under a working band). The band owns the derivation (mission-layout runStateOf,
// exported as band.bandKindOf); this asks the band for it and never re-derives it. Pure: no host calls.
import { bandKindOf } from '../band';
import type { BandModel } from '../band';

export type BandKind = ReturnType<typeof bandKindOf>;

export function bandKind(b: BandModel): BandKind {
  return bandKindOf(b);
}
