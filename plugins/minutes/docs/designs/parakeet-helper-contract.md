# Parakeet Helper Contract

## Goal

Replace the fragile human-oriented `parakeet.cpp` stdout contract with a
structured interface that Minutes can depend on safely.

## First implementation

The first implementation is a thin wrapper around `parakeet.cpp`, exposed as a
hidden Minutes CLI subcommand:

```bash
minutes parakeet-helper \
  --binary parakeet \
  --model-path /abs/model.safetensors \
  --audio-path /abs/audio.wav \
  --vocab-path /abs/tokenizer.vocab \
  --model-id tdt-ctc-110m \
  --gpu
```

The helper prints one JSON object to stdout and exits non-zero on failure.

## JSON shape

```json
{
  "raw_output": "human-readable parakeet.cpp output for debugging",
  "segments": [
    {
      "start_secs": 2.8,
      "end_secs": 3.92,
      "confidence": 0.54,
      "text": "Alright, let's test this out."
    }
  ],
  "transcript": "[0:02] Alright, let's test this out.\n"
}
```

Notes:
- `segments` are sentence-level grouped segments, not one word per line.
- `transcript` is the formatted Minutes transcript derived from those grouped
  segments.
- `raw_output` stays available for debugging and future parser work, but it is
  not the primary contract.

## Runtime behavior

- Minutes runtime prefers the helper path when the `minutes` CLI binary is
  available.
- If the helper cannot be resolved or fails unexpectedly, runtime falls back to
  the direct `parakeet` invocation path.
- `MINUTES_PARAKEET_HELPER_ACTIVE=1` prevents recursive self-invocation.
- `MINUTES_PARAKEET_FORCE_DIRECT=1` disables helper usage so direct-vs-helper
  comparisons remain possible.

## Why this is better

- isolates parser drift to one helper boundary
- gives the rest of Minutes a stable JSON contract
- makes future swaps easier:
  - dedicated helper binary
  - Rust FFI
  - native Apple backend

## Non-goals

- This does not yet remove the underlying dependence on `parakeet.cpp`.
- This does not yet implement a native Apple backend.
- This does not yet guarantee true warm-model reuse across transcriptions.
