#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: scripts/run_dictation_benchmark.sh /path/to/dictation-corpus.json [output-root]"
  echo
  echo "Set MINUTES_DICTATION_BENCHMARK_FEATURES=parakeet to include Parakeet when running from source."
  exit 1
fi

CORPUS_PATH="$1"
OUTPUT_ROOT="${2:-$HOME/.minutes/research/dictation}"

if [ ! -f "$CORPUS_PATH" ]; then
  echo "Corpus file not found: $CORPUS_PATH"
  exit 1
fi

FEATURES="${MINUTES_DICTATION_BENCHMARK_FEATURES:-}"
CARGO_ARGS=(run -p minutes-cli)

if [ -n "$FEATURES" ]; then
  CARGO_ARGS+=(--features "$FEATURES")
fi

if [ "$(uname -s)" = "Darwin" ] && command -v xcrun >/dev/null 2>&1; then
  SDK_PATH="$(xcrun --show-sdk-path 2>/dev/null || true)"
  if [ -n "$SDK_PATH" ]; then
    export CXXFLAGS="-I$SDK_PATH/usr/include/c++/v1 ${CXXFLAGS:-}"
  fi
fi

cargo "${CARGO_ARGS[@]}" -- apple-speech benchmark \
  --corpus "$CORPUS_PATH" \
  --out "$OUTPUT_ROOT" \
  --json
