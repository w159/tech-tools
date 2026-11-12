// Golden rows for the shared world (contracts/band-world.ts, through contracts/world-live.ts) at 120 columns, tick 0 (plain text, trailing
// spaces trimmed). HAND-REVIEWED LITERAL: round2/design/evidence/gen4.py does not cover the worker table, the idle last-run row or the
// agents noun, so these rows were rendered from the code and read against the design line by line (round2/after/truth.md).
// The Claude band (mod/band-golden.test.ts) and the omp mission panel (omp/mission-panel-golden.test.ts) both assert these exact rows,
// blank spacer rows included: the text comes from mod/mission-layout.ts, so the two harnesses print the same.
// A .ts module because the mod test host cannot read files.
//
// The band itself (rev 4 tiers and the rich variant) is asserted against contracts/band-world-golden.ts, rows taken
// from the design evidence and driven by contracts/band-world.ts; `tierGolden` below names them for the parity tests.
import { band_120, band_120_rich, band_40, band_60, band_80 } from "./band-world-golden";

/** Running: the band, workers (failed and waiting first, then running, queued, done), the newest message, the checks footer. */
export const golden: string[] = [
  "◖ ◆ ATLAS ◗  ◐ working 0:42  todo ▰▰▰▱▱▱▱▱ 3/7 · ▲ 1 blocked  ctx 62%  agents ◐ 1 running  ■ 1 failed  ◇ 1 queued",
  "",
  " ■ implementer-live   failed   killed                                                                             01:35",
  " ◐ implementer-band   running  read runs.ts:17                                                                    00:42",
  " ◇ runner-land        queued                                                                                      00:00",
  " ● implementer-layout done     implementer finished                                                               05:51",
  " ● implementer-gates  done     implementer finished                                                               01:58",
  "",
  " implementer-layout to lead   sent a message                                                                      10:07",
  " checks  ● lint  ● test  △ doctor  2/3 green"
];

/** Idle with a failing check (`△ doctor`): the run is closed, every plan row done, the band reads a warning (never idle beside a failing check, and never BLOCKED unless Stop refused) and keeps the failed worker, the last run follows (it counts the failure
 * too), then the core row (core-golden.ts) and the footer. The Claude band adds its key buttons to the footer only when handlers are wired. */
export const idleGolden: string[] = [
  "◖ ◆ ATLAS ◗  ● done · 0:42   todo ▰▰▰▰▰▰▰▰▰▰ 7/7   ctx ▰▰▰▰▰▱▱▱ 62%   agents ■ 1 failed · △ 1 gate to check",
  " last run  1 worker · 42s · 1 failed",
  " verdicts  1 claim · 1 verified · 1 refuted · 0 open · 0 unchecked",
  " checks  ● lint  ● test  △ doctor  2/3 green"
];

/** The shared-world band at each tier (columns -> rows): 120 and 80 and 60 and 40, and the rich band at 120. */
export const tierGolden: Record<string, string[]> = { "120": band_120, "120-rich": band_120_rich, "80": band_80, "60": band_60, "40": band_40 };
