# Apple-Native Transcription Coordinator Spike

## Summary

Recommendation:

- Do **not** replace the current helper-based Parakeet path immediately.
- Do create a single in-process `TranscriptionCoordinator` abstraction inside
  Minutes first.
- Keep the current helper-backed Parakeet implementation as the first
  coordinator backend.
- Only pursue a true Apple-native backend after the coordinator exists and the
  product surfaces already speak in terms of coordinator capabilities rather
  than helper-specific details.

This is the most grounded path because it improves product architecture now
without prematurely committing Minutes to a macOS-only implementation.

## What We Learned

### Current Minutes state

Minutes now has a materially better Parakeet story than it had before:

- structured helper contract in `minutes parakeet-helper`
- model-isolated installs plus persisted metadata
- engine-aware onboarding and readiness
- benchmark and warmup hooks
- explicit transcript cleanup pipeline
- broader regression coverage around Parakeet behavior

But the backend lifecycle is still scattered across several places:

- `crates/core/src/transcribe.rs`
- `crates/core/src/parakeet.rs`
- `crates/core/src/health.rs`
- `crates/cli/src/main.rs`
- `tauri/src-tauri/src/commands.rs`

That means preload, warmup, readiness, routing, diagnostics, and transcript
contract concerns are improved, but not yet owned by one runtime subsystem.

### What Muesli gets right

From `pHequals7/muesli`, the most useful ideas are architectural rather than
cosmetic:

- `MuesliCLI` has a clean JSON-first local contract.
- `TranscriptionRuntime.swift` centralizes preload, warmup, routing, VAD,
  cleanup, and shutdown.
- Settings treat backend/model choice as a first-class product surface.
- Transcript cleanup and runtime behavior are covered by explicit tests.

The key lesson is not "copy their app." The lesson is:

- transcription is treated as a product subsystem with an owner

That is the biggest remaining gap in Minutes.

## Benchmark Reality

Current local benchmark output from the existing helper path:

```json
{
  "ok": true,
  "command": "minutes parakeet-benchmark",
  "data": {
    "direct_elapsed_ms": 1468,
    "direct_segments": 3,
    "gpu": true,
    "helper_elapsed_ms": 4781,
    "helper_segments": 3,
    "model": "tdt-600m"
  }
}
```

Interpretation:

- The helper path works.
- The helper path is not free.
- The exact numbers are noisy and should not be overfit; debug vs release builds
  and cold vs warm runs change the absolute overhead materially.
- The benchmark is useful, but it is not yet enough on its own to justify a
  full native rewrite.
- What it *does* justify is getting runtime ownership under one coordinator so
  backend swaps become a contained decision rather than a repo-wide refactor.

## Recommended Coordinator

Create a coordinator that owns:

- backend readiness
- model install metadata and active selection
- preload / warmup
- transcription routing by content type
- transcript cleanup pipeline
- runtime diagnostics snapshot
- benchmark hooks

Possible interface:

```rust
pub struct TranscriptionRequest {
    pub audio_path: PathBuf,
    pub content_type: ContentType,
    pub language: Option<String>,
}

pub struct TranscriptionSnapshot {
    pub backend: String,
    pub model: String,
    pub ready: bool,
    pub warm: bool,
    pub details: serde_json::Value,
}

pub trait TranscriptionBackend {
    fn id(&self) -> &'static str;
    fn status(&self, config: &Config) -> Result<TranscriptionSnapshot, MinutesError>;
    fn warmup(&self, config: &Config) -> Result<serde_json::Value, MinutesError>;
    fn transcribe(
        &self,
        request: &TranscriptionRequest,
        config: &Config,
    ) -> Result<TranscribeResult, MinutesError>;
}
```

Coordinator responsibilities:

- expose a single readiness/status contract to CLI and Tauri
- isolate backend-specific setup differences
- ensure transcript cleanup happens in one place
- give future native backends a stable plug-in point

## What It Would Replace

The coordinator should gradually absorb or front:

- helper/direct Parakeet selection in `transcribe.rs`
- ad hoc readiness logic in `health.rs`
- duplicated Parakeet readiness/status shaping in Tauri commands
- helper-specific warmup branching in desktop commands
- backend-specific JSON surfacing in the CLI

What it should **not** replace yet:

- current helper implementation itself
- the existing Parakeet install layout
- current transcript cleanup functions

Those can become coordinator internals rather than being thrown away.

## Why Not Jump Straight to Native Apple

Because the biggest remaining problem is still architectural ownership, not
just backend implementation technology.

If we jump straight to a native Apple backend now, we risk:

- baking macOS-only assumptions into product surfaces too early
- carrying both helper and native code paths without a common owner
- underestimating maintenance and packaging complexity
- conflating "better runtime shape" with "must rewrite everything"

That would be architecture fantasy.

## Phased Plan

### Phase 1: Coordinator facade over existing backends

Build the coordinator and keep Parakeet helper-backed underneath it.

Success criteria:

- CLI and Tauri stop shaping backend state independently
- one status contract drives readiness and UI
- one warmup contract exists
- transcript cleanup runs through one runtime owner

### Phase 2: Apple-native backend spike behind the coordinator

Explore a macOS-only backend that can own:

- preload
- warmup
- chunked meeting transcription
- segment output with stable timestamps

without changing the public product contract.

Success criteria:

- measured cold/warm latency
- measured memory/power implications
- explicit comparison against helper-backed Parakeet
- clear keep/replace decision

## Final Recommendation

Build the coordinator first.

That is the highest-confidence next step because:

- it improves Minutes immediately
- it reduces future backend migration cost
- it keeps the current working Parakeet path valuable
- it avoids turning a promising macOS idea into a risky cross-cutting rewrite

If the coordinator goes well, then the Apple-native backend becomes a contained
backend experiment instead of a repo-wide gamble.
