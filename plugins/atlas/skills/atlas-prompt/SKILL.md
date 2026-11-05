---
name: atlas-prompt
description: "Rewrites a rough prompt or request into a clear, right-sized prompt for a coding agent or chat model, then has a judge confirm every goal and limit survived. Use when asked to rewrite, improve, optimize, tighten, shorten or sharpen a prompt (even a one-line prompt pasted inline), whether a prompt is good, or to turn a rough idea into a spec or brief for an agent. Not for doing the task itself."
when_to_use: "rewrite this prompt, make this a better prompt, optimize my prompt, is this a good prompt, turn this into a spec for an agent, write me a prompt for ChatGPT, /atlas-prompt"
allowed-tools: Read, Glob, Grep, Bash, Write, AskUserQuestion
argument-hint: '<the prompt or request to rewrite>'
---

# atlas-prompt

Rewrite the request below into the prompt the user should have sent: same goals, same limits,
nothing added, sized to the job. You write the prompt; you do not do the task.

> $ARGUMENTS

If that is empty, use the user's latest substantive request; if there is none, ask for it and stop.

## 1. Size it

- **SKIP**: greetings, thanks, acknowledgements, status checks, and text that already starts with
  `# Optimized Prompt`. Output exactly `SKIP` and stop.
- **Short**: one deliverable with a clear target. A few lines: goal, done-when, limits.
- **Full**: several deliverables, open scope, or work that runs long. The sections in step 4.

A rewrite longer than the job needs costs the reader and the executing model. When in doubt, go short.

## 2. Ground it

Look up only what changes the wording: a path, symbol or command the request names, the project's own
rules (`CLAUDE.md`, `AGENTS.md`), and which tools, skills or subagents exist this session. A few lookups,
not an audit. Name an artifact only if you confirmed it; if the request names one you could not find,
keep the user's name and say it was not found.

## 3. Ask only what you cannot infer

If the goal, the scope or the standard of done is ambiguous and a wrong guess would change the result,
ask one round of at most three questions with AskUserQuestion, options first, your pick marked.
Otherwise state the assumption in the prompt, labelled as an assumption and never as one of the
user's limits, and move on. Never a second round; stop there.

## 4. Write it

Keep every goal and limit the user gave, in their terms. Copy limits, numbers, names, paths and
exceptions exactly ("except `src/api/v1`", "5 attempts per minute"). Then:

- State the outcome and how to tell it is done. List steps only where the user gave an order or the
  order matters.
- Add nothing the user did not ask for: no extra features, files, methodologies, TDD or subagent
  ceremony, docs or changelog work. Verifying the result (run the tests, show the output) is fine,
  and so are the project's own rules from step 2, named as theirs ("per CLAUDE.md: ...") so they do
  not read as the user's limits.
- Write plain imperatives. Save "never" and "do not" for the limits the user stated and for
  destructive or outward actions; drop capitals, "CRITICAL" and "MUST".
- If two requirements conflict, resolve it or ask; do not pass the conflict on.
- No placeholders: bake in the content the user gave, or tell the model to ask for it.

**Coding agent** (the request is about code, this repository or a task an agent will carry out).
Short form:

    # Optimized Prompt

    <one sentence: the outcome, with the exact names>
    Done when: <observable check>
    Limits: <the user's limits, verbatim; leave out if none>
    Assumptions: <only what you assumed in step 3; leave out if none>

Full form, in this order, leaving out any section with nothing to say:

    # Optimized Prompt

    ## Goal
    ## Context        (facts you confirmed that the agent needs)
    ## Requirements   (one line per goal or limit, user's terms)
    ## Done when      (observable, testable checks)
    ## Assumptions    (only what you assumed in step 3)
    ## Ask before     (only irreversible or outward actions the user did not ask for but the work could reach)

    ## Output style
    Write your replies, docs and reports in ASDSTE-100 Simplified Technical English, applied about 80%: short sentences (20 words max for procedures, 25 for descriptions), one instruction per sentence, active voice, approved common words, consistent terms. Keep technical names, code and quoted text unchanged. Relax a rule when it costs clarity.

The `## Output style` paragraph closes both forms, word for word.

**Chat model** (the user wants a prompt to paste into ChatGPT, Claude.ai or another assistant, or
the request is writing or analysis rather than work on code):
follow `references/chat-prompts.md`. One fenced block, no `# Optimized Prompt` header, no output-style
paragraph.

For a prompt that will run in a fresh subagent or be saved as a handoff, use the 7-section form in
`references/prompt-spec-template.md`.

## 5. Judge it

You do not grade your own rewrite. Write the original and the draft to two files with the Write tool,
then run the judge:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_prompt_judge.py" --original <original file> --rewrite <draft file>
```

The script checks the user's hard tokens (paths, names, numbers, quoted text) deterministically, then
sends both texts to a different model in a fresh context, which marks each goal KEPT, WEAKENED or
DROPPED and lists anything ADDED.

- Exit 0: confirmed, done.
- Exit 1: fix exactly the items it names (restore what was dropped or weakened, cut what was added),
  then run it once more. If it still fails, keep the better draft.
- Exit 2: no judge model was reachable; the anchor check alone stands.

## Output

The rewrite, then the report's `footer` value copied exactly on its own line. Nothing else: no notes on
the judge, no summary of changes. If the user asks what changed, explain then.

## Evals

Measured with `evals/run_eval.py` against `evals/cases.json` and `evals/trigger_cases.json`; results in `docs/audits/2026-11-05_atlas-prompt-eval.md`.
