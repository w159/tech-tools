// Golden core row for contracts/core-fixture.ts at 160 and 120 columns (plain text, trailing spaces trimmed), with
// 3 of 4 headers, 3 open gates and no todos. A .ts module because the mod test host cannot read files.
// Twins: mod/core-row.test.ts asserts it for the Claude band; the omp mission panel asserts the same strings.
// Open gates are not repeated here: the footer's `checks` row owns them (one fact, one place).
export const coreGolden: Record<160 | 120, string> = {
  160: " contract  3 of 4 headers   verdicts  1 claim · 1 verified · 1 refuted · 0 open · 0 unchecked   offload  17.9k kept, 608 back (30x)   route  verify/low ●",
  120: " contract  3 of 4 headers   verdicts  1 verified · 1 refuted   offload  17.9k kept, 608 back (30x)   route  verify/low ●",
};
