# Atlas injected-payload budget (2026-11-10, Atlas 17.4.1 tree)

Ask: measure the text atlas puts into the model's context automatically (hook `additionalContext`,
block `reason`, deny reasons, dispatch-prompt rewrites, mod prompt lines), then cut what is safe.
Every byte a hook returns stays in the conversation for all later turns, so the cost is bytes x
turns that follow.

## 1. Method

- Tool: `python3 plugins/atlas/scripts/bench_hooks.py --bytes [--show] [--root PLUGIN_ROOT]`. It runs
  each command bound in `hooks/hooks.json` once per payload, in a scratch git repo, and prints
  `model_bytes()` per hook: UTF-8 bytes of `reason`, `additionalContext` and
  `permissionDecisionReason`, plus the growth of a rewritten dispatch prompt, or the whole stdout when
  it is not JSON. `systemMessage` is user-facing and is not counted. Dispatch rows add a second line:
  `brief / board / advisory` bytes (the CHANNEL block, the `BOARD ITEM` line, the 2nd-dispatch
  advisory), so the brief is stated apart from the rest. The dispatch spec carries its own `REPORT:`
  line, so no default REPORT line is injected.
- Determinism: the child env is a whitelist (`PATH`, `LANG`, `LC_ALL`), not the caller's env, with
  `ATLAS_HOME`, `HOME`, `TMPDIR`, `ATLAS_DB`, `ATLAS_HOOKSTATE_DIR` and `ATLAS_CONTRACT_GATE_DIR` in a
  temp dir, `ATLAS_GATES=always` (a scratch dir is not a "real project", so the gates stay disarmed
  without it) and `ATLAS_BURST_SECS=99` (the 2nd-dispatch window must not depend on hook speed).
  Dispatch sessions get a random tag per run: the burst state is keyed by (root, session) and lives
  under `TMPDIR`, so a reused session id leaked the advisory or a concurrent deny between runs.
  The earlier irreproducible numbers (554, 1192) came from that leak and from the caller's
  `ATLAS_GATES`. `test_bench_hooks.py::BytesModeIsDeterministicTests` runs the real hooks twice and
  asserts identical output, a brief on every dispatch, and the advisory only on the 2nd dispatch.
  Two runs here, and one under `ATLAS_GATES=off ATLAS_MODE=solo ATLAS_MUX=off`, printed identical tables.
- Scenarios: the timing payload set, plus an orchestrating prompt, `grep -rn` and `git push --force`,
  an `atlas:explorer` dispatch, an `atlas:implementer` dispatch, the explorer returning then a second
  explorer dispatch inside the burst window, a SubagentStop, and a header-less final reply twice.
- Baselines. (a) Shipped: `git archive HEAD plugins/atlas` (17.4.1) run through the same bench. In
  17.4.1 the gate blocks a header-less reply once per session, so the 2nd header-less Stop costs 0.
  (b) The working tree before this change: it already re-blocked every header-less reply, with the
  1633-byte wording. Brief sizes in (a) are compared with the same script path (old and new
  `channel_brief` called with the same arguments): the HEAD extraction sits in a longer path, which
  inflates its bench rows by about 300 bytes.

## 2. Before and after (bytes the model receives)

