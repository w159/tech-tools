# Telemetry

Atlas counts how it is used, anonymously, so it can be improved from evidence instead of guesses. It is **on by
default**. This page lists exactly what is counted and why, what is never collected, how to see the data before it
leaves your machine, and the four ways to turn it off.

Source of truth: [contracts/analytics-schema.json](../contracts/analytics-schema.json). The client is
[scripts/atlas_analytics.py](../scripts/atlas_analytics.py). The receiver is in `telemetry/server/` of the
tech-tools repository, and it accepts only the keys in `telemetry/allowed-keys.json`.

## What it is

Whole-number counters, summed per ISO week. Nothing is sent while the week is running. After the week ends, one small
JSON payload is posted: the counters plus the Atlas version, OS family (linux, darwin, windows, other), Python minor
version, the ISO week and a random nonce. A counter is only ever a name from the list below and an integer.

## Turn it off

Any one of these is enough. The first that applies wins, in this order.

| How | Where it applies |
|---|---|
| `DO_NOT_TRACK=1` | The cross-tool convention (consoledonottrack.com). Overrides everything else. |
| `ATLAS_ANALYTICS=off` | Environment variable, or the same key under `env` in `~/.atlas/settings.json`. |
| The settings knob | Command Center, Session automation, "Anonymous usage counters" (`ATLAS_ANALYTICS`, values `on` / `off`, default `on`). It writes `~/.atlas/settings.json`, the same store every other knob uses. |
| `python3 scripts/atlas_analytics.py disable` | Records the choice in `~/.atlas/analytics/consent.json` (`disable --keep` keeps the pending counts). |

With any opt-out set, nothing is recorded, nothing is sent and the first-run notice is not shown. CI and test runs
(`CI`, `GITHUB_ACTIONS`, `PYTEST_CURRENT_TEST` and similar) are off unless you set `ATLAS_ANALYTICS=on`.

The first time Atlas runs with telemetry on and undecided, it shows a one-time notice (once per schema version): in
the SessionStart system message under Claude Code and Codex (Codex shows a SessionStart `systemMessage` as a warning
in the hook output), and as an omp toast (`ctx.ui.notify`) from the hook bridge. `enable` or `disable` ends the
notice for good.

## See exactly what would be sent

```bash
python3 scripts/atlas_analytics.py explain   # what and why, in plain language
python3 scripts/atlas_analytics.py preview   # the exact payload for the pending week
python3 scripts/atlas_analytics.py prove     # check that payload against the anonymity rules (exit 1 on any failure)
python3 scripts/atlas_analytics.py status    # state, files, event count, week range
python3 scripts/atlas_analytics.py export --out atlas-counts.json   # the same payload, written to a file
python3 scripts/atlas_analytics.py delete    # remove ~/.atlas/analytics entirely
```

`prove` builds the real payload and fails if it contains a key outside the schema, a non-integer count, or any of
your username, hostname, home directory, working directory, git remote, e-mail addresses, IP addresses, absolute
paths or long hex or base64 tokens. Pending counts are in `~/.atlas/analytics/events.jsonl` (one `{"w","k","n"}` per
line) and every payload sent is appended to `sent.jsonl` first.

## What is counted, and why

Each family exists for one purpose. Keys are fully expanded in `telemetry/allowed-keys.json`.

