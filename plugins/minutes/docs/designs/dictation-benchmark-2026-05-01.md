# Dictation Engine Benchmark - 2026-05-01

## Purpose

This is the benchmark gate for the dictation platform work. It exists so
Minutes does not switch dictation engines, enable vocabulary boosting, or claim
"types anywhere" from intuition alone.

The benchmark reuses the existing Apple Speech benchmark runner because that
path already compares:

- `SpeechTranscriber`
- `DictationTranscriber`
- Whisper
- Parakeet, when compiled/configured

The important change in this slice is making the corpus and output
dictation-specific: cases can now declare required terms and forbidden terms,
and result artifacts record term hits/misses plus a punctuation-sensitive WER
delta for each backend.

## Runner

Use:

```bash
scripts/run_dictation_benchmark.sh tests/eval/fixtures/dictation-benchmark-corpus.json
```

To include Parakeet when running from source:

```bash
MINUTES_DICTATION_BENCHMARK_FEATURES=parakeet \
  scripts/run_dictation_benchmark.sh /abs/path/to/private-dictation-corpus.json
```

Artifacts are written under:

```text
~/.minutes/research/dictation/<timestamp>/
```

Each run writes:

- `request.json`
- `results.json`
- `summary.md`

## Corpus Shape

The checked-in corpus at
`tests/eval/fixtures/dictation-benchmark-corpus.json` is a smoke fixture, not
the real promotion corpus. The private dogfood corpus should contain real local
dictation audio that cannot live in the public repo.

Each case supports:

- `id`
- `audioPath`
- `contentType`, normally `dictation`
- `locale`
- `referenceText` or `referencePath`
- `requiredTerms`
- `forbiddenTerms`

Recommended private cases:

- short command phrases
- multi-sentence prose
- terminal/code prompts
- names and project terms from `~/.minutes/vocabulary.toml`
- AirPods, built-in mic, and noisy-room samples
- at least one Linux sample before promoting Linux typing claims

## Metrics

Per backend, the JSON result records:

- `totalElapsedMs`
- `firstResultElapsedMs`, when the backend can report it
- `wer`
- `werPunctInsensitive`
- `punctuationWerDelta`
- `requiredTermsPresent`
- `requiredTermsMissing`
- `forbiddenTermsFound`
- transcript text
- status/error

The current runner is still file-based. It is a comparable proxy for engine
quality and latency, not a live hotkey benchmark. Live dictation insertion is
covered by the `TextInsertion` result states added in `minutes-posf`; a future
benchmark pass should add an app-driven smoke test that records copied, pasted,
typed, and failed insertion outcomes.

## Promotion Rules

No default engine switch unless:

- the candidate beats or matches Whisper on WER across the private dictation
  corpus
- first-result/final latency is visibly better or at least acceptable
- required terms do not regress
- forbidden terms do not appear
- punctuation quality is at least acceptable for prose cases

No vocabulary boost default unless:

- required names/terms improve or hold
- forbidden/common-name hallucinations stay clean
- results include the actual transcript text, not just scores

No "types anywhere" claim unless:

- live desktop smoke tests prove the overlay reaches `typed` for the target
  app/platform
- unverified automation is labeled `pasted`
- fallback is labeled `copied` or `copied instead`

