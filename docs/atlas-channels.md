# Atlas channels

Last verified against the source on 2026-10-07 (atlas 10.3.1): `plugins/atlas/scripts/atlas_todo.py` (registry, CLI), `hooks/worker_inbox.py` (delivery), `hooks/dispatch_tripwire.py` (`_channel_dispatch`, Claude Code), `omp/channels.ts` and `omp/hook-bridge.ts` (omp), `scripts/atlas_dash_irc.py` (dashboard routes), and `scripts/test_atlas_channels.py`. Product pages that show channels: `docs/atlas-workboard.md`. Worker-facing rules: `plugins/atlas/references/operating-contract.md` and `contracts/worker-protocol.json` (`channels`).

A channel is a named scope on the durable board's notes. It answers "who may see this message": a lead and the subagents it dispatched talk in one subchannel; nobody else's messages leak into it.

## Names

| Kind | Name | Created |
|---|---|---|
| main | `<folder>@<branch>`: the project directory's basename and the git branch of that directory (`atlas_todo.main_channel`) | `ensure_main`, or the first lead dispatch |
| lead subchannel | `<main>/<lead>`, e.g. `tech-tools@main/lead-3fa9c1` | `open_lead_channel`, on a lead's first dispatch |

- A detached HEAD gives `<folder>@<short-sha>`; a directory that is not a git repository gives the basename alone.
- The lead name is `ATLAS_LEAD_NAME`, else `ATLAS_WORKER_NAME`, else `lead-<first 6 characters of the session id>` (`lead` when there is no session). Member names are sanitised to `[A-Za-z0-9_.-]`; anything else becomes `_`; an empty name becomes `anon`.
- Channel names contain `@` and `/`, so the dashboard route takes one URL-encoded path segment.

## Registry

`<project>/.atlas/.run/channels.json`, written atomically under a lock: `{"version": 1, "channels": {<name>: <channel>}}`.

```json
{
  "name": "tech-tools@main/lead-3fa9c1",
  "kind": "lead",
  "parent": "tech-tools@main",
  "lead": "lead-3fa9c1",
  "members": [
    {"name": "lead-3fa9c1", "role": "lead", "parent": null, "joined": 1791000000.0},
    {"name": "explorer-ab12", "role": "subagent", "parent": "lead-3fa9c1", "joined": 1791000000.0}
  ],
  "project_root": "/path/to/tech-tools",
  "branch": "main",
  "created": 1791000000.0,
  "last_activity": 1791000000.0
}
```

The lead is a member of its subchannel and of the main channel; each dispatched subagent is a member of the subchannel with `parent` set to the lead. `open_lead_channel` is idempotent. Every note carries a `channel` field and keeps the board-wide monotonic `seq`. A note posted without `--channel` goes to `ATLAS_CHANNEL` if set, else the newest lead subchannel its owner belongs to, else the main channel (`default_channel`).

## CLI

All commands print JSON. Run them as `python3 plugins/atlas/scripts/atlas_todo.py <command> --root <project>`.

| Command | What it does | Result |
|---|---|---|
| `channels` | Main channel of this project with its children | `{ok, main, channels: [main + children[]]}` |
| `channel-open --lead L --members a,b` | Open `<main>/L`, add the members, build each member's CHANNEL brief; `lead_required` without `--lead` | `{ok, channel, briefs: {name: text}}` |
| `channel-board <channel>` | Todo items per member with status counts and each member's last note | `{ok, channel, kind, lead, members: [{name, role, parent, counts, items, last_note}], counts}` |
| `note --owner N --to <name\|lead\|all> --channel C "<text>"` | Post a note (`--to` defaults to `all`; `--item` links a todo; `owner_required` without `--owner`) | `{ok, note}` |
| `notes --channel C [--to N] [--since TS]` | Read the notes of exactly that channel | `{ok, notes}` |
| `inbox --owner N` | Drain this worker's pending notes once (what the hook would inject); `owner_required` without `--owner` | `{ok, text}` (empty text: nothing pending) |

`channel-board` on an unknown channel is a `KeyError` in the Python function. Set `ATLAS_CHANNELS=off` to disable the automatic dispatch wiring on both harnesses (`contracts/worker-protocol.json`).

