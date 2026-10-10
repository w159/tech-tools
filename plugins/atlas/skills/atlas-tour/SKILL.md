---
name: atlas-tour
description: Guide a one-time, plain-language first-session walkthrough of atlas - the orchestrator style, one dispatch, one gate event, and one tiny real task run end to end with the file each step touches. Use on a first session with atlas, when atlas terms draw a blank, or when asked how atlas works. Run once per project; do not re-tour unless asked.
allowed-tools: Read, Glob, Grep, Bash
disable-model-invocation: true
---

# Atlas Tour

You are giving a new operator their first working session with atlas. Keep it
short, concrete, and real: every step names actual files under
`plugins/atlas/` (this repo's plugin source) and the project-relative
artifacts atlas writes. No step requires installing anything new. Do NOT run
this twice for the same operator: if the conversation shows the tour already
happened today, summarize what it covered in three lines instead and ask for
the first real task.

All paths below are repo-root relative. `plugins/atlas/...` is the plugin
source tree (the only place to edit atlas itself); `.atlas/.run/...` and
`docs/` are project-local artifacts atlas creates while working.

## The 30-second orientation

Atlas is a plugin that makes a coding agent work like a team: one orchestrator
(the agent you are talking to) breaks your request down, hands bounded pieces
of work to specialist subagents, and an independent verifier confirms each
result before anything is called "done". Three artifacts carry that story:

- The **operating contract** — `plugins/atlas/references/operating-contract.md`
  — is the five-step loop every piece of work follows: research, document,
  implement, verify, report (the loop section, "The loop, in order, every time").
- The **findings ledger** — `.atlas/.run/findings.json` (in whatever project
  you are working in) — is where verification verdicts are recorded. "Done"
  means a `verified` entry stamped during this run, not "looks right".
- The **hooks** — `plugins/atlas/hooks/` — are small Python checks wired in
  `plugins/atlas/hooks/hooks.json` that enforce the contract while you work.

Glossary (each term gets one line here, and again where it is used):
- **Dispatch** — one bounded packet of work handed to a subagent, with an
  explicit goal and finish line.
- **Gate** — a hook that can block an action or a premature "done" and tell
  you exactly what is missing.
- **Finding** — one row in `.atlas/.run/findings.json`: a claim plus an
  independent verdict.
- **Output style** — standing rules for how the agent phrases and closes its
  replies; loaded automatically.

## Step 1 — The voice: the orchestrator style

Every reply from atlas opens with one status line:

```
ATLAS | 🔍 research | mapping the two failing call sites
```

That line comes from the output style `plugins/atlas/output-styles/
atlas-orchestrator.md` (frontmatter `force-for-plugin: true`,
meaning it applies automatically whenever atlas is enabled — you did nothing
to install it). Explain to the operator, with the file open:

- The phases in the header are the loop's stages — research 🔍, theory 💡,
  test 🧪, validate 📋, implement 🔧, verify ✅, done 🏁, blocked ⛔ (the
  `Phases` line in the Status header section of `atlas-orchestrator.md`).
- The header counts verified plan items when one exists (the verified-progress
  rule in the Status header section of `atlas-orchestrator.md`), so progress
  on that line is real, not decorative.
- Two rules from the style matter most to a human reader: "deliver the literal
  ask" (a table means a table, not a summary — the "Deliver the literal ask"
  section of `atlas-orchestrator.md`) and "scope is what was named" (nothing
  unasked gets changed — the "Scope is what was named" section).

Point out: if a reply ever lacks the header, that is a bug worth naming.

## Step 2 — One dispatch: how work moves to a subagent

A dispatch is the unit of delegation. Show the operator the required shape:
`plugins/atlas/hooks/dispatch_tripwire.py` defines the six blocks every atlas
subagent must receive (constant `REQUIRED_SPEC_BLOCKS` in
`dispatch_tripwire.py`):
`GOAL`, `DELIVERABLE`, `SUCCESS CRITERIA`, `OUT OF SCOPE`, `STOP CONDITIONS`,
`REPORT`. If a dispatch omits them, the tripwire denies it
(`REQUIRED_SPEC_BLOCKS` in `dispatch_tripwire.py`) — the deny text
names the missing block. Why: without a finish line and a boundary, one agent
wanders for an hour.

