# Telemetry

Atlas counts how it is used, anonymously, so it can be improved from evidence instead of guesses. It is **on by
default**. This page lists exactly what is counted and why, what is never collected, how to see the data before it
leaves your machine, and the four ways to turn it off.

Source of truth: [contracts/analytics-schema.json](../contracts/analytics-schema.json). The client is
[scripts/atlas_analytics.py](../scripts/atlas_analytics.py). The receiver is in `telemetry/server/` of the
tech-tools repository, and it accepts only the keys in `telemetry/allowed-keys.json`.

## What it is

Whole-number counters, summed per ISO week. The payload (schema 3) is the counters plus the Atlas version, OS family
(linux, darwin, windows, other), Python minor version, the ISO week, a random nonce and a `partial` flag. The running
week is sent as a week-to-date snapshot (`partial: true`) that replaces its earlier snapshot on the server; each finished
week is sent once as final (`partial: false`). A counter is only ever a name from the list below and an integer.

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
python3 scripts/atlas_analytics.py status    # state, files, event count, week range, last send result
python3 scripts/atlas_analytics.py export --out atlas-counts.json   # the same payload, written to a file
python3 scripts/atlas_analytics.py preview --test   # same, marked test: true (also send --test, prove --test, or ATLAS_ANALYTICS_TEST=1)
python3 scripts/atlas_analytics.py allowed-keys --merge   # regenerate the allowlist, keeping every key an earlier release shipped
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
| `command` | `command.<skill>` | A shipped Atlas slash command is invoked. | Separates typed commands from model-chosen skill runs. |
| `fault` | `fault.<component>.<errclass>` | A component fails; the class is a closed enum, never the message. | Shows what breaks in the field, by component. |
| `mod` | `mod.open.<dock\|ondemand\|board>`, `mod.command.<atlas-cc\|atlas-say\|atlas-core\|atlas-todo>`, `mod.error.<boot\|rebuild\|fault\|other>` | A mod panel opens, a mod command runs or the mod errors. The mod writes counts to `$ATLAS_HOME/analytics/mod-usage/<session>.json`; the client folds files older than 30 minutes at session start. Nothing is written when opted out. | Shows whether the mod is used and where it fails. |
| `crew` | `crew.workers.<size>`, `crew.outcome.<done\|failed\|timeout\|killed>`, `crew.wall.<bucket>`, `crew.rounds.<0\|1\|2\|3+>`, `crew.check.<pass\|fail\|none>` | A crew run ends. | Shows crew size, outcome, duration, fix rounds and unit check result. |
| `active` | `active.day.<mon..sun>` | Once per session start, on the weekday. | Shows which days installs are used. |
| `delivery` | `delivery.ok.<urllib\|curl>`, `delivery.fail.<ssl\|timeout\|network\|http4xx\|http5xx\|refused\|other>` | A send succeeds or fails. | Makes send failures visible in the data instead of silent. |

Names inside a key (hook, skill, agent, class, effort, event) come from files shipped with Atlas, so a skill, repo,
branch, path or project name of your own can never match.

## What is never collected

- Install, session, user or machine identifiers. There is no install id. Each weekly payload carries a fresh random
  nonce (a UUID, never reused across weeks) whose only job is to let the server drop a duplicate retry.
- Timestamps finer than the ISO week.
- Usernames, hostnames, IP addresses, home or working directories, file names or paths.
- Repository, organisation, branch, project or user-defined skill names.
- Prompts, model output, code, commit messages, error messages or file contents.

Unknown keys are dropped when recorded and again when the payload is built. The server drops unknown but well-formed keys
and counts them (`dropped`) instead of rejecting the payload; a malformed key still gets 400.

## Where the data goes

The client posts in the background at session start, at most once an hour, only after the notice has been shown and only when an
endpoint is configured (`endpoint` in the schema, or `ATLAS_ANALYTICS_ENDPOINT`; https only, plain http only for
localhost). It sends the current week as a week-to-date snapshot and each finished week once as final. A failed send keeps
the week and counts `delivery.fail.<kind>`; a success counts `delivery.ok.<urllib|curl>`. On a TLS failure the client
retries with curl, which fixes macOS Python without a CA bundle. `status` shows the last send result. Payloads marked
`--test` (or `ATLAS_ANALYTICS_TEST=1`) carry `test: true` and are left out of the public aggregate. Installs send to
`https://atlas-telemetry.vercel.app/api/ingest`, the endpoint shipped in the schema.
To stop sending, turn telemetry off (see "Turn it off" above: `DO_NOT_TRACK=1`, `ATLAS_ANALYTICS=off`, or
`python3 scripts/atlas_analytics.py disable`). The server stores the validated body and nothing else. It publishes weekly
totals only: a counter appears only once **at least 3 installs** reported it, and version, OS and Python buckets below
that threshold fold into `other`. Published reports land in the tech-tools repository under `telemetry/reports/`, with
the latest summary in [`telemetry/REPORT.md`](../../../telemetry/REPORT.md) (regenerated weekly by
`scripts/telemetry_report.py`).

## The owner dashboard

The telemetry server also serves a private view for the project owner: `/dashboard` (HTML) and `GET /api/admin?weeks=N`
(JSON), both behind the secret in the Vercel project env var `ATLAS_DASHBOARD_TOKEN` (at least 24 characters; admin
answers 503 when it is unset or shorter, 401 on a wrong secret). `GET /api/health` is open and shows storage kind,
accepted schemas, allowlist key count and sha256, whether the secret is configured and recent submission counts. The
dashboard shows totals, the weekly trend, top and never-used features, failures, versions and a per-week table, and can
download or copy the JSON. Test data is hidden unless `include_test=1`. Setup, rotation and routes:
[telemetry/server/README.md](../../../telemetry/server/README.md). The allowlist only grows: `allowed-keys --merge` keeps
every key an earlier release shipped (2126 keys in 17.19.0).

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