## How a worker learns its channel (identity carriage)

The worker has to know its name and channel to post and to be addressed. The two harnesses carry that differently.

| | Claude Code | omp |
|---|---|---|
| Who opens the subchannel | `hooks/dispatch_tripwire.py` `_channel_dispatch`, a PreToolUse hook on `Task`/`Agent`, on the lead's first dispatch (subagent-initiated dispatches are skipped) | `omp/channels.ts` `reviseForChannel`, called from the `task` tool_call handler in `omp/worker-report.ts`; only the lead's own dispatches; fails open |
| Subagent name | The dispatch's `name`; unnamed dispatches get `<subagent_type tail>-<4 hex>` | The item's `name`; unnamed items are given `<agent>-<4 hex>` so the member name and agent id agree |
| How the brief arrives | The `CHANNEL:` block is appended to the dispatch `prompt` (skipped if the prompt already contains `CHANNEL:`) | The `CHANNEL:` block is appended to each item's `task` |
| Hook-side identity for the inbox | The mux worker env (`ATLAS_WORKER_NAME` + `ATLAS_PROJECT_ROOT`) for colony panes; the payload's session for the lead | omp gives subagents no per-task env, so the omp hook bridge sends the omp agent id as `agent_name` and `worker_inbox.identity` maps it to a registered member (exact name, or the id with omp's `<n>-` prefix and trailing digits stripped; a unique match only) |

The CHANNEL block names the channel, the lead, the siblings, the exact `note` command (`--channel <c> --owner <name> --to <sibling|lead|all>`), the `inbox` command and the claim command. If an omp agent id does not match a member, the subagent still drains by running the `inbox` command from its block between steps; this is the documented fallback because omp core does not expose the task name to hooks.

## Delivery rules

Delivery is `worker_inbox.drain`, called from the PostToolUse path of the dispatch hook (`dispatch_tripwire.py`) and from the `inbox` command.

- A worker receives a note when `to` is its name (or an alias: the lead also answers to `to=lead`) and the note's channel is one the worker is a member of, or the project's current main channel, or the note has no channel (legacy). It also receives a `to=all` broadcast in a channel it is a member of (registry membership plus `ATLAS_CHANNEL`).
- It never receives a note of another lead's subchannel or of another branch's main channel, and never its own notes.
- Notes the dashboard already typed into the pane (`delivery` `delivered` or `refused`) are skipped.
- Each worker has a cursor over the board-wide `seq`, moved under the same lock the board's writers use, so a note is delivered once and a late-landing note is not skipped.
- One drain returns at most 10 notes (`MAX_NOTES`), each cut at 600 characters (`MAX_BODY`).
- Fail open: a hook error is recorded in the hook fault log and the tool call proceeds.
- Bounded registry lock: `open_lead_channel` and `atlas_todo._register_worker` wait at most `CHANNEL_LOCK_TIMEOUT_S` (2 s) for the registry lock (`atlas_memory._file_lock(path, timeout)` raises `LockTimeout`; the default stays blocking). A timeout is recorded as `atlas_todo.register_worker.lock_timeout` (mux worker note) or `dispatch_tripwire.channel_lock_timeout` (Claude Code dispatch), never printed to stderr, and the note or dispatch proceeds.
- A Claude Code dispatch opens a channel only when it was allowed: `dispatch_tripwire._is_deny(out)` parses the emitted hook JSON (`hookSpecificOutput.permissionDecision`) rather than matching text.
- A mux or launch worker is registered by `atlas_todo._register_worker` on its first board note without an explicit channel (owner equals `ATLAS_WORKER_NAME`); it joins the newest lead subchannel or opens `<main>/lead`.

## Dashboard

