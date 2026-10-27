// Shared fixture: mod/band-golden.test.ts (Claude band, mod/band.tsx) and omp/mission-panel-golden.test.ts (omp
// mission panel) both render `fx` at 120 columns, tick 0, strip colour, trim trailing spaces, and must produce
// `golden` from band-golden.ts exactly. A .ts module because the mod test host loads only code files (no fs).
//
// Canonical text per row (the richer of the two twins wins, then both renderers follow it):
//   title    `◆ ATLAS  ·  mission control  ·  <project>@<branch>  ·  wave N  ·  <scope>` left, `◷ mm:ss   N live   ✖ N gates` right.
//            Mark `◆` (one cell), separator `  ·  ` everywhere, wave and scope both shown (Claude form), the open-gate
//            count joins the right side (omp form); a clean run shows `✔ gates`.
//   rail     identical already: `research ▶ theory ▶ ...`, past `✓ id`, current `◆ ID`, future `id`.
//   board    one collapsed todo row from the shared todo panels (parity covered by todo-tree-fixture).
//   lanes    `RUN` / `THINK` chips (a worker between calls reads THINK, tool and target dimmed), role character,
//            name, role, tool, target, elapsed bar, tool-call sparkline, age.
//   ticker   `#<lead>` chip then the last two notes as `hh:mm from -> to: text`.
//   footer   `tasks <bar> done/total` then one chip per gate group (`✔ completion`, `✖ tripwire`, `✔ routing`).
//
// Excluded from the compared rows (shown in one harness only, see each test):
//   - Claude hotkey footer buttons (`r: route ...`): rendered only when handlers are passed, the test passes none.
//   - Claude `ctx N%` stat: omp has no context-percent source; the fixture carries none.
//   - Lane spinners (character frames animate with tick): both tests render at tick 0.

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

/** Colour stripped, trailing spaces trimmed: what both golden tests compare. */
export const trimRows = (rows: string[]): string[] =>
  rows.map((r) => r.replace(/\s+$/, ""));
