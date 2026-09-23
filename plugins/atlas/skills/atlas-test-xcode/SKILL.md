---
name: atlas-test-xcode
description: "iOS simulator test runtime. Detects an Xcode/iOS project (.xcodeproj/.xcworkspace/Package.swift with an iOS target), boots a simulator via xcrun simctl, builds and runs the app or its test target via xcodebuild, captures simulator screenshots and logs as evidence under .atlas/evidence/, and reports PASS/FAIL/PARTIAL per surface with the actual xcodebuild output and exit statuses pasted - never a claimed pass. Reports 'Xcode/simctl not available' explicitly on non-macOS hosts or missing toolchains instead of failing silently. Net-new for atlas: nothing else in the catalog touches iOS/Xcode."
when_to_use: test an iOS app or Xcode test target on a simulator before handoff
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: "[scheme name or 'current' for default]"
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

# atlas-test-xcode

Build and exercise an iOS app (or run its test target) on an iOS simulator, preserving
build output, screenshots, simulator logs, human-verification outcomes, and failures as
evidence for the user. This is the iOS analogue of `atlas-ux-test` for web apps; it is
genuinely net-new in the atlas catalog.

**Phase depth lives in references/ - both reads below are mandatory before the
corresponding phase. Do not substitute remembered tool names for them:**

| Phase | Read | Owns |
|---|---|---|
| 1. Detect + build + launch | `references/setup-and-build.md` | availability gate, project/scheme discovery, simulator boot, build, install/launch, log capture, evidence layout |
| 2. Exercise + report | `references/test-and-report.md` | per-surface evidence, human-only flows, failure routing, cleanup, fixed summary fields |

## Arguments

`$ARGUMENTS` is a scheme name, or `current` (default) for the default/last-used scheme.
An empty argument behaves as `current`. Scope for phase 2 (which screens/flows to
exercise) comes from the user's request and the changed iOS surface, never invented here.

## Availability gate (before any other step)

Xcode, its command-line tools, and a macOS host are hard prerequisites. Run, via `bash`:

```bash
uname -s && xcodebuild -version && xcrun simctl help >/dev/null 2>&1 && echo SIMCTL_OK
```

If the host is not Darwin, or `xcodebuild`/`xcrun simctl` are missing or error (including
the "command line tools are not installed" prompt), STOP. Report exactly what is missing
with the failing command output, and state the fix (install Xcode / `xcode-select --install`)
as a setup blocker. Never degrade to "assuming it would pass". Testing never authorizes
installing the toolchain for the user.

## What this skill owns vs. delegates

- You (the skill runner) execute the phase 1 mechanics directly through `bash` - simulator
  and build state is single-threaded host state; do not parallel-dispatch it.
- The phase 2 UI walkthrough (navigation taps, screenshot capture of each surface) MAY be
  dispatched to `atlas:ui-runtime-tester` via `Task` with a GOAL/DELIVERABLE/SUCCESS
  CRITERIA/OUT OF SCOPE/STOP CONDITIONS brief per
  `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`, when the
  surface list is large enough to warrant a subagent. Small runs may exercise inline. The
  dispatch must name `Bash` (for `xcrun simctl` capture commands) and the evidence directory
  to write.
- Any "passed"/"fixed"/"done" verdict on a fix that follows a failed run is confirmed by a
  fresh `atlas:verifier` dispatch - never by the runner grading its own retest. The verifier
  stamps its verdict via
  `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"` into
  `.atlas/.run/findings.json` (the only verdict ledger; do not invent a parallel run-state
  file).

## Boundaries

This skill tests and reports. It never edits app source. Diagnosis and a user-approved fix
belong to `atlas-debug`, invoked with the failure evidence; only an applied fix triggers a
rebuild + retest, and the replacement status is derived from that completed retest's evidence.
This skill has no commit/push/PR authority: it writes evidence under `.atlas/evidence/` and,
at most, appends a dated entry under `docs/` (CHANGELOG line + lessons) per the docs SSOT
(`${CLAUDE_PLUGIN_ROOT}/skills/atlas-loop/references/docs-ssot.md`). It never touches git remote
state.

## Hard rules

- **Exit status is the verdict.** Every pass claim carries the actual `xcodebuild`/`xcrun`
  command, its real exit code, and the relevant output lines. A missing pasted status is a
  failed run, not a formatting nit.
- **Simulated success is not proof.** A tap reporting success requires a screenshot or log
  line showing the expected state change before the surface counts as exercised.
- Per-surface status derives from evidence: `PASS` needs completed passing evidence, `FAIL`
  records observed failing evidence until a completed retest replaces it, `SKIP` means no
  completed outcome. Overall is `FAIL` while any failure remains, `PARTIAL` when no failure
  remains but a scoped check was skipped, else `PASS`.
- Evidence lands in `.atlas/evidence/<YYYY-MM-DD>-<slug>/` (date-first slug, filesystem-safe)
  the moment it is captured - screenshots, `build.log`, `capture.log`, and `summary.md`.

## Output

Print the fixed summary block from `references/test-and-report.md` (all fields, even when
zero/none), and point at the evidence directory. Before yielding, confirm a verified entry
exists in `.atlas/.run/findings.json` for the run (status `verified` or `needs-evidence` for
anything not independently reproduced).
