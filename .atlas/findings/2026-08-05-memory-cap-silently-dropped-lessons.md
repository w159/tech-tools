# MEMORY.md's 4000-byte cap silently discarded every lesson since 2026-07-16

Date: 2026-08-05

## Problem

`atlas_memory.py`'s `WORKING_CAP_CHARS` was 4000 -- sized for a "quick note"
-- and the user's real `~/.atlas/memory/MEMORY.md` reached 4058 bytes within
about three weeks of normal use. Once the file exceeded the cap,
`atlas_memory.add()` returned `{"success": False}` for every subsequent
lesson, and `memory_capture.py` had no branch to handle that failure: the
lesson was simply dropped with no error surfaced anywhere. Every lesson
captured since 2026-07-16 was lost this way, invisibly.

## Fix

- `plugins/atlas/scripts/atlas_memory.py`: `WORKING_CAP_CHARS` raised
  `4_000 -> 20_000` (`atlas_memory.py:53`), sized for roughly a week or two
  of injected boot-context budget. When the cap is still hit, oldest entries
  now rotate into a dated archive file (`_archive_path`,
  `atlas_memory.py:76-79`: `<memory-dir>/archive/<NAME>-<YYYY-MM>.md`)
  instead of being rejected outright.
- `plugins/atlas/hooks/memory_capture.py`: added `_record_drop()`
  (`memory_capture.py:280-296`) and else-branches at both `atlas_memory.add()`
  call sites (`memory_capture.py:387,397`) so a lesson that still cannot be
  stored (e.g. a single entry larger than the cap) is recorded to
  `friction_events` (category `memory_drop`) and written to stderr, instead
  of vanishing without a trace.

## Evidence

- Forced-rotation test: 50 entries against the new cap produced 41 live +
  10 archived + 1 new, zero entries lost.
- The user's actual 4058-byte `MEMORY.md` gains a new entry cleanly under
  the new cap with the original content untouched.
- `atlas_doctor.py`'s `mine_memory_capture_silent_drop` miner (one of the 8
  registered in `MINERS`, `atlas_doctor.py:925-933`) reported this defect
  before the fix and reports no finding after.
- Full suite from `plugins/atlas`: `python3 -m pytest scripts hooks -q` -> 1042
  passed, 1 pre-existing unrelated failure.

## Do not regress

Any storage cap on a long-lived, append-only file must rotate or archive on
overflow, never silently reject -- and any write helper's failure path
(`success=False` or similar) must have a caller-side branch that surfaces or
records the drop. A cap with no error path is a silent-data-loss bug waiting
to happen.
