# orchestrate

A self-contained Claude Code plugin that turns any coding agent into a disciplined
**multi-agent orchestrator**, and turns vague prompts into precise, environment-aware
instructions for it to execute.

What ships together:

| Piece | What it is |
| --- | --- |
| **`orchestrate` skill** | The orchestrator playbook: decompose a task, route every code edit to a subagent, demand execution evidence, verify with a second agent, and protect the main context window. Triggers on whole-codebase build/fix/audit/refactor/investigate work. |
| **UI/UX test swarm** | A project-independent, browser-driven full UX pass folded into the skill (`references/ux-test-swarm.md` + five `orc-ux-*` agents). Discovers any web app's routes/fields and live save contract, generates personas that enroll and enter data through the real UI, walks and fuzzes it, recomputes every client-facing number with an independent oracle, and emits gated bug/user-story/feedback/feature-request reports. Detects and reports app bugs; never edits the target app. |
| **Command library** | Thirteen verification-gated `/orc-*` launchers that replace prompts you used to paste by hand. Each injects the shared **Operating Contract** (the verify-loop, anti-hallucination grounding, conduct rules) at runtime, then drives a specific task through the squad. See the Commands section below. |
| **`operating-contract` skill** | The neutral engineering contract every launcher shares (research, document, implement, verify, report). Invoke `/operating-contract` to apply it to any task, or set your own stack, brand tokens, and compliance framework in your project `CLAUDE.md`/`AGENTS.md` and the launchers honor it. |
| **`/orc-prompt` command** | On-demand prompt optimizer for agentic coding. Discovers the tools/skills/subagents *actually* loaded this session and rewrites a "noob" prompt into a structured `# Optimized Prompt` block: methodology, mandatory verification gates, a subagent plan, and acceptance criteria. No external dependency. |
| **`prompt-optimizer` skill + Modelfile** | The passive path: a chat-oriented prompt rewriter skill, plus the ollama `Modelfile` that powers the optional automatic `UserPromptSubmit` hook. |

## Layout

```
orchestrate/
├── .claude-plugin/plugin.json     # manifest
├── agents/                        # 14 subagents, auto-registered on install
│   ├── orc-explorer.md            #   read-only codebase mapping
│   ├── orc-implementer.md         #   bounded, verified code edits
│   ├── orc-verifier.md            #   adversarial confirm/refute
│   ├── orc-db-prober.md           #   read-only schema/RLS/index inspection
│   ├── orc-ui-runtime-tester.md   #   live browser/runtime behavior
│   ├── orc-planner.md             #   multi-stage decomposition + stage maps
│   ├── orc-docs-curator.md        #   maintains the docs/ single source of truth
│   ├── orc-docs-auditor.md        #   audits docs/ for drift against code
│   ├── orc-completeness-critic.md #   "what did we miss" gap pass before done
│   ├── orc-ux-cartographer.md     #   UX swarm: discover routes/fields + save contract
│   ├── orc-ux-persona.md          #   UX swarm: enroll, enter data, walk UI, file findings
│   ├── orc-ux-fuzzer.md           #   UX swarm: boundary/fuzz the discovered inputs
│   ├── orc-ux-accuracy-oracle.md  #   UX swarm: independent recompute of client numbers
│   └── orc-ux-reporter.md         #   UX swarm: synthesis + three hard gates + deliverables
├── commands/                      # 14 slash commands (1 prompt optimizer + 13 launchers)
│   ├── orc-prompt.md              #   prompt optimizer
│   ├── orc-feature.md             #   full-stack feature build
│   ├── orc-frontend.md            #   design-system UI build/refactor
│   ├── orc-component.md           #   latency/cancellation-resilient component
│   ├── orc-debug.md               #   reproduce, root-cause, fix, verify
│   ├── orc-refactor.md            #   behavior-frozen restructuring
│   ├── orc-readme.md              #   evidence-grounded README generator
│   ├── orc-gitignore.md           #   zero-trust allowlist .gitignore
│   ├── orc-handoff.md             #   session handoff / state preservation
│   ├── orc-db-audit.md            #   read-only parallel DB audit + remediation plan
│   ├── orc-grafana.md             #   Grafana SQL panel / dashboard builder
│   ├── orc-m365.md                #   M365/Entra/Graph/Intune identity task
│   ├── orc-vendor-assessment.md   #   evidence-based vendor security assessment
│   └── orc-harden.md              #   idempotent CHECK/SET/VERIFY hardening script
└── skills/
    ├── orchestrate/               # SKILL.md + references/ (incl. operating-contract.md) + hooks/ + scripts/
    ├── operating-contract/        # SKILL.md - the shared contract every launcher injects
    └── prompt-optimizer/          # SKILL.md + Modelfile
```