| Surface | Emit site | Frequency | Before | After | Changed |
|---|---|---|---|---|---|
| SessionStart boot block | `session_boot_core.py` main | per session | 3039 (HEAD) | 2634 | no (diff is other uncommitted work in this tree) |
| `[atlas-orchestrate]` nudge | `prompt_optimizer_core.py` ENGINE_NUDGE | on arming | 333 | 159 | yes |
| Channel brief, read-only role (explorer) | `atlas_todo.channel_brief` | per dispatch | 2102 | 695 (bench 690) | yes, 33 percent |
| Channel brief, writer (implementer) | same | per dispatch | 2117 | 1916 (bench 1925) | yes |
| BOARD ITEM line | `_channel_dispatch` | per atlas dispatch | 22 | 22 | no |
| 2nd dispatch within the burst window, advisory | `dispatch_tripwire_core._burst_note` | per fan-out dispatch | 366 | 213 | yes |
| Concurrent dispatch deny | same | per denied dispatch | about 650 | about 650 | no (decision text; sized from the JSON output) |
| Unbounded-spec deny | `dispatch_tripwire_core._deny` | per denied dispatch | 1037 | 1037 | no |
| Gate (n), 1st header-less reply | `completion_gate_core._header_reason_part` | first block | 1671 (b: 1633) | 321 | yes |
| Gate (n), 2nd header-less reply, same session | same | each repeat | 0 (b: 1633) | 221 | yes |
| Gate, (n) with (i) open, first block | `_reason` | first block | 2037 (derived) | 1902 | yes |
| Gate, all conditions open | `_reason` | rare | 9222 (derived) | 9087 | only the (n) clause |
| Inline Edit `(m)` warning, Pre / Post | `event_dispatch` | per inline edit | 169 / 219 | 169 / 219 | no |
| `git push --force` advisory | `event_dispatch` | per call | 157 | 157 | no |
| SubagentStop report block | `worker_report_gate_core.py:370` | once per worker | 613 | 613 | no |
| Mod `reinforce` prompt line | `mod/register.ts` via `discipline.reinforceLine` | per prompt (mod) | 165 | 83 | yes |

"Derived" rows are the after size plus the 135-character difference between the old and new (n)
clause, rebuilt from the old format string. Measured and zero on the payloads used: PreToolUse
Bash/Read, PostToolUse Read/Bash, `format_after_edit`, `stop_tail` (72 bytes of `systemMessage`,
user-facing). `atlas_doctor --hook` printed 292 on HEAD and 0 now; that is other uncommitted work.

## 3. What changed

1. Channel brief (`atlas_todo.channel_brief(root, channel, lead, name, role="")`). Roles in
   `READ_ONLY_ROLES` (explorer, verifier, completeness-critic, docs-auditor, planner, db-prober,
   ui-runtime-tester) get the channel line, the precedence rule, one post command addressed to the
   lead, and the inbox command: no path claims, conflict checks, handoff or todo lines. Every brief
   starts with "The lead's dispatch prompt wins over this brief." Writer roles keep claim and
   conflict lines; the handoff line points at the Post command instead of repeating it.
2. 2nd-dispatch advisory: names `atlas_mux.py spawn-team` and points at the SessionStart team flow
   for the full command, instead of printing the absolute command a second time. The advisory fires
   on exactly the parallel fan-out case. The concurrent deny keeps its full command (it is a decision
   text and fires on the same dispatch that has no SessionStart context to hand).
3. Gate (n). First block: template, phase ids (glyphs dropped, SessionStart has them), re-send
   instruction, no done-gap footer (the footer is about unwritten records). Repeat in the same
   session: one line with the template, using the existing `seen-<letter>` marker (before, (n) was
   excluded from it). (n) still blocks every header-less Stop up to the loop cap; only wording changed.
4. Mod `reinforce`: carries `headerTemplate` from the operating contract instead of the 92-character
   regex. `Contract.headerTemplate?` is optional in `mod/contract.ts`, `types/index.d.ts` and
   `mod/data/personas.ts`; without it the line says "the ATLAS status header" (a contract test forbids a
   second literal copy of the template).
5. Orchestrate nudge shortened to the action: skill name and "dispatch wave 1".

## 4. Pinned by tests (essentials, not prose)

- `test_atlas_channels.py::test_read_only_brief_has_post_and_inbox_but_no_claims`: per read-only
  role, `note`, `--to <lead>`, `inbox`, the precedence line; no `conflicts`, `claim-paths`,
  `release-paths`, `REQUIRED`; under half the writer brief. The writer keeps the claim lines.
- `test_dispatch_tripwire.py` (sequential-dispatch advisory test): `spawn-team`, `tmux panes`, under 260.
- `test_completion_gate.py::ContractVisibilityTest`: first (n) reason has the template, phase ids,
  "re-send", no footer, under 520 characters; the repeat has the template, under 260.
- `test_prompt_optimizer.py`: nudge names the skill and `dispatch`, under 200.
- `discipline.test.ts`: `reinforceLine` has the template and phase, never the regex, under 110.
- `test_bench_hooks.py`: `model_bytes`, `dispatch_parts`, per-run session tags, determinism.

No test's expected allow/deny/block DECISION changed; the (n) tests changed only the pinned wording.

## 5. Saving per orchestrated session