| Family | Keys | Recorded when | Purpose |
|---|---|---|---|
| `session` | `session.<claude\|omp\|codex\|unknown>` | Once per session start (a context compaction is not a new session). | Denominator and harness mix: every other counter can be read as a rate per session, and parity work goes to the harness people use. |
| `hook` | `hook.<hook>.<deny\|ask\|context\|fault\|slow>` and `hook.<hook>.<decision>.<reason>` | A hook denies, asks or adds context; raises or exits with a code other than 0 or 2, or runs out of time (`fault`); or one hook takes longer than 1000 ms (`slow`, threshold `SLOW_HOOK_MS` in `hooks/event_dispatch.py`). | Shows which hooks are noisy, over-strict, slow or faulting, so they are loosened, sped up or fixed first. The `<reason>` form is sent by `git_guard` (`protected`, `force`, `pr`, `branch`, `worktree`) and `edit_read_nudge` (`context.unread`); the class is a closed enum, never free text. |
| `dispatch` | `dispatch.<event>.ms.<lt50\|50to200\|200to1000\|ge1000>` | Once per PreToolUse or PostToolUse dispatch: wall time of the whole Atlas hook pass, in a bucket. | Keeps the per-tool-call overhead small on real machines and shows regressions. |
| `skill` | `skill.<skill>` | A shipped Atlas skill runs (the Skill tool), or a prompt starts with `/atlas:<skill>` or `/<skill>`. Only the skill name is read, never the rest of the prompt. | Shows which skills are used, so unused ones are merged or retired and descriptions are tuned where a skill never triggers. |
| `agent` | `agent.<role>` | A shipped Atlas subagent role is dispatched. | Shows which roles get dispatched, so unused roles are cut and busy ones tuned. |
| `team` | `team.<class>.<effort>`, `team.size.<1\|2\|3-4\|5-8\|9+>`, `team.outcome.<done\|failed\|timeout>`, `team.wall.<lt1m\|1to5m\|5to15m\|15to60m\|ge60m>` | A team is spawned (class, effort, size) and when `atlas_mux wait` returns (outcome from the members' exit codes, wall time since spawn). | Shows which task classes and effort levels are chosen, whether runs finish, fail or time out, and how long they take, so the scope matrix defaults match real work. |
| `gate` | `gate.<letter>.block`, `gate.pass` | The completion gate blocks a Stop on a condition letter, or allows a Stop with every applicable condition met. | Shows which checks block a finish most often against how often a finish passes cleanly, so false positives are removed. |
| `git` | `git.clean.<worktrees\|branches\|remote>`, `git.branch.<created\|reused>` | Automatic cleanup runs, or a branch is created or reused. | Shows whether cleanup runs and branches are reused instead of multiplied. |
| `security` | `security.alerts.<dependabot\|code\|secret>.<low\|medium\|high\|critical>` | A security refresh tallies open alerts. | Shows where alert triage and auto-fix effort should go. |

Names inside a key (hook, skill, agent, class, effort, event) come from files shipped with Atlas, so a skill, repo,
branch, path or project name of your own can never match.

## What is never collected

- Install, session, user or machine identifiers. There is no install id. Each weekly payload carries a fresh random
  nonce (a UUID, never reused across weeks) whose only job is to let the server drop a duplicate retry.
- Timestamps finer than the ISO week.
- Usernames, hostnames, IP addresses, home or working directories, file names or paths.
- Repository, organisation, branch, project or user-defined skill names.
- Prompts, model output, code, commit messages, error messages or file contents.

Unknown keys are dropped when recorded, again when the payload is built, and again by the server.

## Where the data goes

The client posts once per finished week, in the background, only after the notice has been shown and only when an
endpoint is configured (`endpoint` in the schema, or `ATLAS_ANALYTICS_ENDPOINT`; https only, plain http only for
localhost). Installs send to `https://atlas-telemetry.vercel.app/api/ingest`, the endpoint shipped in the schema.
To stop sending, turn telemetry off (see "Turn it off" above: `DO_NOT_TRACK=1`, `ATLAS_ANALYTICS=off`, or
`python3 scripts/atlas_analytics.py disable`). The server stores the validated body and nothing else. It publishes weekly totals only: a counter appears
only once **at least 3 installs** reported it, and version, OS and Python buckets below that threshold fold into
`other`. Published reports land in the tech-tools repository under `telemetry/reports/`, with the latest summary in
[`telemetry/REPORT.md`](../../../telemetry/REPORT.md) (regenerated weekly by `scripts/telemetry_report.py`).

Honest caveat: the server code never reads or stores IP addresses, headers or request bodies in logs, but the hosting
platform may keep its own request logs (including IP addresses) under its own retention. The code never reads them.

## How the hooks stay fast

The per-event hooks (`event_dispatch.py`, `prompt_optimizer.py`, `completion_gate.py`) write through
`scripts/atlas_analytics_hot.py`, a stdlib-only module that resolves the same opt-out rules as `atlas_analytics.py`
and appends one line per counter. Importing the full client costs milliseconds a per-tool-call hook cannot spend.
`scripts/test_analytics_contract.py` pins the two to the same answers across every opt-out combination, checks that
`telemetry/allowed-keys.json` equals the client's current output (a renamed skill or new hook fails CI until the file
is regenerated with `python3 plugins/atlas/scripts/atlas_analytics.py allowed-keys > telemetry/allowed-keys.json`),
and that every family has a recording call site.