Also show what a dispatch is NOT: it is not the orchestrator editing files
itself. The tripwire counts inline edits and, in an orchestrating session,
denies the unsanctioned 7th consecutive inline op with no dispatch between
(`DENY_THRESHOLD = 6` in `dispatch_tripwire.py`). Tell the
operator plainly: "if your edits suddenly get denied, it means the agent was
supposed to hand this work to a subagent — that is the guardrail working, and
the deny text says which way to go."

## Step 3 — One gate event: the "not done yet" block

Walk the completion gate: `plugins/atlas/hooks/completion_gate.py`, wired in
the `Stop` block of `plugins/atlas/hooks/hooks.json`. Its job, in plain terms: when
the agent says done, the gate re-checks the definition of done and blocks once
if it is not real. Read the operator just the conditions that matter at
first contact (the conditions list in the `completion_gate.py` module
docstring):

- (b) a `verified` entry stamped **this run** must exist in
  `.atlas/.run/findings.json` — yesterday's green does not count today;
- (g) verification coverage — every implementer dispatch is paired with an
  independent check: either an `atlas:verifier` subagent or a test run whose
  result was stamped via `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py`;
- (m) delegation — a run that wrote code must have dispatched at least one
  subagent, so the main thread never grows the codebase by hand.

When the gate blocks it names the exact letter and the specialist that closes
it (the block-once rule in the `completion_gate.py` docstring: "blocks and
names exactly which condition failed"). A pass is silent — silence is
success. One line on
the gate you meet even earlier: the recall gate
(`plugins/atlas/hooks/recall_gate.py`, wired in the `PreToolUse` block of
`hooks.json`) denies
non-memory tool calls until one real memory recall happens this session, so
first-hour denies usually mean "claude-mem is not configured yet", not
"something is broken".

Do not promise gate behavior changes here; the gate is what it is, and the
tour explains it, not patches it.

## Step 4 — One tiny task, end to end

Run one small, safe, real task with the operator — pick something trivially
scoped and observable in their actual project (e.g. "rename one clearly-dead
helper" is too big; prefer "find which script under the project tests X and
run it" or a one-file typo-level fix they confirm). Keep it inside the loop
and narrate the mechanics against real paths:

1. **Research** — the orchestrator states the task in its own words, loads
   tools once, orients with lean-ctx, and recalls memory (contract step 1,
   Research, in `operating-contract.md`). The status header
   shows 🔍 research.
2. **Dispatch** — the orchestrator writes a dispatch with the six blocks
   (Step 2) to one specialist, e.g. `atlas:explorer` for a read-only answer or
   `atlas:implementer` for a bounded edit. One dispatch, one GOAL.
3. **Result + verify** — the subagent returns the fixed REPORT container; the
   orchestrator runs the check, captures the output, and — if this run wrote
   code — records the verdict with
   `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py` so a `verified` row lands in
   `.atlas/.run/findings.json` (conditions (b) and (g)).
4. **Gate** — on Stop, the completion gate re-checks (Step 3). If the run is
   real, silence; if something is missing, the block names the letter and the
   fix. Show the operator whichever actually happens — both are teaching
   moments, and neither is a failure state.
5. **Report** — the orchestrator delivers the literal ask with the command
   run, actual output, and the file path changed (contract step 5,
   Report, in `operating-contract.md`), header at 🏁 done.

Keep the whole exercise under about ten minutes. If the project has no `docs/`
tree yet, say so and offer `atlas-setup` (manual) as the next step rather than
fabricating scaffolding mid-tour.

## Step 5 — Where to go next

Hand over `plugins/atlas/references/skill-finder.md`: the intent-to-skill
cheat sheet ("I want my test fixed" → atlas-debug; "review this PR" →
atlas-review). One line on the two manual skills (`atlas`, `atlas-setup`) and
one on asking for this tour again if anything above stops making sense.

## Tour quality bar

- Every claim points at a real file path that exists in this repo; if a path
  in this file is wrong, say so out loud during the tour rather than papering
  over it.
- Jargon is always glossed in one line before it is used (glossary above;
  repeat the gloss at first use).
- The tour explains the system; it never changes gates, hooks, or skill
  behavior.