## Commands

Every launcher opens by injecting the shared Operating Contract, then runs its task through
the squad with explicit verification gates. Invoke with `/<name>`; pass the bracketed inputs
or let the command ask once for anything missing. They are neutral by design: set your stack,
brand tokens, and compliance framework in your project `CLAUDE.md`/`AGENTS.md`.

| Command | Use it to |
| --- | --- |
| `/orc-feature` | Build a full-stack feature across UI, API, and data with curl + read-back evidence |
| `/orc-frontend` | Build or refactor UI on one design system (shadcn/ui + Tailwind + Radix), all four states |
| `/orc-component` | Build a reusable component resilient to latency, cancellation, and partial failure |
| `/orc-debug` | Reproduce a failing behavior, name the root cause, fix in place, prove the symptom is gone |
| `/orc-refactor` | Restructure code with behavior frozen and proven unchanged, step by step |
| `/orc-readme` | Generate an onboarding README grounded in the actual repo, every claim traceable |
| `/orc-gitignore` | Generate a zero-trust deny-by-default `.gitignore` for a named stack |
| `/orc-handoff` | Produce a high-density session handoff so a fresh session resumes with zero re-discovery |
| `/orc-db-audit` | Run a strictly read-only parallel DB audit and hand back a remediation plan to approve |
| `/orc-grafana` | Build or fix a Grafana SQL panel for any datasource and dialect |
| `/orc-m365` | Deliver a Microsoft 365 / Entra / Graph / Intune config with least-privilege scopes and read-back |
| `/orc-vendor-assessment` | Assess a vendor against a control framework you name, strictly from provided evidence |
| `/orc-harden` | Write an idempotent CHECK/SET/VERIFY endpoint hardening script for RMM/MDM deployment |

## Install

**As a plugin (Claude Code):** place this directory under your plugins root (or install
from the marketplace once published). The skills, the fourteen `/orc-*` commands, and the
fourteen `orc-*` subagents are discovered automatically.

**As a bare skill (any agent):** copy `skills/orchestrate/` into the agent's skills
directory. It is internally self-contained - `scripts/install_hooks.py` finds its hooks
via a path relative to itself, and the skill dispatches subagents by name. Note that the
`orc-*` subagents live at the plugin root, so a bare-skill copy won't auto-register them;
copy `agents/` alongside if you need them.

## Hooks (opt-in, fail-safe)

The orchestrate skill ships four stdlib-only hooks. Each passes through silently on any
error, so they can never block a session. They are **not** auto-loaded - install on demand:

```bash
# from the skill directory:
python3 skills/orchestrate/scripts/install_hooks.py --list      # show current coverage
python3 skills/orchestrate/scripts/install_hooks.py             # dry-run plan
python3 skills/orchestrate/scripts/install_hooks.py --apply     # install default set (optimizer, format, guard)
python3 skills/orchestrate/scripts/install_hooks.py --select completion-gate --apply   # opt into the Stop gate
```

| Hook | Event | Purpose |
| --- | --- | --- |
| `prompt_optimizer.py` | `UserPromptSubmit` | rewrites the prompt through a local model before the agent sees it (trigger-gated; augments, never replaces) |
| `format_after_edit.py` | `PostToolUse` (Edit/Write) | runs the formatter after edits |
| `bash_guard.py` | `PreToolUse` (Bash) | nudges away from footgun shell commands |
| `completion_gate.py` | `Stop` | **opt-in** - blocks a premature "done" until verification evidence exists |

### Optional: the ollama-backed optimizer

`prompt_optimizer.py` reaches a local model over the ollama HTTP API and falls back to the
`ollama run` CLI. Reproduce the model from the bundled Modelfile:

```bash
ollama create prompt-optimizer -f skills/prompt-optimizer/Modelfile
```

It is not required - the hook passes through if no model is reachable, and `/orc-prompt`
does the same optimization with no external service at all. Override the backend with
`ORCHESTRATE_OPTIMIZE_CMD`, `ORCHESTRATE_OPTIMIZER_MODEL`, or `ORCHESTRATE_OLLAMA_URL`
(see `skills/orchestrate/references/hooks-automation.md`).

## Recommended MCP servers

The orchestrator is sharpest with a docs resolver (**context7**), a symbol/LSP server
(**serena**), and a memory server (**claude-mem**) available - but it degrades gracefully
and references only the tools actually present in the session.

## License

Apache-2.0 · © w159
