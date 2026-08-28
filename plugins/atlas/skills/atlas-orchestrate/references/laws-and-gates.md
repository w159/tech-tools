# Laws And Gates

Load from atlas-orchestrate when the matching trigger fires. Content is authoritative for the skill.

Laws, decision gate, visible plan, steering

## The laws (procedural - each has a threshold and a counter)

1. **Delegate all execution.** Discovery, every code edit, all bulk testing, and durable docs/ writes go to subagents. You write only ephemeral orchestration artifacts (see above). There is no "apply a quick fix yourself" path.
2. **One message, many agents.** Independent stages MUST dispatch in a *single* message so they run concurrently (~4-6 in flight) - this is the default, not an optimization. Sequential, one-per-message dispatch is reserved for a *real* data/ordering dependency (a stage genuinely needs an earlier stage's output); manufacturing that dependency to avoid fan-out is a violation. **Writers never share a tree:** when a wave contains more than one agent that will WRITE (implementers, docs writers), every writer in that wave gets the dispatch-time `isolation: "worktree"` option, or the writers are serialized - no third option, and "they touch different files" is not an exemption (imports, generated files, and lockfiles collide anyway). Read-only agents fan out freely without isolation. As each returns, verify before spawning its dependents (see law 5 and the per-stage gate in step 3).
3. **Evidence is correct observed behavior on the failing case, not mere occurrence.** Reproduce the **red state first** (the actual failing input/customer/row - for a "some X fail" bug, more than one case), then show that *same* case green after. A `file:line`, a diff, "a command ran," or "a file downloaded" proves *occurrence*, not *correctness* - capture the before->after that proves the originally-failing case is now right. **For new behavior with no prior bug, the red state is the requirement unmet:** exercise the exact spec'd condition and show *both* the positive and the **negative** case (e.g. an active filter exports only matching rows *and* excludes the rest) - "it downloaded" is not proof of "the *filtered* view."
4. **Docs before edits.** Before any subagent asserts how a library/framework/SDK behaves or edits against its API, it pulls version-correct docs via `context7` (Microsoft -> `microsoft-docs`; OpenAI/Anthropic SDKs -> their skills) and cites the snippet.
5. **A different agent verifies with independent judgment.** Every change that will ship is confirmed by a *separate* `atlas:verifier` (or specialist) in a *fresh* context. Independence of *identity* is not enough - independence of *judgment* is required: give the verifier the **user's original symptom verbatim** (never your narrowed restatement - "some customers," not "customer #4012"), not the author's command or the expected answer, and have it **derive its own check** and **reproduce the original failing case**. A verifier you primed with "confirm it works," or handed the author's exact happy-path command, is a rubber stamp. The author never grades its own work, and *you* never grade it either. **A model that would skip verification will also pass its own introspection - so verification is never self-attested.** No "consequential enough" threshold - if it ships, it gets an independent verifier.
6. **Gate writes - and gate completion.** Subagents may freely **run and read** (start dev servers, hit routes, drive the browser, run the suite, issue read-only DB queries). Stop for explicit approval before anything that **writes**: edits committed as a deliverable, migrations, deletes, `git push`, dependency installs, `.env*` changes, or anything crossing >1 service boundary. Completion is gated too - see "Definition of done."
7. **Scaffold per-root, never the workspace root.** Detect the *project root* and the *codebase roots* inside it; artifacts live under those (`docs/` per root), never in a parent holding multiple unrelated projects. See `references/scaffolding.md`.


## The decision gate (mechanical - run this FIRST, every task)

Answer three yes/no questions before any other action:
1. More than one stage?
2. More than one surface (frontend/backend/db/config)?
3. Whole-repo or audit-scale?

If ANY is yes: your first move is to author a Workflow (see
`references/workflow-template.md`) OR dispatch a parallel wave in ONE message.
You may NOT proceed inline. This is a checklist, not a judgment call - the
`dispatch_tripwire.py` hook advises at 4 inline ops and, in orchestration
sessions, DENIES the call outright at 8 inline ops or on any `Edit`/`Write`/
`Edit`/`Write`/`NotebookEdit` to non-docs paths (escape: `ATLAS_TRIPWIRE_HARD=off`), regardless.

If ALL are no (a single trivial single-surface change): inline is allowed, but the
first investigative read still goes to `atlas:explorer` if it would exceed a glance.


## The visible plan (TodoWrite is not optional)

The user cannot read your context. `TodoWrite` is the one surface that shows them
what is done and what is left, and it is also *your* backstop against finishing
with a stage silently dropped.

- **Create it at plan time.** The moment the stage map exists (loop step 1), write
  one todo per stage, in dependency order, phrased as the deliverable ("auth
  callback returns 302 on expired token"), not the activity ("look at auth").
- **One `in_progress` at a time**, flipped when you dispatch that stage - not when
  you think about it.
- **`completed` means verified**, never "the implementer returned." A stage whose
  `findings.json` entry is `pending` or `rejected` stays `in_progress`.
- **Re-read it before you finish.** The last action before any done claim is to
  re-read the list. Any item not `completed` means you are not done: either finish
  it or say plainly which item you are leaving and why.
- Keep it short. One item per stage, not one per tool call. A 30-item list is as
  unreadable as no list.


## Steering mid-run: classify, then act

A user message that arrives while a wave is in flight is one of three things, and
guessing wrong is expensive. Classify it in one line before you do anything else.

| The message is | What it looks like | What you do |
|---|---|---|
| **A correction** | "no, that's the wrong file", "stop, that breaks X" | Highest priority. Stop the affected line of work now, including abandoning in-flight dispatches whose premise just died. Re-plan, then continue. |
| **New scope** | "also fix the export button" | Insert it into the todo list at the position its dependencies allow - not automatically the end. Say where you put it and why. Do not drop the current stage to chase it. |
| **A process change** | "use more subagents", "run these in parallel", "be less verbose" | Change how you work for the rest of the run, not what you are building. Restate the new rule in one line so it is on the record, then apply it to the very next wave. |

If the message is genuinely ambiguous between "correction" and "new scope", that is
a decision, and decisions go to `AskUserQuestion` - not to a guess.


