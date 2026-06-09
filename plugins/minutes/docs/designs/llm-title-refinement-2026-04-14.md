# LLM Title Refinement — 2026-04-14

## Goal

Add a core-pipeline title refinement step that uses the same LLM engine selection as summarization, then falls back safely to the existing algorithmic title generation when LLM output is unavailable or low quality.

This addresses meetings that currently land as `Untitled Recording` even when summarization already extracted rich structure such as decisions, action items, commitments, and entities.

## Approach

1. Keep the existing `generate_title` path as the baseline fallback.
2. After summarization completes, build a compact title-refinement prompt from:
   - formatted summary text
   - key points
   - decisions
   - action items
   - commitments
   - extracted entity labels
3. Call a new `summarize::refine_title(...)` helper that reuses the same engine/provider routing as `summarize.rs`:
   - `auto` → detect installed agent CLI
   - `agent` → configured agent command
   - `claude` → Anthropic API
   - `openai` → OpenAI API
   - `mistral` → Mistral API
   - `ollama` → local Ollama
4. If the LLM returns an acceptable title, apply it after the markdown write/rewrite by calling `markdown::rename_meeting(...)`.
5. If the LLM errors, times out, returns empty output, or produces a low-quality title, keep the existing pipeline title unchanged.

The title-apply step is shared by both summary-enabled paths:

- direct processing pipeline (`process_with_progress_and_sidecar`)
- background enrichment pipeline (`enrich_transcript_artifact`)

## Prompt

System/user prompt body used for title refinement:

```text
You create concise meeting titles.

Given a meeting summary plus extracted structured content, produce a concise meeting title.

Requirements:
- Prefer 3-8 words when possible
- Be specific about the topic or outcome
- Avoid generic titles like "Meeting", "Call", "Recording", or "Untitled Recording"
- Return only the title text
- Do not include quotes, bullets, labels, or explanations
```

The structured input appended after the prompt includes:

- `SUMMARY`
- `KEY POINTS`
- `DECISIONS`
- `ACTION ITEMS`
- `COMMITMENTS`
- `PEOPLE`
- `PROJECTS`

## Quality Filter Rules

Accepted LLM titles are sanitized and then validated.

Sanitization:

- take the first non-empty line only
- strip leading labels like `Title:` / `Meeting title:`
- trim wrapping quotes, backticks, bullets, and trailing punctuation
- normalize repeated whitespace

Rejection rules:

- empty after sanitization
- longer than 80 characters
- fewer than 2 words or more than 12 words
- exact generic titles such as:
  - `meeting`
  - `recording`
  - `call`
  - `memo`
  - `sync`
  - `untitled`
  - `untitled recording`
- titles made entirely of generic meeting words / stopwords

When rejected, the pipeline uses the existing algorithmic title unchanged.

## Explicit Title Behavior

If the user already provided an explicit title, LLM title refinement is skipped and the existing title is preserved.

This guard is threaded through the background pipeline context so job-based enrichment does not silently override an already chosen title later.

## Logging

Each summary-enabled pipeline run now emits a structured `log_step` entry with:

- `step = "title_generation"`
- `duration_ms`
- `extra.outcome = "llm" | "fallback" | "error"`
- `extra.model`
- `extra.input_chars`

Additional debug-friendly fields may include:

- `extra.title`
- `extra.output`
- `extra.detail`

## Test Coverage

Added/updated coverage in `crates/core/src/pipeline.rs` for:

- LLM success path updates title and renames the file
- LLM failure path falls back to the existing title
- low-quality LLM title is rejected and falls back
- algorithmic fallback still works standalone

Existing `generate_title` tests remain in place to protect the pre-LLM fallback behavior.
