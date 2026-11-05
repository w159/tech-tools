# atlas-prompt eval and rebuild (2026-11-05, Atlas 17.1.0)

The old skill kept 52 of 68 goals intact (16 weakened), added 169 items nobody asked for, and could not
trigger on its own (it was manual-only). The shipped skill keeps 65 to 68 of 68 goals across seven
rewrite runs (none dropped), adds 0 to 3 items per run, writes about a sixth as many words, triggers on
30 of 30 positive runs with 0 false fires in 36 negative runs, and has a separate judge model check every
rewrite.

## Method

All runs use real Claude Code sessions (`claude -p`, Claude Code 2.1.318, sonnet as the rewriter) with
`--setting-sources ""` and `--strict-mcp-config`, so nothing from the user's config loads. The runner and
cases ship with the skill:

- `plugins/atlas/skills/atlas-prompt/evals/run_eval.py` (rewrite, grade, trigger, report)
- `plugins/atlas/skills/atlas-prompt/evals/cases.json`: 16 rewrite cases. 3 are SKIP cases (thanks, ok, an
  already optimized prompt), 6 are short requests, 7 are real requests taken from earlier work in this repo.
  Each has a hand-written gold list of the goals and limits the rewrite must keep (68 items in all).
- `plugins/atlas/skills/atlas-prompt/evals/trigger_cases.json`: 22 trigger cases, 10 that should fire and
  12 that should not (near misses such as "write me a script", "review this PR", "explain this prompt
  error"). The trigger run loads the whole Atlas plugin, so atlas-prompt competes with the other 39 skills.

Grading uses opus in a fresh context as the judge, one call per case, marking each gold item KEPT,
WEAKENED, DROPPED or UNKNOWN and listing anything ADDED. A deterministic check first confirms that the
user's hard tokens (paths, names, numbers, quoted text) appear in the rewrite. The baseline is the
SKILL.md at 66627831 (Atlas 17.0.1).

Commands:

```sh
cd plugins/atlas/skills/atlas-prompt/evals
git show 66627831:plugins/atlas/skills/atlas-prompt/SKILL.md > /tmp/old.md
python3 run_eval.py rewrite --skill /tmp/old.md --label old --out res
python3 run_eval.py grade   --out res --label old
python3 run_eval.py trigger --skill /tmp/old.md --label old --out res
python3 run_eval.py rewrite --skill ../SKILL.md --label new --out res
python3 run_eval.py grade   --out res --label new
python3 run_eval.py trigger --skill ../SKILL.md --label new --out res --reps 3
python3 run_eval.py report  --out res --labels old,new
```

## Results

| measure | old (17.0.1) | new (17.1.0, final run) |
|---|---|---|
| gold items kept | 52 / 68 | 67 / 68 (range 65 to 68 over 7 runs) |
| weakened / dropped | 16 / 0 | 1 / 0 (range 0 to 3 weakened, 0 dropped) |
| items added that the user never asked for | 169 | 1 (range 0 to 3) |
| SKIP cases handled | 16 / 16 | 16 / 16 |
| hard tokens missing (deterministic check) | 1 | 0 |
| median words, short requests | 662 | 101 |
| median words, complex requests | 1094 | 212 |
| total words, all 16 cases | 10020 | 1628 |
| output tokens, all 16 cases | 28436 | 24915 |
| rewriter cost, all 16 cases | $1.125 | $1.205 |
| median seconds per case | 23.4 | 59.2 |
| trigger recall | 0 / 20 (manual only) | 30 / 30 |
| trigger false fires | 0 / 24 | 0 / 36 |

The new seconds and cost include the session time spent waiting on the judge. The judge call itself is a
separate process: measured at $0.0084 to $0.0123 and 8 to 10 seconds per call, at most 2 calls per rewrite
(one retry after a fix).

The 16 weakened items in the old skill were mostly limits turned into softer wording or buried under
added sections (TDD steps, subagent plans, changelog work). The 169 added items are the main reason for
its length.

Run-to-run noise. The same SKILL.md rewritten three times (new7, new7b, new7c) kept 68, 67 and 66 of 68
and added 0, 0 and 2 items, so a difference of one or two items between versions is inside the noise. The
gap to the old skill (52 kept, 169 added) is not. The one item the final run added (case real-bytesavvy:
"ask me for the site's repo or path if you cannot find it") recurs across runs.

## Iterations

| round | change | result |
|---|---|---|
| new1 | rewrite of SKILL.md, auto-invoked, judge added | 67/68 kept, 5 added |
| new2 | description rewritten for triggering | trigger 18/20, missed "tighten this prompt" |
| new3 | description adds tighten, shorten, sharpen, inline one-line prompts | trigger 20/20, 0 false |
| new4 | shorter description (498 chars) | trigger 27/30: reverted |
| new5 | body: assumptions labelled, project rules named as theirs | 67/68 kept, 5 added |
| new6 | new3 frontmatter, 3 reps | trigger 30/30, 0/36 false |
| new7 | short form gets Limits/Assumptions lines; "Ask before" only for irreversible or outward steps | 68/68 kept, 0 added; reruns 67/0 and 66/2 |
| new8 | description cut to 396 chars for the repo's 400-char rule; completion lines on steps 3 and 5; evals named | trigger 30/30, 0/36 false; 66/68 kept, 3 added; reruns 66/2 and 65/0 |
| new9 (shipped) | new8 frontmatter, final body | 67/68 kept, 1 added |

## What the research said and where it landed

| guidance | source | in the skill |
|---|---|---|
| Drop CRITICAL/MUST and old anti-laziness scaffolding; newer models over-apply it | [Anthropic, prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview) | step 4: plain imperatives, "never" only for the user's limits and destructive steps |
| Say what to do, not only what not to do | same | step 4 bullets |
| Smallest set of high-signal tokens | [Anthropic, effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | step 1 sizing, "when in doubt, go short" |
| Description in third person, what it does and when; evals before writing | [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | frontmatter; evals/ |
| description plus when_to_use share a 1,536-character cap | [Claude Code skills](https://code.claude.com/docs/en/skills) | 567 characters (description 396, under the repo's 400 rule) |
| Isolated judge per dimension, an Unknown answer, balanced positive and negative trigger cases, deterministic graders first | [Anthropic, demystifying evals for AI agents](https://anthropic.com/engineering/demystifying-evals-for-ai-agents) | `atlas_prompt_judge.py` and the eval |
| Start from a fresh, minimal prompt; state outcome, success criteria, constraints and stop rules; ALWAYS/NEVER only for true requirements | [OpenAI, GPT-5.5 guide](https://developers.openai.com/api/docs/guides/gpt-5.5) | short form: outcome, "Done when", "Limits" |
| Contradictions waste reasoning | [OpenAI, GPT-5 prompting guide](https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide) | step 4: resolve conflicts or ask |

## The judge

`plugins/atlas/scripts/atlas_prompt_judge.py` runs after every rewrite:

1. A deterministic anchor check: every path, name, number and quoted string from the original must be in
   the rewrite.
2. A different model in a fresh context marks each goal KEPT, WEAKENED or DROPPED and lists ADDED items.
   It picks the model by harness: under Codex the judge is `claude`; elsewhere it is `codex` when installed,
   and otherwise `claude` in a fresh session with no tools. `ATLAS_PROMPT_JUDGE_CMD` overrides it.
3. Exit 0 pass, 1 fix the named items and rerun once, 2 no judge reachable (anchor check stands), 3 usage.

Tests: `plugins/atlas/scripts/test_atlas_prompt_judge.py`, 49 tests, mutation score 92.9% (91 of 98
mutants killed; the 7 survivors are equivalent: numeric constants and argparse formatting).

## Not measured

- Rewrites by GPT models through Codex. The eval runs only Claude Code sessions; no OpenAI key is
  available here.
- The skill's effect on the downstream task. The eval grades whether the rewrite keeps the user's goals,
  not whether the executing agent then does the work better.
