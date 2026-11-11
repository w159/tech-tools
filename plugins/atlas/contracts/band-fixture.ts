// Shared helper of mod/band-golden.test.ts (Claude band, mod/band.tsx) and omp/mission-panel-golden.test.ts (omp mission panel): both render
// the ONE world (contracts/band-world.ts, through contracts/world-live.ts) at 120 columns, tick 0, strip colour, trim trailing spaces, and must
// produce `golden` / `idleGolden` from band-golden.ts exactly. A .ts module because the mod test host loads only code files (no fs).
//
// There is no second fixture: the legacy `fx` world (explorer-1, impl-auth, phase 4/6) is gone, so no surface can count from it.
// Rows (mod/mission-layout.ts): the band line, a blank row, one row per worker (failed and waiting first), the newest message, the
// `checks` footer. Idle: the band reads `idle`, a `last run` row (failures kept), the core row (contracts/core-golden.ts), the footer.
//
// Excluded from the compared rows (shown in one harness only, see each test):
//   - Claude key buttons (`r: route ...`): drawn only while idle and only when handlers are passed; the test passes none.
//   - The board slot (the expanded todo list): both fixtures keep it folded.

/** Colour stripped, trailing spaces trimmed: what both golden tests compare. */
export const trimRows = (rows: string[]): string[] =>
  rows.map((r) => r.replace(/\s+$/, ""));