Assumptions: 10 prompts, 4 atlas dispatches (3 read-only, 1 writer; the 2 later ones inside the burst
window), 2 header-less Stops (one first, one repeat), the nudge fires once, the mod is loaded.

| Item | Saved each | Count | Total |
|---|---|---|---|
| Read-only brief | 1407 | 3 | 4221 |
| Writer brief | 201 | 1 | 201 |
| 2nd-dispatch advisory | 153 | 2 | 306 |
| Orchestrate nudge | 174 | 1 | 174 |
| Mod reinforce line | 82 | 10 | 820 |
| Gate (n), versus (a) shipped 17.4.1: first 1671 to 321 (saves 1350), repeat 0 to 221 (costs 221) | net 1129 | 1 | 1129 |
| Total versus (a) shipped 17.4.1 | | | 6851 bytes |
| Gate (n), versus (b) the every-reply rule with the old wording: 1312 + 1412 | 2724 | 1 | 2724 |
| Total versus (b) | | | 8446 bytes |

Against what users run today (a), the repeat header-less Stop is a cost of 221 bytes, not a saving:
the every-reply rule is already in this tree and this change only shortens it. Bytes injected early
are also re-read on every later turn, so the effect on cached context is larger than the sums.

## 6. Measured, not changed

- SessionStart (2634): once per session; every line names a command or path the model uses (team
  flow, header table, tool routing). The first-run analytics notice adds about 640 and is a
  user-facing disclosure.
- Concurrent-dispatch deny, unbounded-spec deny, `(m)` warning, `git push` advisory, SubagentStop
  report block: either under 100 bytes of possible saving per typical turn, or the text is the
  decision or the report template the worker needs, firing once per worker.
- Gate multi-condition reason (up to 9087): the per-condition guidance is the content; the F8 delta
  already shortens repeats of those letters.
- Not measured: worker inbox wrapper, `docs_drift_watch`, `nudge`, `connector_credential_watch` (they
  need live board, drift or connector state the bench does not build; each is one advisory paragraph).
  CLI stdout of scripts the model runs by hand is in section 7.

## 7. CLI output (stdout of scripts the model runs by hand)

Stdout of the atlas scripts an agent calls by hand, measured before and after the 17.4.2 cuts.
Every byte stays in the calling model's context for the rest of its conversation.

Method: a measuring script (`cli_measure.py`, kept in the session scratchpad, not in the repo) runs each command through its own `main()` or `cmd_*`
against temp roots. The numbers come from fixtures with mocked tmux: tmux, `claude` and worktree
creation are mocked, and no team or agent was started.
Fixtures: one finding with 2 evidence items and a reproduction; a 30-member IRC bus with 7 messages;
an `implement/high` team of 5 members (3 with worktrees) where 4 have reported; a crew run of 8 workers.

| Command | Bytes before | Bytes after | Lines after | Consumer | Full form |
|---|---|---|---|---|---|
| `atlas_finding.py --id .. --status ..` | 664 | 122 | 1 | model | `--json` (664) |
| `atlas_irc.py who` (30 members) | 808 | 508 | 22 | model, human | `who --json` (808) |
| `atlas_mux.py spawn-team` | 2594 | 495 | 7 | model; omp `atlas_team` tool parses it | `--json` (2613) |
| `atlas_mux.py spawn-team --dry-run` | 1153 | 240 | 6 | model | `--json` (1160) |
| `atlas_mux.py wait` | 686 | 246 | 6 | model | `--json` (686) |
| `atlas_mux.py reap` | 1200 | 235 | 3 | model | `--json` (1200) |
| `atlas_crew.py wait` / `run --wait` (summary) | 2301 | 1957 | 1 | model (skill reads the JSON) | same keys, one line |
| `atlas_mux.py status` | 1573 | 1573 | 1 | program (mod `register.ts` parses it) | unchanged |
| `atlas_resolve.py implement medium` | 393 | 393 | 1 | model; resolver logic imported by hooks | unchanged |
| `atlas_resolve.py audit high` | 316 | 316 | 1 | same | unchanged |
| `atlas_finding.py recent` | 200 | 200 | 1 | model | unchanged |
| `atlas_irc.py need` (2 peers ready) | 1047 | 1047 | 6 | crew worker model | unchanged |
| `atlas_irc.py read` (7 unread) | 1272 | 1272 | 7 | crew worker model | unchanged |
| `atlas_irc.py tail --once` | 1356 | 1356 | 7 | human | unchanged |
| `atlas_crew.py status` | 345 | 345 | 1 | model | unchanged |

