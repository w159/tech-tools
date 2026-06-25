---
id: build-fix-loop
name: Build fix loop
category: build
cadence: interval
inputs:
  - build_command: how the build/CI runs (read from the project manifest, never invented)
  - log_source: where build output appears (CI logs, local output, a status endpoint)
  - fix_owner: who applies a fix once a failure is diagnosed (atlas:implementer in a session)
  - green_definition: the build passing cleanly end to end
---

# build-fix-loop

Watch a failing or flaky build, diagnose each failure as it surfaces, apply the fix, and re-run until green. Interval cadence because the build runs on the clock (or you poll CI on a timer) - each tick reads the latest result, and if red, you diagnose and fix before the next run. The loop ends when a clean build holds.

## Steps

1. **Run or poll.** Trigger `build_command`, or read the latest result from `log_source` if a build is already running. Route large logs through `context-mode`.
2. **Read the result.** If green and stable, you are done. If red, extract the first real failure (compile error, failing test, missing dep) - not a downstream cascade.
3. **Diagnose.** Localize the failure to the file/symbol that owns it with evidence. Distinguish a real break from infra flakiness (timeout, runner died) - the fix differs.
4. **Fix.** Hand the bounded change to `fix_owner`. Pull version-correct docs for any library involved before editing.
5. **Re-run next tick.** The interval re-triggers the build. Repeat until `green_definition` holds for a clean run. Before declaring the build green, confirm `green_definition` with an independent run of `build_command` in a fresh context (dispatch `atlas:verifier`) per atlas-engine law 5, rather than the fixing agent self-attesting the clean run.

## Stop condition

The build passes cleanly end to end (`green_definition`), held over at least one clean run; or a failure is blocked on a decision and reported.

## Template (interval /loop)

```
/loop 5m Run <build_command> (or read the latest from <log_source>). If green, stop and report a clean build. If red, extract the first real failure, localize it with file:line evidence, distinguish a real break from infra flakiness, apply the bounded fix, and let the next tick re-run. If blocked on a decision, stop and report.
```

Pick the interval from build duration (do not poll faster than a build takes). The fix step writes - gate before committing or pushing in a protected branch.
