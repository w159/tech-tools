# Atlas channels

Last verified against the source on 2026-10-08 (atlas 10.4.3): `plugins/atlas/scripts/atlas_todo.py` (registry, CLI), `hooks/worker_inbox.py` (delivery), `hooks/dispatch_tripwire.py` (`_channel_dispatch`, Claude Code), `hooks/session_boot.py` (lead name export), `omp/channels.ts` and `omp/hook-bridge.ts` (omp), `scripts/atlas_dash_irc.py` and `scripts/atlas_dash_colony.py` (dashboard routes), `scripts/atlas_mux.py` (worker posting), and `scripts/test_atlas_channels.py`. Product pages that show channels: `docs/atlas-workboard.md`. Worker-facing rules: `plugins/atlas/references/operating-contract.md` and `contracts/worker-protocol.json` (`channels`).

A channel is a named scope on the durable board's notes. It answers "who may see this message": a lead and the subagents it dispatched talk in one subchannel; nobody else's messages leak into it.

## Names

| Kind | Name | Created |
|---|---|---|
| main | `<folder>@<branch>`: the project directory's basename and the git branch of that directory (`atlas_todo.main_channel`) | `ensure_main`, or the first lead dispatch |
| lead subchannel | `<main>/<lead>`, e.g. `tech-tools@main/lead-3fa9c1` | `open_lead_channel`, on a lead's first dispatch |

- A detached HEAD gives `<folder>@<short-sha>`; a directory that is not a git repository gives the basename alone.
- The lead name is `ATLAS_LEAD_NAME`, else `ATLAS_WORKER_NAME`, else `lead-<first 6 characters of the session id>` (`lead` when there is no session). Member names are sanitised to `[A-Za-z0-9_.-]`; anything else becomes `_`; an empty name becomes `anon`.
- **A Claude Code lead's Bash gets `ATLAS_LEAD_NAME`.** Hooks derive `lead-<sid6>` from the session id, but a Bash command has no such env, so `atlas_mux spawn` would register workers in `<main>/lead`. `hooks/session_boot.py` therefore appends `export ATLAS_LEAD_NAME=lead-<sid6>` to `$CLAUDE_ENV_FILE` at SessionStart (Claude Code sources that file before every Bash command). It writes nothing for a worker session (`ATLAS_WORKER_NAME` set), when `ATLAS_LEAD_NAME` is already set, or without a session id, and never writes the same line twice. Mux workers then join the same `<main>/lead-<sid6>` as the lead's Task dispatches.
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

The lead is a member of its subchannel and of the main channel; each dispatched subagent is a member of the subchannel with `parent` set to the lead. `open_lead_channel` is idempotent. Every note carries a `channel` field and keeps the board-wide monotonic `seq`. **Membership is granted lead-side only**: `open_lead_channel` (dispatch), `atlas_launch.launch` and `atlas_mux spawn` add the member; a worker never registers itself, and an inherited `ATLAS_CHANNEL` grants nothing. A note posted without `--channel` goes to `ATLAS_CHANNEL` only if its owner may post there (`atlas_todo.may_post`), else the newest lead subchannel its owner belongs to, else the main channel (`default_channel`). A launched worker (env `ATLAS_WORKER_NAME` equal to the note owner) that is not a member (or departed member) of the channel it names has the channel dropped and posts to the main channel. A member that finished stays in the registry with `exit_code` and `ended_at` (`mark_finished`; `leave` keeps such members, and the two calls may come in either order); this is what the Colony roster reads.

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

