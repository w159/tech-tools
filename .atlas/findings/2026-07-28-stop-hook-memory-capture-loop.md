# Finding: Endless Stop-hook self-improvement loop burned a usage limit

## Date
2026-07-28

## Area
plugins/atlas/hooks/memory_capture.py, plugins/atlas/hooks/ingest_session.py,
plugins/atlas/hooks/auto_skill.py, plugins/atlas/hooks/nudge.py,
plugins/atlas/scripts/session_ingest.py

## Summary
A Claude Code session entered an endless Stop-hook loop and burned its usage limit. Every
turn the agent emitted a short message, the Stop hooks ran, and the same feedback
reappeared roughly every 13 seconds:

"[atlas] Self-improvement: captured 1 memory fact(s) and 0 project fact(s) from this
session..."

## Root Cause
Two independent defects compounded each other.

1. `memory_capture.py` was the only Stop hook with no throttle and no "already reported"
   state. Its `_should_capture()` counted rows in the atlas DB `signals` table, which never
   expire, so once a single `user_correction` signal existed it returned true on every
   subsequent Stop forever, and the hook wrote `hookSpecificOutput.additionalContext` every
   turn.
2. The announced fact string embedded `os.path.basename(cwd)`, which differs for each
   subagent working directory. The exact-string dedupe in `scripts/atlas_memory.py`
   `add()` never matched across differing cwds, so every re-capture reported success
   instead of being suppressed.
3. Separately, only `completion_gate.py` checked the `stop_hook_active` payload flag; the
   other four Stop hooks (`memory_capture.py`, `ingest_session.py`, `auto_skill.py`,
   `nudge.py`) ignored it, so a forced continuation Stop re-ran the full self-improvement
   pipeline instead of exiting early.
4. `session_ingest.py`'s `detect_signals()` ran its CORRECTION/ADMISSION regexes against
   any user-role transcript text with no filter. The hooks' own output could therefore be
   promoted into a durable `user_correction` signal: the CORRECTION regex matches
   "you never...", and the hooks emit "You NEVER edit the target codebase yourself." This
   fed defect (1) a permanent, self-generated signal to count.

## Fix Applied
1. Added a `stop_hook_active` early-exit guard to all four hooks that lacked it:
   `memory_capture.py:316-317`, `ingest_session.py:25`, `auto_skill.py:69`, `nudge.py:90`.
   Mirrors the existing pattern at `completion_gate.py:319-320`.
2. `memory_capture.py`: replaced the per-cwd formatted-string dedupe with a content-hash
   seen-marker. `_hash_key()` (`memory_capture.py:60`) hashes the raw signal snippet, not
   the per-cwd formatted fact string, so the varying cwd label can no longer defeat dedupe.
   Persisted at `~/.atlas/.memory_capture_seen`; already-seen facts are excluded from the
   `captured` dict before any output is built (`memory_capture.py:357`), so a fully-deduped
   batch exits silently.
3. `memory_capture.py`: added a 900-second throttle (`CAPTURE_WINDOW_SECONDS`,
   `memory_capture.py:25,44`) with a marker at `~/.atlas/.atlas_memory_capture`, mirroring
   `nudge.py`'s existing throttle pattern. `ATLAS_MEMORY_CAPTURE=off` kill switch preserved.
4. `session_ingest.py`: added `MACHINE_MARKERS` and `_is_machine_authored()`;
   `detect_signals()` now returns no signal for machine-authored text.
5. `session_ingest.py`: `_is_machine_authored()`'s first pass used a plain substring match
   on the `[atlas]` marker, which also swallowed ordinary human prose that happened to
   contain it (for example "the [atlas] plugin is broken, you never verified the fix").
   Narrowed to a per-line, start-anchored check:
   `any(line.lstrip().startswith("[atlas]") for line in text.splitlines())`. `"[atlas]"`
   was removed from the substring-anywhere `MACHINE_MARKERS` tuple, which now holds only
   `"hook feedback:"` and `"Self-improvement: captured"`. `NOISE_PREFIXES` and
   `_is_real_prompt` were untouched. Diff: 45 insertions, 0 deletions.