The `--json` byte counts for spawn-team differ from "before" by the length of the second team id used in the run.

One team cycle (spawn-team, wait, reap) for the 5-member fixture: 4480 bytes before, 976 after.

### What changed

- `atlas_finding.py`: prints `wrote <id> [<status>] -> <path>`. The caller passed every field, so the record is
  no longer echoed. `--json` prints the old `wrote <path> -> <entry JSON>`.
- `atlas_irc.py who`: header `<channel> lead <lead>, N members`, one name per line, capped at 20 (`WHO_CAP`)
  with `+N more (who --json lists all)`. `--json` prints the old object.
- `atlas_mux.py spawn-team`, `wait`, `reap`: a header line plus one line per member (state and last `STATUS:`
  line for wait; role, model and worktree branch for spawn-team); reap lists removed worktrees and one line per
  kept worktree with the `atlas_wt.py merge` command. Absolute board, worktree and archive paths are dropped.
  `--json` prints the old object. Errors stay one JSON object in both forms. A caller that builds its own
  namespace (no `json` attribute, as the unit tests and any in-process caller do) still gets JSON.
- `atlas_crew.py wait` and `run --wait`: `summary.json` is printed as one JSON line instead of the indented
  file. Same keys; the file on disk is unchanged.

### Consumers that fixed a shape

- `plugins/atlas/mod/register.ts:490` runs `atlas_mux.py status` and `mod/data/mux.ts:20` does `JSON.parse` on
  its stdout. The mod is out of scope here, so `status` keeps JSON and gets no compact default.
- `plugins/atlas/omp/team-tool.ts:96` parses the last stdout line of spawn-team (channel and members) to mount
  the team widget. It now passes `--json` for spawn; wait and reap hand the short text to the omp lead.
- `atlas_mux.cmd_spawn_team` parses the stdout of its own `cmd_spawn` call per member (`atlas_mux.py`,
  `json.loads(buf.getvalue()...)`), so `spawn` (single worker) keeps JSON.
- `atlas_resolve.py`: hooks import `resolve` (`hooks/dispatch_tripwire_core.py:395`), `omp/resolve.ts` is a
  twin, and `hooks/test_atlas_resolve.py` parses the CLI. It has no human mode, so it is unchanged.
- `skills/atlas-crew/SKILL.md:18` tells the lead to read numbers from the "final JSON summary", so the crew
  summary stays JSON with the same keys.
- No program parses `atlas_finding.py` or `atlas_irc.py who` stdout (searched plugins/atlas python, ts, md).

### Left unchanged, and why

- `atlas_irc.py need|read|tail|wait`: already plain text with per-line caps (`fmt(width=...)`, `--limit 50`).
  Their size is message content the worker asked for.
- `atlas_crew.py status` (345 bytes) and the crew start line: already small; the start line carries the
  `next` command the skill uses.
- `atlas_mux.py status`: see consumers. A lead that wants a compact view of a running team has `wait`.
- Crew summary fields were not trimmed: `check_tail` is already capped (200 bytes on pass, 800 on failure)
  and the per-worker rows are the numbers the skill reports.

### Tests

- `test_atlas_mux.py::BriefOutputTests` (6 tests): member lines for wait, dead and never-launched states,
  spawn-team header, failures and next command, dry-run, reap kept-worktree line, `--json` returns the object,
  a namespace without the flag keeps JSON. The existing tests that parse spawn-team, wait and reap through
  `main()` now pass `--json`.
- `test_atlas_irc_core.py::test_cmd_who`, `test_cmd_who_caps_the_list_and_counts_the_rest`.
- `test_atlas_finding.py::test_confirms_in_one_short_line_and_json_prints_the_entry`.
- `test_atlas_crew.py::test_cmd_wait_prints_an_indented_summary_as_one_json_line`,
  `test_summary_line_shows_a_malformed_file_as_written`.
- `omp/team-tool.test.ts`: spawn argv carries `--json`.
