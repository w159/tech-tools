// Golden plain-text rows of the band for contracts/band-world.ts. HAND-REVIEWED LITERAL: round2/design/evidence/gen4.py does not cover the
// agents noun, the blocked count beside todo, or the `queued` word for a dispatched worker the host does not list, so these rows were
// rendered from the code and read against the design line by line (round2/after/truth.md, item 4).
// Mocha and Latte render the same text; only colours differ. Asserted on both hosts (mod/band-golden.test.ts, omp/mission-panel-golden.test.ts).

export const band_120: string[] = ["◖ ◆ ATLAS ◗  research  todo ███▍░░░░ 3/7 ■ 1 blocked  ctx 62%  agents ◐ 1 running  ■ 1 failed  ◇ 1 queued"];
export const band_120_rich: string[] = ["◖ ◆ ATLAS ◗  ● 1 plan  ──  ▸ 2 research  ──  ◇ 3 build  ──  ◇ 4 verify","","todo ██████▉░░░░░░░░░ 3/7 · 43%  ■ 1 blocked   ctx ██████▎░░░ 62%    agents ◐ 1 running   ■ 1 failed   ◇ 1 queued"];
export const band_80: string[] = ["◖ ◆ ATLAS ◗ todo 3/7 ■ 1 blocked · ◐ 1 running · ■ 1 failed · ◇ 1 queued"];
export const band_60: string[] = ["◖ ◆ ATLAS ◗ todo 3/7 · ◐1 ■1"];
export const band_40: string[] = ["◖ ◆ ATLAS ◗ todo 3/7 · ◐1 ■1"];
export const brand_120: string[] = ["◖ ◆ ATLAS ◗   ATLAS brand capsule, 120 columns", "", "ASCII fallback  [ATLAS]", "ASCII ribbon    [ATLAS] > TODO  -----"];