6. `session_ingest.py`: the line-start anchor from fix step 5 was still defeated by
   markdown-blockquoted hook output, since `lstrip()` strips whitespace but not markdown
   quote markers (a line like `> [atlas] Definition-of-done gate: ... you never ran the
   tests` was not suppressed). Fixed by adding `_QUOTE_PREFIX = re.compile(r"^[\s>]*")` and
   a helper `_strip_quote_prefix(line)` (`session_ingest.py:157-165`); `_is_machine_authored()`
   now applies `_strip_quote_prefix(line).startswith("[atlas]")` instead of
   `line.lstrip().startswith("[atlas]")` (`session_ingest.py:179-182`). The docstring was
   corrected so it no longer overclaims what is caught. `MACHINE_MARKERS` behavior,
   `NOISE_PREFIXES`, `_is_real_prompt`, and the `detect_signals` call site were untouched;
   `NOISE_PREFIXES` and `_is_real_prompt` confirmed byte-identical to HEAD. Diff: 66
   insertions, 0 deletions.

## Accepted Trade-off
`_is_machine_authored()` suppression is wholesale, by design, and pre-dates the blockquote
fix. Any message containing a machine marker anywhere is suppressed entirely, so a genuine
human correction that shares a message with pasted hook output is a false negative
(dropped, not recorded). This is deliberate, pinned by
`test_correction_wholesale_suppressed_when_sharing_a_message_with_hook_output`, and was
judged cheaper than a signal that never expires. This is an accepted cost, not an open gap.

## Evidence
- `memory_capture.py:316-317`, `completion_gate.py:319-320`, `ingest_session.py:25`,
  `auto_skill.py:69`, `nudge.py:90` -- guard present, confirmed by direct read.
- `memory_capture.py:60` (`_hash_key`), `:25,44` (`CAPTURE_WINDOW_SECONDS`), `:357`
  (seen-hash filtering before output) -- confirmed by direct read.
- `cd plugins/atlas/hooks && python3 -m pytest -q test_memory_capture.py
  test_ingest_session.py test_auto_skill.py test_nudge.py` -> `84 passed in 0.43s`
  (memory_capture 30, ingest_session 15, auto_skill 10, nudge 29), re-run and confirmed.
- New `MemoryCaptureLoopGuardTest` (`test_memory_capture.py:611`) fails against pre-fix
  code (regression test for this incident).
- Live subprocess proof: first hook invocation emits `hookSpecificOutput.additionalContext`,
  an identical second invocation emits nothing, exit 0.
- `session_ingest.py` fix: 94 passed; 3 of 4 new tests fail against pre-fix code; the real
  incident announcement string now yields `[]` from `detect_signals()`.
- `session_ingest.py` line-start narrowing: 97 passed in `test_session_ingest.py`; ruff
  clean; the four pre-existing filter tests still pass unmodified. Verifier probe confirmed
  real hook output still suppressed in five forms (plain, indented, buried on line 3, "Stop
  hook feedback:" prefixed, last line with no trailing newline), and confirmed genuine
  human prose naming the plugin now correctly mints a `user_correction` again; prefixes
  such as `[atlas-orchestrate]` and `[atlassian]` are correctly not suppressed because the
  anchor requires the closing bracket.
- `session_ingest.py` blockquote fix: 101 passed in `test_session_ingest.py`; ruff clean;
  66 insertions, 0 deletions. Pre-fix reproduction confirmed the bug (`detect_signals`
  returned `[('user_correction', 1.5, '> [atlas] Definition-of-done gate: ...')]`); post-fix
  it returns `[]`. Adversarial verifier probe: all blockquote forms suppressed (`>`, `>>`,
  `> >`, leading whitespace then `>`, `>` with no space, hook line buried on line 3 of a
  blockquoted paste, and the full real incident string); genuine human corrections still
  fire, including the two closest calls, "> means greater than, and you never explained
  that" and "> atlas plugin you never ran the tests" (no brackets); a 2000-space, 5000-char
  line caused no crash or slowdown since the anchored `[\s>]*` does not backtrack. Verifier
  closing verdict: the blockquote gap is closed without opening a false-positive hole.

## Resolution
Fixed and verified: the loop guard and dedupe on `memory_capture.py` (fix steps 1-3), the
machine-authored signal filter on `session_ingest.py` (fix step 4), the line-start
narrowing of the `[atlas]` marker match (fix step 5), and the blockquote-prefix fix (fix
step 6) have all shipped and been independently verified. No open gap remains from this
work. The wholesale-suppression trade-off (see Accepted Trade-off) is deliberate and
unchanged.
