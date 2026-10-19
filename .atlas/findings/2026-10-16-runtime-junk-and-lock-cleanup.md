# Runtime junk, lock growth, stale board items, empty terminal/colony fixed (2026-10-16)

## Resolved issue

Seven separate runtime defects, all verified in the working tree (contract
test: 93 passed, 3 skipped):

1. **Junk scaffolding in `$HOME`.** `scaffold_docs.py` had created
   `~/.atlas/{archive,audits,decisions,evidence,graphify,nudge,self-improvement,understand-anything}/.gitkeep`.
2. **Lock file growth.** `worker_inbox.drain` created a `<worker>.json.lock`
   file for every idle worker with no cursor.
3. **Stale control-center tasks.** Manual board items were only archived
   when the Work tab opened, and a finished worker's dispatch item stayed
   open with no report.
4. **Empty Terminal panel.** `atlas_seats.agents()` returned only the
   picked backend's rows, so herdr panes vanished when rig was the picked
   backend (and vice versa).
5. **Empty colony view.** Dashboard colony handlers did not normalize a
   picked project path to its repo root, so a project pointing partway
   into a repo returned an empty member list.
6. **Mux reap.** Reap did not mark team members finished or leave the lead
   channel; `atlas_mux status` usage text was stale.
7. **Hook fault log pollution under pytest.** `atlas_faults.record` wrote
   to the real `~/.atlas/hook-faults.jsonl` during test runs (116 rows on
   2026-10-06 traced to tests).

## Root cause

Each defect is an independent gap, not one shared cause:

- (1) and the removed `.atlas/nudge/` directory: `scaffold_docs.py` had no
  guard against `$HOME` or a non-project root, and `.atlas/nudge/` was
  scaffolded for a hook that keeps its state in `~/.atlas/hookstate`
  instead, so the directory was dead weight.
- (2): `worker_inbox.drain` unconditionally wrote a lock file even when
  there was nothing to cursor.
- (3): the sweep only ran when a human opened the Work tab, and nothing
  closed a dispatch item on worker completion without an explicit report.
- (4): `agents()` picked one backend (`backend()`) and returned only its
  rows, instead of merging rig and herdr.
- (5): colony handlers used the raw picked project path without resolving
  it to the enclosing repo root.
- (6): reap never called the finish/leave path for team members.
- (7): `atlas_faults.record` had no pytest guard, so any test exercising a
  fail-open hook path appended to the real file.

## Fix

1. `scaffold_docs.py` refuses to run when the root is `$HOME` or lacks
   both a `.git` entry and a `docs/` dir
   (`plugins/atlas/skills/atlas-setup/scripts/scaffold_docs.py:480`).
   `.atlas/nudge/` removed from the scaffold, `session_boot` structure
   paths, and the gitignore seed; nudge hook state lives in
   `~/.atlas/hookstate`.
2. `worker_inbox.drain` no longer creates a lock file for an idle worker
   with no cursor (`plugins/atlas/hooks/worker_inbox.py`). Session boot
   prunes `.atlas/.run/inbox` and `.atlas/.run/autonames` files untouched
   for 7 days (`prune_run_state`,
   `plugins/atlas/hooks/session_boot_core.py:891-895`).
3. `atlas_todo.sweep` (`plugins/atlas/scripts/atlas_todo.py:699`) now runs
   on both Stop and SessionEnd (`ingest_session._sweep_todos`,
   `plugins/atlas/hooks/ingest_session.py:107`). A finished worker's
   dispatch item is closed via the new `atlas_todo.archive_item`
   (`:580`), called from `worker_report_gate_core.close_board_item`
   (`plugins/atlas/hooks/worker_report_gate_core.py:197-216`), which
   archives it as `worker_finished` even without a report.
4. `atlas_seats.agents()` returns the union of rig and herdr rows, deduped
   by `pane_id` (`plugins/atlas/scripts/atlas_seats.py:106-107`);
   `close_run` closes a run in every live source (`:128`).
   `atlas_rig.close_run` retries `rig down` with a throwaway tmux
   keepalive session when no tmux server exists, because `rig` misread
   "no tmux server" as "seat not confirmed gone" and refused with
   `deleteBlocked` (`plugins/atlas/scripts/atlas_rig.py:415-428`).
5. Dashboard colony handlers normalize the picked project to its repo
   root (`_repo_root`,
   `plugins/atlas/scripts/atlas_dash_colony.py:724`). The dashboard
   project list and `reap_tick` drop junk rows ($HOME, subdirs of other
   repos, `.claude/worktrees`, `~/.omp/wt`, the omp plugin cache,
   `~/.atlas/worktrees`) via `_junk_root`
   (`plugins/atlas/scripts/atlas_dashboard.py:715-718,2986-2993`).
6. Mux reap marks team members finished and leaves the lead channel;
   `atlas_mux status` usage names `--run|--team`
   (`plugins/atlas/scripts/atlas_mux.py`).
7. `atlas_faults.record` skips writing the real
   `~/.atlas/hook-faults.jsonl` when `PYTEST_CURRENT_TEST` is set and the
   resolved target path is the real file
   (`plugins/atlas/scripts/atlas_faults.py:65-72`).

## Evidence

- Live A/B on `/api/v2/agents`: installed 12.4.5 dashboard 0
  workspaces/0 panes vs source 3 workspaces/5 agent panes.
- Live A/B on `/api/v2/colony?project=<repo>/plugins/atlas`: installed
  empty vs source 16 members.
- Contract test suite: 93 passed, 3 skipped.
- Findings stamped `verified`: `JUNK-DIRS-2026-10-16`,
  `LOCK-GROWTH-2026-10-16`, `STALE-TODOS-2026-10-16`,
  `TERMINAL-PANEL-EMPTY-2026-10-16`, `EMPTY-COLONY-2026-10-16`,
  `MUX-REAP-2026-10-16`, `FAULTS-PYTEST-2026-10-16`
  (`.atlas/.run/findings.json`).

## Prevention

None of these had a regression test asserting the broken behavior before
this run; the contract suite now covers each fixed path (`atlas_seats`,
`atlas_dash_colony`, `atlas_todo`, `atlas_mux`, `atlas_faults`,
`scaffold_docs`, `worker_inbox`, `session_boot_core`, `ingest_session`,
`worker_report_gate_core` test modules under `plugins/atlas/{scripts,hooks}/`).

## Related issues

- `.atlas/findings/2026-07-17-atlas-canonical-structure-scaffolding.md`
  (prior scaffolding fix; this entry adds the `$HOME`/non-project-root
  refusal and removes `.atlas/nudge/`).

See `plugins/atlas/CHANGELOG.md` Unreleased and `docs/CHANGELOG.md`
Unreleased for the changelog entries; `docs/atlas-colony.md` and
`docs/atlas-workboard.md` for the updated behavior descriptions.
