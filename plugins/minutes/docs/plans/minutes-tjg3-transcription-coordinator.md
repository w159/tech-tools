# minutes-tjg3: Transcription Coordinator and Apple-Native Backend Plan

## Why this exists

Minutes now has a much better Parakeet story than it did even a week ago. Long recordings are safer, diagnostics are better, release artifacts compile the feature in, and the desktop app no longer falls over on the kinds of real meetings that triggered the recent investigation.

That still does not mean transcription has a single owner in the product.

Right now, readiness, warmup, routing, diagnostics, transcript cleanup, and backend-specific behavior are spread across core, CLI, health, and Tauri surfaces. That makes every backend improvement more expensive than it needs to be. It also makes a future Apple-native backend feel larger and riskier than it should.

The goal of this plan is to fix the architecture first, then make the Apple-native backend a contained experiment instead of a repo-wide bet.

This follows the recommendation in `docs/designs/apple-native-transcription-coordinator-spike.md`.

## North star

Minutes should treat transcription as a product subsystem with a clear owner.

That owner should:
- know what backend is active
- know whether that backend is ready
- know how to warm it up
- own routing for meeting vs memo vs future streaming paths
- own diagnostics and benchmark snapshots
- expose one stable contract to CLI and Tauri

When that is true, experimenting with a macOS-native backend becomes a backend choice, not a product rewrite.

## What success looks like overall

Overall success for the epic means:
- product surfaces stop speaking in helper-specific terms
- backend readiness and warmup become one contract instead of several parallel ones
- diagnostics and benchmark output become stable enough to compare backends honestly
- current helper-backed Parakeet remains valuable and working
- the native macOS backend spike ends in a written keep-or-defer recommendation grounded in measurements

## Execution order

Recommended order:

1. `minutes-tjg3.1` Introduce `TranscriptionCoordinator` facade in core
2. `minutes-tjg3.2` Unify readiness, warmup, and backend status contracts
3. `minutes-tjg3.5` Add coordinator-level diagnostics and benchmark snapshots
4. `minutes-tjg3.6` Make backend and model capabilities first-class in product surfaces
5. `minutes-tjg3.7` Spike a macOS-native backend behind the coordinator

This order matters. The spike should not happen before the coordinator exists.

## Bead map

### minutes-tjg3.1
### Introduce `TranscriptionCoordinator` facade in core

Purpose:
- create the first real runtime owner for transcription

Scope:
- add a coordinator entry point in `crates/core`
- route the current helper-backed Parakeet path through it
- route transcript cleanup through coordinator-owned flow
- keep current observable behavior as stable as possible

Success:
- there is one coordinator entry point for batch transcription requests
- the coordinator can invoke at least the current helper-backed backend
- transcript cleanup is no longer stitched together in multiple caller layers
- CLI and Tauri call into coordinator contracts rather than backend-specific branches where practical

Done means:
- a maintainer can point to one runtime abstraction and say “this owns transcription now”
- current Parakeet behavior is not regressed
- tests still prove the current long-recording failure class stays fixed

### minutes-tjg3.2
### Unify readiness, warmup, and backend status contracts

Purpose:
- stop duplicating backend-state shaping across app surfaces

Scope:
- define one stable status payload for backend id, model, readiness, warm state, install metadata, and relevant diagnostics
- move Parakeet warmup/readiness logic behind that contract
- feed health, onboarding, and settings from the same source

Success:
- CLI, health, and Tauri no longer each invent their own Parakeet status language
- warmup and readiness become one concept with one schema
- adding a future backend does not require rethinking every desktop status view

Done means:
- a single status contract exists and is used across surfaces
- warmup can be triggered and reported consistently
- backend-specific setup details still exist internally but are not leaked all over the product

### minutes-tjg3.5
### Add coordinator-level diagnostics and benchmark snapshots

Purpose:
- make backend comparison honest and repeatable

Scope:
- define a stable diagnostics snapshot
- define a benchmark output that can compare helper-backed Parakeet against future native backends
- include cold vs warm timing and long-audio behavior

Success:
- maintainers can answer “is this actually faster or more stable?” without grepping ad hoc logs
- long-audio chunking behavior can be measured through one supported interface
- native spikes can be judged against the current path on speed, reliability, and power/memory behavior

Done means:
- benchmark and diagnostics output are stable enough to use in docs, issues, and regressions
- the current helper path is measurable in a way that future backends can match

### minutes-tjg3.6
### Make backend and model capabilities first-class in product surfaces

Purpose:
- make the architecture understandable to users, not just maintainers

Scope:
- improve wording and surface design in settings, onboarding, readiness, and related CLI output
- describe what the active backend can do and what setup it still needs
- avoid helper-specific wording in user-facing product copy

Success:
- the app can explain backend/model state in terms users can act on
- users are not forced to understand helper-specific implementation details
- coordinator and native backend work fit naturally into the product copy later

Done means:
- switching backends or missing setup yields clear guidance
- product language is capability-based instead of implementation-leaky

### minutes-tjg3.7
### Spike a macOS-native backend behind the coordinator

Purpose:
- learn whether the Apple-native route is genuinely worth it

Scope:
- build a contained macOS-native backend experiment behind the coordinator
- evaluate preload, warmup, chunked meeting transcription, and stable timestamped segment output
- compare against the helper-backed Parakeet path

Success:
- we get real measurements for cold and warm latency
- we understand memory and power tradeoffs
- we know whether output quality and timestamps are at least as good as the current helper path
- we leave with a keep-or-defer decision, not a vague “promising” conclusion

Done means:
- the spike has written results
- the recommendation is explicit
- the team can choose the next move without re-running discovery from scratch

## What we are not doing in this epic

Not in scope:
- a broad Swift rewrite of Minutes
- replacing all current backends immediately
- baking macOS-only assumptions into CLI or MCP product contracts
- polishing every product surface before the coordinator exists

## Suggested first move

The right first bead is `minutes-tjg3.1`.

If that bead lands well, the rest of the plan gets easier. If it lands poorly, that is a strong signal that a native backend spike would be premature.
