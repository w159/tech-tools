// Golden rows for contracts/band-fixture.ts at 120 columns, tick 0 (plain text, trailing spaces trimmed). The Claude
// band (mod/band-golden.test.ts) and the omp mission panel (omp/mission-panel-golden.test.ts) both assert these exact
// rows, blank spacer rows included: the text comes from mod/mission-layout.ts, so the two harnesses print the same.
// A .ts module because the mod test host cannot read files. See band-fixture.ts for the row decisions.

/** Running: header, stepper, workers (running, then thinking), the newest message, the checks footer. */
export const golden: string[] = [
  " ◆ ATLAS   tech-tools@main  ·  implement/medium                                   1 of 6 tasks ━━━━━━━━━━━━━━━━   01:15",
  " ✓ research ─ ✓ theory ─ ✓ test ─ ⠋ implement ─ ○ verify ─ ○ done",
  "",
  " ⠋ explorer-1  explorer     Grep  src/auth                                                                        1m15s",
  " ⠋ impl-auth   implementer  thinking   last Edit auth/middleware.ts                                               1m10s",
  "",
  " impl-auth → lead-eed839   need a decision on the token ttl                                                       14:06",
  " checks  ✓ completion  ✗ tripwire  ✓ routing"
];

/** Idle: the run is closed, the stepper carries the last run, the core row follows (core-golden.ts), then the footer.
 * The Claude band adds its key buttons to the footer only when handlers are wired; the golden test wires none. */
export const idleGolden: string[] = [
  " ◆ ATLAS   tech-tools@main  ·  idle                                                       6 of 6 tasks ━━━━━━━━━━━━━━━━",
  " ✓ research ─ ✓ theory ─ ✓ test ─ ✓ implement ─ ✓ verify ─ ✓ done                  last run  3 workers · 1m31s · all ok",
  " contract  header 3/4   verdicts  1 verified · 1 refuted   offload  17.9k → 608 (30x)   route  verify/low ✓",
  " checks  ✓ completion  ✗ tripwire  ✓ routing"
];

// The stepper (row 2) at narrower widths, same fixture, spinner frame at tick 0: the widest form that fits. Full names,
// then three letters, then marks; the current step keeps its name. Below 80 columns the band folds to one row, so the
// tests draw the stepper alone (railRow on the band, railText on omp).
export const railGolden: Record<number, string> = {
  92: " ✓ research ─ ✓ theory ─ ✓ test ─ ⠋ implement ─ ○ verify ─ ○ done",
  56: " ✓ res ─ ✓ the ─ ✓ tes ─ ⠋ implement ─ ○ ver ─ ○ don",
  40: " ✓ ─ ✓ ─ ✓ ─ ⠋ implement ─ ○ ─ ○",
};
