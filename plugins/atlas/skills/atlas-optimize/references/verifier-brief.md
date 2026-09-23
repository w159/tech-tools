# Verifier Brief: Re-measurement Parity

Dispatch template for the Phase 5 `atlas:verifier` Task, per `atlas-orchestrate/references/subagent-kit.md` (dispatch shape, named tools, finding-write requirement). The verifier's job is narrow: confirm the after-measurement was methodologically identical to the baseline and that the reported delta matches the captured evidence. It does NOT judge whether the code change is a good idea, and it does NOT re-run the benchmark on its own initiative (it MAY re-run the harness once to spot-check reproducibility, and if it does, it must use the exact recorded command).

Fill the placeholders, keep the structure:

```
ROLE: atlas:verifier - independent parity check on an optimization run's re-measurement.
GOAL: Confirm or refute that the after-measurement used methodology identical to the
baseline and that the reported delta matches the evidence on disk.
CONTEXT:
  Evidence dir: .atlas/evidence/<YYYY-MM-DD>-<slug>/  (baseline.log/json, after.log/json,
  delta.json, hypothesis.md, run.log, harness script)
  Reported classification: <improved | no measurable change | regressed>, delta <N units, P%>
  Baseline median <X>, spread <S>, n=<k>; after median <Y>, spread <S2>, n=<k>
TOOLS (required):
  ToolSearch first, ONE batched call, before any Read/Grep/Bash:
  ToolSearch("select:mcp__lean-ctx__ctx_compose,mcp__lean-ctx__ctx_search,mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_glob,mcp__serena__activate_project,mcp__serena__find_symbol,mcp__serena__find_referencing_symbols,mcp__plugin_context-mode_context-mode__ctx_execute")
  FIRST: activate_project(serena) on the project cwd.
  ctx_read for evidence files; ctx_execute for any spot-check re-run; ctx_search for the
  changed code sites.
NON-INTERACTIVE: "You cannot reach the user. Decide, state the assumption, and return the
deliverable."
CHECKS (each is a pass/fail with evidence):
  1. Parity table - walk all 8 rows of
     ${CLAUDE_PLUGIN_ROOT}/skills/atlas-optimize/references/measurement-protocol.md against
     baseline.json vs after.json (command, cwd, environment, warm-up, sample count,
     aggregation, metric extraction, machine state).
  2. Delta arithmetic - recompute median, spread, and percentage from the per-sample values
     in baseline.json and after.json; confirm delta.json and the reported numbers match.
  3. Noise-floor classification - confirm the classification (improved / no measurable
     change / regressed) is consistent with the baseline spread per the protocol.
  4. Immutability - the harness script and fixtures are unchanged between the two captures
     (compare against git, or the hashes if recorded); the only diff is the experiment's
     intended change.
  5. Optional spot-check (allowed, not required): re-run the harness once with the recorded
     command and confirm the sample lands inside the observed spread of its phase.
SUCCESS CRITERIA: every check has pass/fail plus a file:line or output quote; the overall
verdict is derivable from the checks alone.
OUT OF SCOPE: judging the code change's quality - proposing further optimizations -
editing any file - re-running more than one spot-check sample.
STOP CONDITIONS: evidence files missing or mutually inconsistent (after.json with no
baseline.json, per-sample arrays shorter than the recorded count) - halt and report
"evidence incomplete" rather than inferring.
REPORT BACK (final message only): verdict per check, overall verdict
confirmed/refuted/needs-evidence, and the evidence paths you relied on.
FINAL REQUIREMENT (verbatim): Write your verdict (PASS/FAIL plus evidence paths) to
.atlas/.run/findings.json before returning. A response without a findings.json write is
invalid.
```

After the verifier returns, re-read `.atlas/.run/findings.json` and confirm the verdict row exists and is not truncated. A FAIL verdict invalidates the delta: fix the parity violation it names and re-measure (Phase 4) before reporting anything.
