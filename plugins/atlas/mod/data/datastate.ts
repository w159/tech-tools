// datastate.ts: the three states a figure can be in when it is not a plain value, defined once for band, HUD and panel.
//   empty  no data yet (nothing has been read or recorded)
//   error  the read failed (the data may exist; we could not get it)
//   stale  the data is older than its refresh interval (shown with its age)
// Before this, a missing figure printed `unknown` or a bare dash at four sites and nobody could tell the three apart.

export type DataState =
  | { kind: 'ok' }
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'stale'; ageSecs: number };

/** The state of one figure. `failed` wins (a read that failed says nothing about age), then no value, then age against the refresh interval. */
export function dataStateOf(p: { has: boolean; failed?: boolean; ageSecs?: number; refreshSecs?: number }): DataState {
  if (p.failed) return { kind: 'error' };
  if (!p.has) return { kind: 'empty' };
  if (p.ageSecs !== undefined && p.refreshSecs !== undefined && p.ageSecs > p.refreshSecs) return { kind: 'stale', ageSecs: p.ageSecs };
  return { kind: 'ok' };
}

/** `45s`, `3m`, `2h`: an age in its shortest honest form. */
export function ageShort(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

/** The state in words, for a line of prose or a toast: `no data yet`, `read failed`, `stale 3m`; empty text for ok. */
export function dataWord(s: DataState): string {
  return s.kind === 'empty' ? 'no data yet' : s.kind === 'error' ? 'read failed' : s.kind === 'stale' ? `stale ${ageShort(s.ageSecs)}` : '';
}

/** The state in a table cell (5 cells or fewer): a dash, `err`, or the age with a `~` stale marker; empty text for ok. ASCII swaps the dash. */
export function dataCell(s: DataState, ascii = false): string {
  return s.kind === 'empty' ? (ascii ? '-' : '—') : s.kind === 'error' ? 'err' : s.kind === 'stale' ? `~${ageShort(s.ageSecs)}` : '';
}

/** M6: what a caller knows about how the gate and hook figures were read: the gate snapshot's age against its refresh interval (past it a figure is drawn `~` with its real age), and which read failed (drawn `err`, never the no-data dash). Absent: nothing is known, so nothing is marked. */
export type ReadInfo = { ageSecs?: number; refreshSecs?: number; failed?: { gates?: boolean; hooks?: boolean; /** the core tab's recorded routes */ routes?: boolean } };
