# Test and report

This reference owns evidence collection after the app launches (or after the `test` target
finishes). Status derives from evidence, never from intent.

## Exercise the requested surfaces

Derive the key screens and flows from the user's request and the changed iOS surface. For
each one:

- Navigate through the running app and record what was exercised. Simulator interaction is
  plain `xcrun simctl` + tap/synthetic-event tooling through `bash`; where a surface needs
  scripted walkthrough depth, dispatch `atlas:ui-runtime-tester` per the SKILL.md
  delegation rules instead of hand-driving every step inline.
- Capture a descriptively named screenshot:

  ```bash
  xcrun simctl io <UDID> screenshot <evidence-dir>/<surface>.png
  ```

- Check expected content and controls render without visible error or broken layout.
- Read `capture.log` (and the system log when needed:
  `xcrun simctl spawn <UDID> log show --last 10m --predicate 'processImagePath CONTAINS "<app>"'`)
  for crashes, exceptions, error-level messages, and failed network requests attributable
  to the flow.

A simulated action reporting success is not proof of the expected state change; verify the
visible result (screenshot) or logs before the surface counts as exercised.

### SwiftUI inline Text links

Simulated taps do not trigger gesture recognizers on SwiftUI `Text` views with inline
`AttributedString` links because the link is not exposed as a separate accessibility
element. When such a tap reports success but has no visible effect, ask the user to tap the
link manually in the simulator. If the target URL is known, the direct fallback is:

```bash
xcrun simctl openurl <UDID> <URL>
```

Record which fallback supplied the verification; do not report the automated tap itself as
a pass.

## Human-only verification

Pause only when the scoped flow requires interaction simulator automation cannot complete:
Sign in with Apple, push delivery, sandbox purchase, camera/photos/location permission, or
the inline-link case above.

State the exact action and expected observation, then ask whether it worked. `PASS` requires
a completed passing outcome; `FAIL` records a completed failing outcome; `SKIP` is only for
a check with no completed outcome. An unanswered check is `SKIP` for that surface; with no
`FAIL` remaining it makes the overall result `PARTIAL`. Never silently mark an unanswered or
failed check as passed.

## Failure route

For a failed screen or flow, preserve its screenshot, the relevant `capture.log` lines, and
reproduction steps. Ask whether to investigate now or continue testing the remaining scope.
That routing choice does not change the observed `FAIL`.

- **Investigate now:** invoke `atlas-debug` with the failure evidence and simulator
  reproduction context. Narrow its authority to diagnosis plus any fix the user approves at
  `atlas-debug`'s informed-fix gate - no commit, push, or PR. Return here afterward; only an
  applied fix triggers rebuild + retest (`references/setup-and-build.md` from step 4). The
  replacement status derives from the completed retest evidence, confirmed by a fresh
  `atlas:verifier` dispatch that stamps `.atlas/.run/findings.json` via
  `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"`. Until that evidence exists,
  retain `FAIL` and continue the remaining scoped checks.
- **Continue without investigation:** retain `FAIL`, preserve the failure evidence in its
  notes, proceed with the rest of the scoped checks.

## Cleanup

Stop the log capture started by this run. Leave a simulator that was already booted as
found; a simulator booted only for this run may be shut down after evidence is saved:

```bash
xcrun simctl shutdown <UDID>
```

## Summary (fixed fields - omit none, even when zero)

Roll-up rule: any residual `FAIL` -> `FAIL`; otherwise any `SKIP` -> `PARTIAL`; else `PASS`.

```markdown
## Xcode Test Results

**Project:** <project or workspace>
**Scheme:** <scheme>
**Simulator:** <name> (<UDID>, iOS <version>)
**Build:** Success | Failed (exit <n>) - `xcodebuild ... build` output in build.log
**Screens tested:** <count>

| Screen or flow | Status | Evidence / notes |
|---|---|---|
| <name> | PASS / FAIL / SKIP | <screenshot path and observation> |

**Console errors:** <count and relevant errors from capture.log>
**Human verifications:** <count and outcomes>
**Failures:** <count and residual failures>
**Result:** PASS | FAIL | PARTIAL
```

For the test-target variant, replace the screen table with the `xcodebuild test` outcome:
suite/case counts, failing test names with assertion lines, the real exit status, and the
`.xcresult` path. The same roll-up rule applies (`xcodebuild` exit 0 + no skipped-scoped
checks = PASS).

Write `summary.md` into the evidence dir with this block, print it in the chat, and confirm
the run's verdict is recorded in `.atlas/.run/findings.json` (stamped by the verifier for
any post-fix retest; by the runner with status `verified` plus the pasted command output
for a clean first pass, or `needs-evidence` where a claim could not be independently
reproduced).
