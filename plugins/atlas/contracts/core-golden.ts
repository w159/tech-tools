// Golden core row for contracts/core-fixture.ts at 160 and 120 columns (plain text, trailing spaces trimmed), with
// header 3/4, 3 open gates and no todos. A .ts module because the mod test host cannot read files.
// Twins: mod/core-row.test.ts asserts it for the Claude band; the omp mission panel asserts the same strings.
export const coreGolden: Record<160 | 120, string> = {
  160: "  CONTRACT  hdr 3/4 ev - ✖3   VERDICT  1 claim · ✔ 1 verified · ✖ 1 refuted · ? 0 open · ⚠ 0 unchecked   OFFLOAD  17.9k→608 30x   ROUTE  verify/low sonnet ✔ +2",
  120: "  CONTRACT  hdr 3/4 ev - ✖3   VERDICT  ✔1 ✖1 ?0 ⚠0   OFFLOAD  17.9k→608 30x   ROUTE  verify/low → verifier sonnet ✔ +2",
};
