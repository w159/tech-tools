// Shared fixture: mod/band-golden.test.ts (Claude band, mod/band.tsx) and omp/mission-panel-golden.test.ts (omp
// mission panel) both render `fx` at 120 columns, tick 0, strip colour, trim trailing spaces, and must produce
// `golden` from band-golden.ts exactly. A .ts module because the mod test host loads only code files (no fs).
//
// The text comes from mod/mission-layout.ts, which both adapters call, so parity is structural; the goldens pin it.
// Rows (docs/specs/2026-11-10_atlas-terminal-ui.md):
//   header   `◆ ATLAS   <project>@<branch>  ·  <scope>` left, `N of M tasks <bar>   mm:ss` right.
//   stepper  `✓ research ─ ✓ theory ─ ✓ test ─ ⠋ implement ─ ○ verify ─ ○ done`; the spinner is spin(tick).
//   workers  status mark, name, role (100+ columns), activity in words (`Grep  src/auth`, `thinking   last Edit ...`),
//            elapsed. Failed and waiting sort first.
//   message  `from → to   text   hh:mm`, the newest channel message only; the lead reads as `lead-<sid6>`.
//   footer   `checks  ✓ completion  ✗ tripwire  ✓ routing`.
//   idle     header reads `idle`, the stepper carries `last run  N workers · 1m31s · all ok`, the core row follows
//            (contracts/core-golden.ts), then the footer.
//
// Excluded from the compared rows (shown in one harness only, see each test):
//   - Claude key buttons (`r: route ...`): drawn only while idle and only when handlers are passed; the test passes none.
//   - The board slot (the expanded todo list): both fixtures keep it folded.

/** Local wall-clock 14:05 so `hh:mm` ticker stamps are timezone independent (both renderers print local time). */
const at = (min: number, sec = 0): number =>
  new Date(2026, 9, 26, 14, min, sec).getTime();

export const fx = {
  columns: 120,
  now: at(6, 15),
  project: "tech-tools",
  branch: "main",
  lead: "lead-eed839",
  wave: 1,
  scope: "implement/medium",
  phase: "implement",
  elapsedSecs: 75,
  workers: [
    // `active: true`: a tool is in flight (RUN). `false`: between calls (THINK), `tool` is the last one.
    {
      name: "explorer-1",
      role: "explorer",
      tool: "Grep",
      target: "src/auth",
      active: true,
      secs: 75,
      spark: [0, 0, 1, 0, 2, 1, 0, 3, 1, 2, 1, 2],
    },
    {
      name: "impl-auth",
      role: "implementer",
      tool: "Edit",
      target: "auth/middleware.ts",
      active: false,
      secs: 70,
      spark: [0, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 1],
    },
  ],
  todos: [
    {
      id: "t1",
      content: "map the auth flow",
      status: "completed",
      owner: "explorer-1",
    },
    {
      id: "t2",
      content: "edit auth middleware",
      status: "in_progress",
      owner: "impl-auth",
    },
    { id: "t3", content: "add ttl config", status: "pending" },
    { id: "t4", content: "cover token expiry", status: "pending" },
    { id: "t5", content: "run the suites", status: "pending" },
    { id: "t6", content: "update the docs", status: "pending" },
  ],
  notes: [
    { from: "lead", to: "explorer-1", text: "map the auth flow", ts: at(5, 5) },
    {
      from: "impl-auth",
      to: "lead",
      text: "need a decision on the token ttl",
      ts: at(6, 10),
    },
  ],
  gates: [
    { id: "completion", ok: true },
    { id: "tripwire", ok: false },
    { id: "routing", ok: true },
  ],
};

/** The idle variant: the wave finished 30 s ago (past the 15 s linger), every task done, the run closed. */
export const idleFx = {
  ...fx,
  phase: "done",
  todos: fx.todos.map((t) => ({ ...t, status: "completed" })),
  // Three workers from one wave: 91 s from first start to last finish.
  finished: [
    { name: "explorer-1", role: "explorer", startedAgoSecs: 121, endedAgoSecs: 30 },
    { name: "impl-auth", role: "implementer", startedAgoSecs: 118, endedAgoSecs: 30 },
    { name: "verifier-2", role: "verifier", startedAgoSecs: 115, endedAgoSecs: 30 },
  ],
  lastRun: { workers: 3, secs: 91, failed: 0 },
};

/** Colour stripped, trailing spaces trimmed: what both golden tests compare. */
export const trimRows = (rows: string[]): string[] =>
  rows.map((r) => r.replace(/\s+$/, ""));
