# Setup and build

This reference owns the path from invocation to a launched app with log capture running.
All commands run through `bash`. Everything below is host-portable tooling: `xcodebuild`,
`xcrun simctl`, and plain file reads - no external AI CLI dependency.

Any failure before the app is visibly launched with log capture running is a **setup
blocker**: preserve its evidence under `.atlas/evidence/<YYYY-MM-DD>-<slug>/`, report it,
and stop later stages.

## 1. Detect the project

Search the repo (Glob/Grep, not guesses) for, in priority order:

1. `**/*.xcworkspace` (preferred over `.xcodeproj` when both exist)
2. `**/*.xcodeproj`
3. `Package.swift` - only counts if it declares an iOS destination (a `platforms:` line
   naming `.iOS`, or iOS products/dependencies; a pure macOS/visionOS package does not
   qualify)

A `Package.swift` project builds with `xcodebuild -scheme <scheme> -destination
'platform=iOS Simulator,...'` without a `-project`/`-workspace` flag. CocoaPods workspaces
(`Podfile` present) must build the `.xcworkspace`, never the `.xcodeproj`.

If discovery is materially ambiguous (multiple independent projects, no scheme resolvable),
ask ONE question naming the real candidates, then proceed. Record the discovered
project/scheme in the evidence dir's `summary.md`.

## 2. Discover schemes

```bash
xcodebuild -list -project <path>.xcodeproj        # or -workspace <path>.xcworkspace
```

`current` or empty selects the default/last-used scheme from this output. A named argument
must exist in the list; if it does not, report the available schemes and stop.

For `Package.swift`: `swift package dump-package` or `xcodebuild -list` from the package
root resolves schemes; if the package exposes no iOS-buildable scheme, that is a setup
blocker.

## 3. Choose and boot the simulator

```bash
xcrun simctl list devices available
```

Reuse an already-`Booted` compatible device when practical. Otherwise prefer the newest
available iPhone Pro model (CE's default was iPhone 15 Pro; pick the newest listed rather
than hardcoding a name) and boot it by UDID:

```bash
xcrun simctl boot <UDID>
# wait until ready (poll status, do not proceed on a guess):
xcrun simctl bootstatus <UDID> -b
```

Retain the UDID, device name, and OS version for the report.

## 4. Build

```bash
xcodebuild -project <proj> -scheme <scheme> \
  -destination 'platform=iOS Simulator,id=<UDID>' \
  -configuration Debug build
```

- Route the full output to `<evidence-dir>/build.log` and paste the **actual exit status**
  (`echo $?` or `set -o pipefail` capture) into the report, whatever it is.
- On failure: extract the error block from `build.log` (lines matching `error:`), report it
  verbatim with the exit code, and STOP. Do not install or launch a missing artifact.
- From a successful build, retain the built `.app` path and the bundle identifier:

```bash
xcrun simctl get_app_container <UDID> <bundle-id> app   # sanity-checks the install target
```

(If the build settings output is needed: `xcodebuild -showBuildSettings ... |
grep -m1 PRODUCT_BUNDLE_IDENTIFIER`.)

### Test-target variant

When the ask is to run the project's test target (unit or UI tests) instead of a manual
app walk:

```bash
xcodebuild -project <proj> -scheme <scheme> \
  -destination 'platform=iOS Simulator,id=<UDID>' \
  -configuration Debug test
```

`test` builds AND runs; the xcresult bundle and console output ARE the evidence. Route to
`build.log`, paste the exit status, and extract `Test Suite`/`Test Case` pass-fail lines.
A red test suite is a `FAIL` with the failing test names and their assertion output - not a
subjective judgment. (`-only-testing:<Target>/<TestCase>` narrows a rerun.)

## 5. Install, launch, start log capture

```bash
xcrun simctl install <UDID> <path-to-built-.app>
xcrun simctl launch console <UDID> <bundle-id> | tee <evidence-dir>/capture.log
```

`launch console` streams the app's stdout/stderr; that stream is the log capture. Keep it
running for the whole phase 2 walk (run it in the background per atlas's long-running
process rules, or re-launch with `console` attached when re-checking). Record the PID.

Only after launch is visible and capture is running does phase 2 begin.

## Evidence layout

```
.atlas/evidence/<YYYY-MM-DD>-<slug>/
  build.log        # full xcodebuild output + real exit status
  capture.log      # simulator console stream for the run
  <surface>.png    # one descriptively named screenshot per tested surface
  summary.md       # project, scheme, simulator, build result, per-surface table
```

The slug is filesystem-safe per the docs-SSOT naming rule (lowercase, `a-z 0-9 . _ -` only).
