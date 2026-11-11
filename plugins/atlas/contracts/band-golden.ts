// Golden rows for contracts/band-fixture.ts at 120 columns, tick 0 (plain text, trailing spaces trimmed). The Claude
// band (mod/band-golden.test.ts) and the omp mission panel (omp/mission-panel-golden.test.ts) both assert these exact
// rows, blank spacer rows included: the text comes from mod/mission-layout.ts, so the two harnesses print the same.
// A .ts module because the mod test host cannot read files. See band-fixture.ts for the row decisions.
//
// The band itself (rev 4 tiers and the rich variant) is asserted against contracts/band-world-golden.ts, rows taken
// from the design evidence and driven by contracts/band-world.ts; `tierGolden` below names them for the parity tests.
import { band_120, band_120_rich, band_40, band_60, band_80 } from "./band-world-golden";

/** Running: the band, workers (running, then thinking), the newest message, the checks footer. */
export const golden: string[] = [
  "◖ ◆ ATLAS ◗  implement · phase 4/6   todo █▋░░░░░░░░ 1 of 6   ◐ 2 running",
  "",
  " ◐ explorer-1  explorer     Grep  src/auth                                                                        1m15s",
  " ◐ impl-auth   implementer  thinking   last Edit auth/middleware.ts                                               1m10s",
  "",
  " impl-auth to lead-eed839   need a decision on the token ttl                                                      14:06",
  " checks  ● completion  ■ tripwire  ● routing"
];

/** Idle: the run is closed, the band reads done, the last run follows, then the core row (core-golden.ts) and the footer.
 * The Claude band adds its key buttons to the footer only when handlers are wired; the golden test wires none. */
export const idleGolden: string[] = [
  "◖ ◆ ATLAS ◗  idle · phase 6/6   todo ██████████ 6 of 6",
  " last run  3 workers · 1m31s · all ok",
  " contract  header 3/4   verdicts  1 verified · 1 refuted   offload  17.9k kept, 608 back (30x)   route  verify/low ●",
  " checks  ● completion  ■ tripwire  ● routing"
];

/** The shared-world band at each tier (columns -> rows): 120 and 80 and 60 and 40, and the rich band at 120. */
export const tierGolden: Record<string, string[]> = { "120": band_120, "120-rich": band_120_rich, "80": band_80, "60": band_60, "40": band_40 };
