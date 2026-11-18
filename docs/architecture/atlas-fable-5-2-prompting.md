# Atlas and the Fable 5.2 prompting guide

Anthropic publishes a guide called "Prompting Claude Fable 5.2" (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2). It explains how to write prompts for that model: set effort deliberately, say when a task is finished, name who owns the code, keep the user informed, explain what a subagent costs, and give the reason behind every rule. Atlas is mostly prompt text (agents, skills, hook messages, output style), so as of atlas 17.30.0 that text follows the guide. This page records how, so a reader who has not seen the work can keep it that way.

## Guide sections and what atlas does

| Guide section | What the guide says | What atlas does now | Open follow-up |
|---|---|---|---|
| Calibrate effort | Choose effort by a sweep on your own evals. | Agent `effort:` and `model:` values are unchanged. | Run an eval sweep, then revisit; validate `xhigh` and `max` effort values. |
| Finish the whole task | Tell the model to keep going through ordinary obstacles. | `## Finishing work` in `plugins/atlas/references/operating-contract.md` and `agent-common.md`; every file in `plugins/atlas/agents/` and `plugins/atlas/omp/agents/` points at it; `hooks/session_boot_core.py` repeats it. | None. |
| Approvals | Name the exact action an approval covers. | Approval rules in `skills/atlas-orchestrate/references/laws-and-gates.md`, `skills/atlas-ship/SKILL.md` and hook messages name the action. | None. |
| Say who owns the code | Say whose code it is; leave it out when the user owns it and wants minimal change. | Ownership sentence only in `skills/atlas-refactor/SKILL.md` and `references/diff-pass.md`. | None. |
| Keep users informed | Open with a line, update on the way, finish with a recap. | `output-styles/atlas-orchestrator.md`, `hooks/session_boot_core.py`, `omp/lead-addendum.md`. No hook counts silent tool calls; the Claude Code harness already sends a reminder. | None. |
| Set expectations for subagents | Say that a subagent costs context and when to use one. | `skills/atlas-orchestrate/SKILL.md`, `references/subagent-kit.md`, `CLAUDE.md`, `AGENTS.md` name the simple-task exemption and the cost. | None. |
| Keep caution from piling up | Delete cautions whose reason no longer holds, and write absolute rules with their scope and reason. | "Never" rules in agents, skills and hook text now carry a reason. `hooks/memory_capture.py` adds ` [noted YYYY-MM-DD]` to each captured caution, `scripts/recalled_memory.py` tells the model to check that a recalled caution still holds, and `scripts/atlas_memory.py` ignores the date when it removes duplicates. | Nothing prunes old entries from `.atlas/memory/MEMORY.md`; review that file by hand. |
| Review prompts designed for earlier models | Reconsider standing delegate-everything lines, token budgets shown to the model, hard style limits, think-less lines and harness code that edits earlier turns. | Sentence-length caps removed from `skills/atlas-prompt/SKILL.md` and `hooks/prompt_optimizer_core.py`. "Delegate even when small" lines removed from `skills/atlas-orchestrate/`. Stale telemetry cautions removed from `references/anti-rationalization.md`. The audit found no token budget and no think-less line in atlas. | omp system-prompt appends in `omp/advisor.ts`, `omp/mandates.ts`, `omp/hook-bridge.ts` need verification first. |
| Make reports easy to follow | Plain full sentences for a reader with no context. | `## Communicating clearly` in both references; crew, team and todo prompts (`scripts/atlas_crew.py`, `atlas_mux.py`, `atlas_todo.py`) ask for one or two sentences at the end. | None. |
| Safeguard refusals | A declined request returns a refusal stop reason. Remove instructions that ask the model to write its reasoning into the reply. | `skills/atlas-debug/` and `skills/atlas-bakeoff/SKILL.md` no longer ask for a step-by-step causal chain or "the reasoning" in the reply; they ask for the conclusion and its evidence. | Refusal stop-reason handling in crew and team workers needs verification first. |

## Canonical text

The shared wording lives in `plugins/atlas/references/operating-contract.md` and `plugins/atlas/references/agent-common.md`, in the sections "Finishing work" and "Communicating clearly". Other files point at those sections or repeat them briefly; change the canonical text first.

## Contract test

`plugins/atlas/hooks/test_fable52_guide.py` pins the text the guide asks for and bans the text it says to remove. Run it with:

    python3 -m pytest -q plugins/atlas/hooks/test_fable52_guide.py

## Not changed, on purpose

- Agent `effort:` and `model:` values: the guide says to choose effort by a sweep on your own evals, and none was run.
- Gate behavior and thresholds: wording only. The delegation gates still enforce; the text now names the simple-task exemption and what a subagent costs.
- No new hook that counts silent tool calls: the Claude Code harness already sends the "user hasn't heard from you" reminder, and the lead text now asks for an opening line, updates and a recap.
- The ownership sentence is added only to atlas-refactor: the guide says to leave it out where the user owns the code and wants minimal change.
- Open follow-ups that need verification first: omp system-prompt appends in `omp/advisor.ts`, `omp/mandates.ts` and `omp/hook-bridge.ts`; refusal stop-reason handling in crew and team workers; validation of `xhigh` and `max` effort values.

## Rules for future edits

- State the reason with any "never" or "always" rule, so the model can judge edge cases.
- Do not add word caps or sentence caps.
- Do not add token budgets.
- Do not ask the model to write its reasoning into replies.
- In an approval rule, name the exact action the approval covers.
- Run the contract test before you commit.