- Which notes a reader gets (`worker_inbox.drain`, `wanted`): a note in a channel is dropped for every reader unless its owner may post there (`atlas_todo.may_post`: a member or departed member, a lead, `human` or `board`). A note to the alias `lead` needs a channel the reader belongs to, so channel-less and foreign notes to `lead` are never delivered. A note to a lead by its own name that is channel-less or on the main channel is delivered only from its peers (members or departed members of the lead's channels, `human`, `board`). A note to a worker by name is delivered when it has no channel, a channel the worker belongs to, or the main channel. A `to=all` broadcast is delivered in a channel the reader belongs to (registry membership, plus `ATLAS_CHANNEL` only if it may post there).
- It never receives a note of another lead's subchannel or of another branch's main channel, and never its own notes.
- Notes the dashboard already typed into the pane (`delivery` `delivered` or `refused`) are skipped.
- Each reader has a cursor over the board-wide `seq`, moved under the same lock the board's writers use and never moved backwards (a line without `seq` after one with it cannot rewind it), so a note is delivered exactly once and a late-landing note is not skipped. A lead with no cursor starts at its channel's creation (or the board's newest note), so it never replays the board; a worker with no cursor keeps the backlog, so a brief sent before its first tool call arrives.
- One drain returns at most 10 notes (`MAX_NOTES`), each cut at 600 characters (`MAX_BODY`).
- Fail open: a hook error is recorded in the hook fault log and the tool call proceeds.
- Bounded registry lock: `open_lead_channel` and `atlas_todo.register_member` wait at most `CHANNEL_LOCK_TIMEOUT_S` (2 s) for the registry lock (`atlas_memory._file_lock(path, timeout)` raises `LockTimeout`; the default stays blocking). A timeout is recorded as `atlas_todo.register_worker.lock_timeout` (launch/mux registration) or `dispatch_tripwire.channel_lock_timeout` (Claude Code dispatch), never printed to stderr, and the note or dispatch proceeds.
- A Claude Code dispatch opens a channel only when it was allowed: `dispatch_tripwire._is_deny(out)` parses the emitted hook JSON (`hookSpecificOutput.permissionDecision`) rather than matching text.
- **Worker posting.** A mux or launch worker is registered by the lead side before it starts (`atlas_launch.launch`, `atlas_mux spawn`, which take the lead name from the channel registry entry). A headless mux worker posts exactly one `kind=report` note for its run: the `STATUS`..end block of its report, else its last 20 non-noise lines, then `exit N` (`[failed: <reason>]` on failure). Its full stdout and stderr go to `<project>/.atlas/.run/logs/<worker>.log` (and the pane), not to the board. It then calls `mark_finished` and leaves the channel. `atlas_mux kill` waits up to 2 s for the worker's own exit note, else posts the same-shaped report itself (`exit 137`) and marks it finished. Selffix workers (`fix-N`) run on their own `<main>/selffix` channel (`atlas_selffix.py`), never the lead's.

## Dashboard

The Channels page is `#/channels` (`js/pages/channels.js`; aliases `#/irc` and `#/agents?lens=channel`), the same Channel view as below as a top-level Operate page. The Colony roster (`#/colony`) reads the registry through `GET /api/v2/colony`; its states and routes are in `docs/atlas-colony.md`.

| Route | Use |
|---|---|
| `GET /api/v2/channels` (`?project=`) | The tree: every channel with members and presence. With a named project that has no registry rows, the main channel row is created |
| `GET /api/v2/channels/<url-encoded name>?since=&limit=` | `{channel, messages, more, board}`: members with `last_seen`, the channel's messages oldest first, and the board grouped by owner. `limit` defaults to 200 and is clamped to 1..1000; with `since` (a message id or an epoch) the oldest `limit` after it are returned and `more` says newer ones remain. 404 `no_such_channel` for an unknown name |
| `POST /api/v2/channels {channel, to, body, from, project}` | Post into an existing channel (token-guarded). 400 `channel_required`, 404 `no_such_channel`, 400 `invalid_to` for an address that is not `[A-Za-z0-9_.:-]` or `all`. A message to a named agent whose idle `claude`/`omp` herdr pane exists is typed into it (`delivery: delivered`); otherwise it stays queued for the worker's hook |
| `GET`/`POST /api/v2/irc` | Unchanged; the main channel |
| `GET /api/v2/projects/hp` | herdr-projects threads carry `channel` (`<repo-folder>@<branch>`), `channel_parent` (the repo's main channel) and `channel_path` (`<parent>/<channel>`) so the Projects page can chip a thread with its channel; documented in `docs/atlas-integrations.md` |

Both channel GETs need `X-Atlas-Token` because they expose message text. 503 `channels_unavailable` when the installed `atlas_todo` has no registry. The Channel lens (`dashboard_ui/js/pages/channel-lens.js`) is one column: a header (channel name, a channel select only when more than one channel exists, one dim `main · lead X · branch` line, one row of member chips), the message log (the last 100, `limit=100`; the only scrolling region, so the composer stays in view) and a composer (`To`, one textarea, Send). Clicking a member chip sets `To`; the small icon inside a chip opens that agent. `To = Everyone` posts to the channel (`POST /api/v2/channels`, `to: "all"`); `To = <member>` prompts that agent (`POST /api/v2/herd/agents/<pane>/prompt`) when its pane is idle, otherwise posts to the channel addressed to it. Message bodies are plain monospace text (only pane ids link to the agent), and a delivery glyph appears only on a `refused` or `undeliverable` message, with its reason as the tooltip. There is no channel tree, Members column or "Load earlier messages" button; the per-member board is the Board tab below, and the whole todo board is the Board lens.

**Board tab and Supervision.** The Channel lens has a **Messages | Board** switch. Board renders `board.owners[]` from `GET /api/v2/channels/<name>` joined to the channel's members (lead first): per member the role chip, presence (live pane state matched by name or pane id, else the API state, else "no pane"), todo counts (active, open, blocked, done), the in-progress item, every todo item, the last note with its age, **Message** (sets `To`) and **Open** (agent inspector). A channel with no board items says so. A lead subchannel's header has **Supervise**, which opens `#/agents?lens=supervision&channel=<name>`: that lens (`js/pages/supervision-lens.js`, chord `g u`) draws one tree per lead subchannel (parent link = the main channel), the lead row and its subagents nested with the same rows. Fleet cards of a lead (an agent with subagents, or the member that `lead` names) carry a **Supervise** chip. Colony stays the herdr frame; a native `colony-lens.js` never shipped.

**Multiplexer hardening (10.4.3).** `atlas_mux` strips `TMUX` and `TMUX_PANE` from the env it gives spawned workers, tmux calls have a 10 s timeout, and a missing or wedged tmux returns `ok:false` instead of crashing or hanging. Doctor cmux checks are info-only when cmux is not the active terminal.

**Delivery status and posting (10.4.3).** The Channels page defaults to the working lead channel and labels it "(current)"; its POST carries `project` (fixes `no_such_channel`). The pane-prompt shortcut that bypassed the board is removed, and "Everyone" posts to the current channel, not main. Each message shows delivery status (queued / delivered to X at time) from `worker_inbox` receipts written on drain; a skipped note is no longer shown as read. Drafts survive the 8 s poll.

**Lead delivery (10.4.3).** Notes to the lead (`to=lead-<id>`, alias `lead`, or `to=all` on the lead channel) are injected into the lead session by the PostToolUse hook (`dispatch_tripwire` -> `worker_inbox`; in omp the same path via hook-bridge `tool_result`). A bare `to=lead` is resolved to the channel's lead, so its delivery receipt is tracked (it was always shown as read before).

**omp terminal view (2026-10-09).** On omp the lead's terminal shows an `atlas-channel` widget while `task` subagents run (`omp/channel-view.ts`): channel name, the last 8 notes as `from -> to: text`, and a working/finished roster. It stays up while any member is unfinished, closes after 3 quiet polls with all members finished (or 30 minutes), and clears 15 s later. omp's own IRC relay card hides lead<->child messages and expires after 10 s; atlas shows that traffic through the board mirror of `write agent://`. Workers are now required to post at start, on shared-contract changes, and before their final report. `ATLAS_CHANNELS=off` disables the widget.

## Limits

- One project root and one branch per main channel; the registry lives in the project's `.atlas/.run/`, so a channel never spans projects.
- Presence in the dashboard is the member's live herdr state, or "posted Nm ago" from its newest message; members without a herdr pane are not drawn as agents.
- Delivery to a worker happens on its next tool call (hook) or its next `inbox` run; there is no push into a busy pane.
- The omp agent-id to member match is fuzzy by design (see above); it is not confirmed against every omp release.
- Nothing prunes the registry; `leave` removes a member (`atlas_todo.leave`), channels stay.
- Completion gate (p) counts channel activity per run: a board note on this run's lead channel (`<main>/lead-<first 6 of the session id>`), at or after the run start, whose owner is a registered or departed member that is not a lead, or IRC/`SendMessage` traffic, satisfies it. A lead's own note, another lead's channel and a non-member's note do not count; two or more atlas workers with none still block, once per session. `agent://` traffic logged under sibling run ids of the same session also counts, the block message names the one fix command, and after `BLOCK_LOOP_LIMIT=3` identical consecutive blocks the 4th Stop is allowed and `gate_block_loop` friction is recorded. See `docs/atlas-harness-parity.md`, gate (p).
- The note `owner` is self-asserted: a process that knows a registered member's name can post as it and be delivered to the lead. Workers started outside `atlas_launch`, `atlas_mux spawn` or a dispatch are not registered; their notes land on the main channel.
- The omp lead has no `CLAUDE_ENV_FILE` equivalent for its bash tool yet, so `atlas_mux spawn` run from an omp lead registers its workers in `<main>/lead`, not in the lead's `lead-<sid6>` subchannel.
- Tests must never use the OS temp root as cwd: channel code walks up to the nearest `.atlas` and creates `.atlas/.run/channels.json` there (a channel named after the directory, e.g. `T`), after which every temp-dir fixture resolves that directory as its project root. `omp/worker-report.test.ts` was fixed to use a private `mkdtemp` directory; `scripts/test_no_tmp_marker.py` fails if `.atlas` exists in `$TMPDIR` or `/tmp` or if an omp/hooks/scripts test passes the bare temp root as `cwd`.
- The Claude Code terminal view of a channel is the Atlas mod's Channel tab (`plugins/atlas/mod/`): a read-only viewer over the same registry and `board/<owner>.jsonl` notes with a per-file byte cursor. It never runs `atlas_todo.py inbox` (so it cannot drain a lead's mail) and composes only through the documented `note` argv. `ATLAS_MOD=off` disables it. Full model: `docs/atlas-mod.md`.

## Collaboration protocol (claims, handoffs, blocked)

Workers on one channel must not race each other's files or idle silently. The
collaboration layer adds four read/write commands to `atlas_todo.py` —
`claims`, `claim-paths`, `release-paths` and `conflicts` — plus three note
kinds alongside `report`: `claim`, `handoff` and `blocked`.

**Commands.** `claims` lists which worker currently claims which item;
`claim-paths` records the file paths a worker is editing; `release-paths`
releases them when the worker finishes (a path held by another worker blocks a
second claim, so two workers never edit one file); `conflicts` shows paths
claimed by more than one worker so the lead can arbitrate.

**Worker rules.**

1. Claim every todo and every file path before editing it.
2. On a conflict (a path or item already claimed by a peer), message that peer
   via a `note` before touching anything; never take a live claim
   (`_CLAIM_STALE_S` of silence makes one stale and takeable).
3. Post a `handoff` note when another worker consumes your output — it names
   the consumer and what to consume — so the consumer does not wait on a lead.
4. Post a `blocked` note instead of idling; a silent worker with an open todo
   reads as `stuck` on the colony roster, not as working.
5. Never skip verification because a peer said it passed; each worker runs the
   checks for its own slice.
6. Only the lead declares work done. A worker's own `exit 0` or `report` note
   is never a completion signal.

**Surfaces.** The Claude mod's Collab tab (`plugins/atlas/mod/`) and the
contract-track band render `claims` and `conflicts` live: claimed items show
the holder, conflicts light the band's `blocked` colour, and handoff/blocked
notes appear in the channel log. Completion gates and verifier requirements are
unchanged: this protocol coordinates work, it never relaxes gate (p), the
`.atlas/.run/findings.json` verdict requirement, or any Stop-hook block.
