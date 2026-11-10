# Colony routing enforcement (atlas 17.4.3)

Status: built and reviewed, released as 17.4.3 (2026-11-10); not observed in an installed plugin yet. Source: read-only audit by tmux team `td756e8`
(2 explorers, 1 completeness-critic), reports in `.atlas/.run/board/`.

## Overview

The audit measured the last 14 days in `~/.atlas/atlas.db`: 813 lead-level
in-process `Agent`/`Task` calls against at most 8 `atlas_mux.py spawn-team`
commands and 0 Workflow runs. The causes, each with its location:

1. No code classifies a prompt and hands the lead a team. `arm_orchestration`
   (`hooks/prompt_optimizer_core.py:507-560`) sets a flag and prints prose. The
   lead must remember to call `atlas_resolve.py`.
2. The tripwire only advises on a 2nd in-process dispatch
   (`hooks/dispatch_tripwire_core.py:388`, `:494-511`). Only a concurrent burst
   is denied.
3. Completion gate (p) counts in-process `atlas:` dispatches as "colony
   workers" and accepts any board note as channel use
   (`hooks/completion_gate_core.py:1341-1343`, `:2317-2348`).
4. The sidepanel ROUTE row ("decision model: class/effort -> seats -> model
   run", `mod/pane/sidebar-core.tsx:298`) draws only tmux team records
   (`mod/data/core.ts:383`), so it is empty or stale for nearly every run.

Shared rules for every section:

- The audit read a 16.4.2 checkout by mistake; this tree is 17.4.2. Line
  numbers below are hints only: locate code by symbol. If a behaviour a
  section asks for already exists here, say so on the channel, add only the
  missing test, and change nothing else.
- Edit only the files the section owns. Product source is `plugins/atlas/`.
- Proof first: add the failing test, see it fail, then change the code.
- Reuse what exists (the run-flag store, `atlas_resolve.resolve`,
  `contracts/scope-matrix.json` and its aliases, existing mod loaders). No new
  dependency, no new config file.
- Hooks stay fail-open: any exception in new code returns the old behaviour.
- "Working role" means any `atlas:` role except the closing roles `planner`,
  `verifier`, `completeness-critic`, `docs-curator`, `docs-auditor`.
- `ATLAS_TEAM_GATE=off` turns each new deny or block into an advisory.
- ASCII punctuation only in prose and messages.

## 1. `hooks/prompt_optimizer_core.py`

Add `classify_scope(prompt) -> (task_class, effort)`. Class: first match of
the class names and class aliases in `contracts/scope-matrix.json` against the
prompt words, default `implement`. Effort: `high` for whole-repo, audit-all or
many-surface wording, `low` for a single named file or symbol with a short
prompt, else `medium`. Mark it with a `ponytail:` comment naming the ceiling
(keyword heuristic) and the upgrade path (the local decision model).

`arm_orchestration` then calls `atlas_resolve.resolve` for that scope and puts
the result in the nudge it returns: the class and effort, each seat with its
model, and the exact next command. For a team with 2 or more working-role
seats the command is `atlas_crew.py run` (classes that write) or
`atlas_mux.py spawn-team` (read-only classes). For a single working-role seat
the nudge says one in-process `atlas:<role>` call with `SCOPE: <class>/<effort>`
is the right size. Keep the nudge under 700 bytes.

Store the resolved scope beside the existing run flag and expose
`resolved_scope(session_id, root) -> dict | None` (keys `task_class`, `effort`,
`working_seats`). Other hooks read it only through this function.

Test in `hooks/test_prompt_optimizer.py`: a multi-file build prompt yields a
nudge that names `atlas_crew.py run` and stores `working_seats >= 2`; a
one-symbol lookup prompt yields the single in-process form; a resolver
exception yields the old nudge.

## 2. `hooks/dispatch_tripwire_core.py`

Deny the 2nd in-process working-role `atlas:` dispatch of a run when the team
resolved from its `SCOPE:` line (or from
`prompt_optimizer_core.resolved_scope`) has 2 or more working-role seats and
tmux is on PATH. Deny code `dispatch_denied:team`. The message names the exact
`atlas_crew.py run` or `atlas_mux.py spawn-team` command for that scope. A run
starts at the user prompt that armed it; reuse the bookkeeping `_burst_note`
already keeps. Closing roles are never counted or denied. No tmux, or
`ATLAS_TEAM_GATE=off`: keep today's advisory.

A shell call (Bash or `ctx_shell`) whose command runs `atlas_mux.py
spawn-team` or `atlas_crew.py run` is a dispatch: it resets the inline-op
counter the same way an `atlas:` Agent call does. Observed on 2026-11-10: the
lead ran one team and one crew and still got `STOP - 4 inline ops, no
dispatch`. Test: after such a command the next inline op is op 1.

Test in `hooks/test_dispatch_tripwire.py`: 1st explorer allowed; 2nd explorer
30 s later denied with `dispatch_denied:team`; implementer then verifier
allowed; no tmux allowed with the advisory; `ATLAS_TEAM_GATE=off` allowed.

## 3. `hooks/completion_gate_core.py`

Gate (p) measures real colonies. `_colony_workers_dispatched` counts members
of tmux team and crew records for this session (live and archived under
`.atlas/.run/teams/`, crew run directories), not `dispatches` rows.
`_colony_channel_used` passes only on a board or IRC line written by one of
those members. Add the stop-time backstop for section 2: block when the run
made 2 or more in-process working-role dispatches (any agent type, not only
`atlas:%`) and no team or crew record exists for the session, unless tmux is
missing or `ATLAS_TEAM_GATE=off`. The block text names the count and the
spawn command. Update the gate docstring condition list.

Test in `hooks/test_completion_gate.py`: 2 in-process explorers and no team
record blocks; the same with a team record whose member wrote a board line
passes; a lead-only board note no longer satisfies (p); implementer plus
verifier in-process passes.

## 4. `mod/data/core.ts`

Owns `mod/data/core.ts`, `mod/data/core.test.ts`, `mod/pane/sidebar-core.tsx`,
`mod/pane/sidebar-core.test.ts`.

The ROUTE row and the offload figures must describe what the lead did. First
trace and write down in the test file header: every input of the ROUTE row,
whether `mod/fixtures/*` or `mod/data/live_fixture.ts` is reachable outside
tests, and what the pane draws with no team. Then:

- Each route row carries `transport`: `tmux` or `in-process`. If the mod
  already has a reader for in-process dispatches (worker cards, the dashboard
  API), feed those rows through it. If it has none, do not add a database
  reader: show the tmux rows and a plain line `in-process dispatches are not
  shown here`.
- With no rows the pane prints `no team this session`, never a previous
  session's team.
- Rename the label at `sidebar-core.tsx:298` to `route: class/effort -> seats
  -> model`. "Decision model" stays the name of the prompt classifier only.
- If a fixture is reachable in production, remove that path.

Check: `bun test mod/data/core.test.ts mod/pane/sidebar-core.test.ts` and
`npx tsc --noEmit -p mod` from `plugins/atlas`.

## Review outcome

Built and reviewed by a tmux review team on 2026-11-10; unreleased (17.4.3).

- Sections 1 to 4 are built as planned. `classify_scope` and `resolved_scope` are in `hooks/prompt_optimizer_core.py`; the `dispatch_denied:team` deny is `_team_note` in `hooks/dispatch_tripwire_core.py`; gate (p) rewrite and new gate (s) are in `hooks/completion_gate_core.py`; the ROUTE row changes are in `mod/data/core.ts`, `mod/pane/sidebar-core.tsx` and `mod/register.ts`.
- Found in review: `atlas_crew.py` wrote no session id into `run.json`, so gate (p) could not tell whose crew it was. `atlas_crew.py run` now writes `lead_session` (`--session`, else the first set of `CLAUDE_CODE_SESSION_ID`, `CLAUDE_SESSION_ID`, `ATLAS_SESSION_ID`, else an empty string), and the gate counts a crew only when it equals the session id. (p) and (s) skip team and crew worker sessions.
- Verification. A fresh verifier drove the real hook entry scripts in a temp root and confirmed claims 1 to 5 of the first fix round; it rejected the ROUTE claim. A second fix round followed and has unit-test evidence only:
  - the team deny is skipped once the run has launched a team or crew;
  - the deny text names scripts under the literal `${CLAUDE_PLUGIN_ROOT}/scripts/`, so its length does not depend on the install path;
  - `atlas_crew.py run` prints a `warning` field when no lead session id resolves;
  - `classify_scope` gives effort `low` only for a single file or symbol and one action verb;
  - in-process dispatches without a `SCOPE:` line show in ROUTE as class `-`, effort `-`, and `no team this session` prints only with no tmux rows and no dispatch rows.
- Limits. The audit and a first crew run were done on a stale 16.4.2 checkout and redone on 17.4.2. `classify_scope` is a first-match keyword heuristic: "do not audit, just implement x" classifies as audit. A lead can still declare `SCOPE: x/low` to stay in-process. Nothing here has been observed in an installed plugin in a live terminal.
- Open follow-ups are in `docs/ROADMAP.md` under "Atlas 17.4.3 follow-ups".
