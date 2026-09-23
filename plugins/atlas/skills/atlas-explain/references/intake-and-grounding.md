# Intake and Grounding

Read before classifying the request or grounding any claim. The skill body owns interaction, delivery, and boundaries; this reference owns input classification and the evidence pass.

## Input shapes — exactly one per request

| Shape | Looks like | Evidence source |
|---|---|---|
| **Concept** | "how does X work", "why does Y happen", "explain the retry queue" | Current source + tests, traced call path |
| **Diff** | `diff:abc1234`, `diff:main..HEAD`, "what did the last commit do", "this change" | `git show`/`git log`, touched files, motivating docs |
| **Window** | `since:7d`, `since:v2.1.0`, "what did I do this week", "catch me up since Friday" | `git log` over the resolved range, touched files |
| **Plain-language target** (the `wtf` path) | blank (= your last message), a file path, a URL, pasted text, "the migration part" | Read the target; then explain it |

**The user's words decide the target.** For a plain-language request: nothing passed means your most recent message; a file path or link means read it first; a short pointer means only that part of the conversation. If the target is still unclear, ask one short question instead of guessing.

## Flag tokens

`diff:<ref>` and `since:<window>` force their mode when they read as flags. **A `word:value` pair is a flag only when it reads as one:** it leads the request or stands alone, carries no space after the colon, and — the decisive test — **the request still makes sense with it removed.** If stripping it would garble the sentence, it was prose.

- "walk me through the diff: why did we split the parser" — stripping `diff:why` garbles the sentence; this is prose. Classify by meaning, and never let the bogus ref `why` outrank it.
- `diff:main..HEAD` leading a request is a genuine flag: nothing is left to garble.
- A token with an empty value, or an unrecognized `word:word` token (including conventional-commit prefixes like `feat:`), passes through verbatim as request text.

**Tiebreak — concept vs diff:** when the request is plausibly both ("explain the retry logic we just added"), a concretely resolvable change wins: diff mode, with the concept as framing context.

**Window resolution:** resolve `since:monday` and "since last Monday" identically to a concrete date range and name that resolved range in the answer. Fall back to the last 7 days only when the request names no window at all — never silently substitute the default for a named window; if a named window cannot be resolved confidently, say what you used.

**Repo footprint:** a concept grounds in the repo only when it actually touches it. An external subject (a language feature, a paper, an interview topic) gets no repo grounding — do not force repo context into the answer.

## Grounding rules

**Never answer from memory.** Trace the actual path in this run. What you know about this codebase or framework from training is a hypothesis to check, not evidence.

### Concept: trace behavior

Follow the relevant trigger through its state changes, ownership boundaries, and effect. Inspect current source and the relevant tests; preserve the conditions and failure paths that matter to the requested use. One pass is enough when it can name those boundaries without hand-waving. When one pass cannot, split the question into one slice per ownership boundary and dispatch one explorer per slice (two minimum, four maximum; more means the question is still unscoped — narrow it and trace again). Dispatch the slices together in one message; reconcile overlap or contradiction between their reports by reading the source yourself. A gist is not the trace.

### Diff/window: resolve the subject first

Resolve the change (`git show <ref>`, `git log -- <path>`) or the window (`git log --since/--until`) before gathering any other evidence. Empty range or empty window: report the absence and finish — do not silently explain an adjacent thing, and use a substitute only if the request permits it or the user agrees, naming the substitution.

### Rationale (why questions)

Look for the decision record: motivating docs (`docs/decisions/`, `docs/architecture/`), code comments, commit messages, PR discussions, linked issues. Code shows behavior, not necessarily intent:

- **Documented** — a source states the reason. Cite it (`file:line` or commit sha).
- **Inference** — you derived it from evidence. Mark it explicitly as inference and show the supporting evidence.
- **Unknown** — the record is silent. Say so. A missing search result does not prove there was no reason.

Check whether a historical constraint still applies before presenting it as a current requirement. Contradictory sources: report the contradiction rather than picking a side silently.

### Depth and dispatch

- Trivial single-symbol lookups may run inline. Anything needing a real trace goes to `atlas:explorer` per `trace-dispatch.md`.
- When discovery surfaces more candidate files than the budget can read, use the rank-then-verify pattern in `${CLAUDE_PLUGIN_ROOT}/references/jev-patterns.md` via one `typesafe_decide` call to pick a reading order — a reading order, never a substitute for reading. Skip silently if typesafe is unavailable.
- Expand investigation to resolve material gaps, not to satisfy a source quota.
- No artifacts: evidence stays in the explorer's report and the chat answer. Do not write dossiers, run directories, or explainer files.