| Route | Use |
|---|---|
| `GET /api/v2/channels` (`?project=`) | The tree: every channel with members and presence. With a named project that has no registry rows, the main channel row is created |
| `GET /api/v2/channels/<url-encoded name>?since=&limit=` | `{channel, messages, more, board}`: members with `last_seen`, the channel's messages oldest first, and the board grouped by owner. `limit` defaults to 200 and is clamped to 1..1000; with `since` (a message id or an epoch) the oldest `limit` after it are returned and `more` says newer ones remain. 404 `no_such_channel` for an unknown name |
| `POST /api/v2/channels {channel, to, body, from, project}` | Post into an existing channel (token-guarded). 400 `channel_required`, 404 `no_such_channel`, 400 `invalid_to` for an address that is not `[A-Za-z0-9_.:-]` or `all`. A message to a named agent whose idle `claude`/`omp` herdr pane exists is typed into it (`delivery: delivered`); otherwise it stays queued for the worker's hook |
| `GET`/`POST /api/v2/irc` | Unchanged; the main channel |
| `GET /api/v2/projects/hp` | herdr-projects threads carry `channel` (`<repo-folder>@<branch>`), `channel_parent` (the repo's main channel) and `channel_path` (`<parent>/<channel>`) so the Projects page can chip a thread with its channel; documented in `docs/atlas-integrations.md` |

Both channel GETs need `X-Atlas-Token` because they expose message text. 503 `channels_unavailable` when the installed `atlas_todo` has no registry. The Channel lens (`dashboard_ui/js/pages/channel-lens.js`) is one column: a header (channel name, a channel select only when more than one channel exists, one dim `main · lead X · branch` line, one row of member chips), the message log (the last 100, `limit=100`; the only scrolling region, so the composer stays in view) and a composer (`To`, one textarea, Send). Clicking a member chip sets `To`; the small icon inside a chip opens that agent. `To = Everyone` posts to the channel (`POST /api/v2/channels`, `to: "all"`); `To = <member>` prompts that agent (`POST /api/v2/herd/agents/<pane>/prompt`) when its pane is idle, otherwise posts to the channel addressed to it. Message bodies are plain monospace text (only pane ids link to the agent), and a delivery glyph appears only on a `refused` or `undeliverable` message, with its reason as the tooltip. There is no channel tree, Members column or "Load earlier messages" button; the per-member board is the Board tab below, and the whole todo board is the Board lens.

**Board tab and Supervision.** The Channel lens has a **Messages | Board** switch. Board renders `board.owners[]` from `GET /api/v2/channels/<name>` joined to the channel's members (lead first): per member the role chip, presence (live pane state matched by name or pane id, else the API state, else "no pane"), todo counts (active, open, blocked, done), the in-progress item, every todo item, the last note with its age, **Message** (sets `To`) and **Open** (agent inspector). A channel with no board items says so. A lead subchannel's header has **Supervise**, which opens `#/agents?lens=supervision&channel=<name>`: that lens (`js/pages/supervision-lens.js`, chord `g u`) draws one tree per lead subchannel (parent link = the main channel), the lead row and its subagents nested with the same rows. Fleet cards of a lead (an agent with subagents, or the member that `lead` names) carry a **Supervise** chip. Colony stays the herdr frame; a native `colony-lens.js` never shipped.

## Limits

- One project root and one branch per main channel; the registry lives in the project's `.atlas/.run/`, so a channel never spans projects.
- Presence in the dashboard is the member's live herdr state, or "posted Nm ago" from its newest message; members without a herdr pane are not drawn as agents.
- Delivery to a worker happens on its next tool call (hook) or its next `inbox` run; there is no push into a busy pane.
- The omp agent-id to member match is fuzzy by design (see above); it is not confirmed against every omp release.
- Nothing prunes the registry; `leave` removes a member (`atlas_todo.leave`), channels stay.
- Completion gate (p) counts channel activity per run, not per channel: any board note by an owner other than `lead` since the run start (a post in the lead's subchannel or the main channel alike), or IRC/`SendMessage` traffic, satisfies it; two or more atlas workers with none still block, once per session. See `docs/atlas-harness-parity.md`, gate (p).
- Tests must never use the OS temp root as cwd: channel code walks up to the nearest `.atlas` and creates `.atlas/.run/channels.json` there (a channel named after the directory, e.g. `T`), after which every temp-dir fixture resolves that directory as its project root. `omp/worker-report.test.ts` was fixed to use a private `mkdtemp` directory; `scripts/test_no_tmp_marker.py` fails if `.atlas` exists in `$TMPDIR` or `/tmp` or if an omp/hooks/scripts test passes the bare temp root as `cwd`.
