# orchestrate

A self-contained Claude Code plugin that turns any coding agent into a disciplined
**multi-agent orchestrator**, and turns vague prompts into precise, environment-aware
instructions for it to execute.

What ships together:

| Piece | What it is |
| --- | --- |
| **`atlas` skill** | The orchestrator playbook: decompose a task, route every code edit to a subagent, demand execution evidence, verify with a second agent, and protect the main context window. Triggers on whole-codebase build/fix/audit/refactor/investigate work. |
| **UI/UX test swarm** | A project-independent, browser-driven full UX pass folded into the skill (`references/ux-test-swarm.md` + five `orc-ux-*` agents). Discovers any web app's routes/fields and live save contract, generates personas that enroll and enter data through the real UI, walks and fuzzes it, recomputes every client-facing number with an independent oracle, and emits gated bug/user-story/feedback/feature-request reports. Detects and reports app bugs; never edits the target app. |
| **Command library** | Thirteen verification-gated `/orc-*` launchers that replace prompts you used to paste by hand. Each injects the shared **Operating Contract** (the verify-loop, anti-hallucination grounding, conduct rules) at runtime, then drives a specific task through the squad. See the Commands section below. |
| **`operating-contract` skill** | The neutral engineering contract every launcher shares (research, document, implement, verify, report). Invoke `/operating-contract` to apply it to any task, or set your own stack, brand tokens, and compliance framework in your project `CLAUDE.md`/`AGENTS.md` and the launchers honor it. |
| **`/atlas-prompt` command** | On-demand prompt optimizer for agentic coding. Discovers the tools/skills/subagents *actually* loaded this session and rewrites a "noob" prompt into a structured `# Optimized Prompt` block: methodology, mandatory verification gates, a subagent plan, and acceptance criteria. No external dependency. |
| **`prompt-optimizer` skill + Modelfile** | The passive path: a chat-oriented prompt rewriter skill, plus the ollama `Modelfile` that powers the optional automatic `UserPromptSubmit` hook. |

## Layout

```
orchestrate/
├── .claude-plugin/plugin.json     # manifest
├── agents/                        # 14 subagents, auto-registered on install
│   ├── atlas:explorer.md            #   read-only codebase mapping
│   ├── atlas:implementer.md         #   bounded, verified code edits
│   ├── atlas:verifier.md            #   adversarial confirm/refute
│   ├── atlas:db-prober.md           #   read-only schema/RLS/index inspection
│   ├── atlas:ui-runtime-tester.md   #   live browser/runtime behavior
│   ├── atlas:planner.md             #   multi-stage decomposition + stage maps
│   ├── atlas:docs-curator.md        #   maintains the docs/ single source of truth
│   ├── atlas:docs-auditor.md        #   audits docs/ for drift against code
│   ├── atlas:completeness-critic.md #   "what did we miss" gap pass before done
│   ├── atlas:ux-cartographer.md     #   UX swarm: discover routes/fields + save contract
│   ├── atlas:ux-persona.md          #   UX swarm: enroll, enter data, walk UI, file findings
│   ├── atlas:ux-fuzzer.md           #   UX swarm: boundary/fuzz the discovered inputs
│   ├── atlas:ux-accuracy-oracle.md  #   UX swarm: independent recompute of client numbers
│   └── atlas:ux-reporter.md         #   UX swarm: synthesis + three hard gates + deliverables
├── commands/                      # 14 slash commands (1 prompt optimizer + 13 launchers)
│   ├── atlas-prompt.md              #   prompt optimizer
│   ├── atlas-feature.md             #   full-stack feature build
│   ├── atlas-frontend.md            #   design-system UI build/refactor
│   ├── atlas-component.md           #   latency/cancellation-resilient component
│   ├── atlas-debug.md               #   reproduce, root-cause, fix, verify
│   ├── atlas-refactor.md            #   behavior-frozen restructuring
│   ├── atlas-readme.md              #   evidence-grounded README generator
│   ├── atlas-gitignore.md           #   zero-trust allowlist .gitignore
│   ├── atlas-handoff.md             #   session handoff / state preservation
│   ├── atlas-db-audit.md            #   read-only parallel DB audit + remediation plan
│   ├── atlas-grafana.md             #   Grafana SQL panel / dashboard builder
│   ├── atlas-m365.md                #   M365/Entra/Graph/Intune identity task
│   ├── atlas-vendor-assessment.md   #   evidence-based vendor security assessment
│   └── atlas-harden.md              #   idempotent CHECK/SET/VERIFY hardening script
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
| `/atlas-feature` | Build a full-stack feature across UI, API, and data with curl + read-back evidence |
| `/atlas-frontend` | Build or refactor UI on one design system (shadcn/ui + Tailwind + Radix), all four states |
| `/atlas-component` | Build a reusable component resilient to latency, cancellation, and partial failure |
| `/atlas-debug` | Reproduce a failing behavior, name the root cause, fix in place, prove the symptom is gone |
| `/atlas-refactor` | Restructure code with behavior frozen and proven unchanged, step by step |
| `/atlas-readme` | Generate an onboarding README grounded in the actual repo, every claim traceable |
| `/atlas-gitignore` | Generate a zero-trust deny-by-default `.gitignore` for a named stack |
| `/atlas-handoff` | Produce a high-density session handoff so a fresh session resumes with zero re-discovery |
| `/atlas-db-audit` | Run a strictly read-only parallel DB audit and hand back a remediation plan to approve |
| `/atlas-grafana` | Build or fix a Grafana SQL panel for any datasource and dialect |
| `/atlas-m365` | Deliver a Microsoft 365 / Entra / Graph / Intune config with least-privilege scopes and read-back |
| `/atlas-vendor-assessment` | Assess a vendor against a control framework you name, strictly from provided evidence |
| `/atlas-harden` | Write an idempotent CHECK/SET/VERIFY endpoint hardening script for RMM/MDM deployment |

## Install

**As a plugin (Claude Code):** place this directory under your plugins root (or install
from the marketplace once published). The skills, the fourteen `/orc-*` commands, and the
fourteen `orc-*` subagents are discovered automatically.

**As a bare skill (any agent):** copy `skills/atlas-engine/` into the agent's skills
directory. It is internally self-contained - `scripts/install_hooks.py` finds its hooks
via a path relative to itself, and the skill dispatches subagents by name. Note that the
`orc-*` subagents live at the plugin root, so a bare-skill copy won't auto-register them;
copy `agents/` alongside if you need them.

## Hooks (opt-in, fail-safe)

The atlas-engine skill ships four stdlib-only hooks. Each passes through silently on any
error, so they can never block a session. They are **not** auto-loaded - install on demand:

```bash
# from the skill directory:
python3 scripts/install_hooks.py --list      # show current coverage
python3 scripts/install_hooks.py             # dry-run plan
python3 scripts/install_hooks.py --apply     # install default set (optimizer, format, guard)
python3 scripts/install_hooks.py --select completion-gate --apply   # opt into the Stop gate
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

It is not required - the hook passes through if no model is reachable, and `/atlas-prompt`
does the same optimization with no external service at all. Override the backend with
`ORCHESTRATE_OPTIMIZE_CMD`, `ORCHESTRATE_OPTIMIZER_MODEL`, or `ORCHESTRATE_OLLAMA_URL`
(see `skills/atlas-engine/references/hooks-automation.md`).

## Recommended MCP servers

The orchestrator is sharpest with a docs resolver (**context7**), a symbol/LSP server
(**serena**), and a memory server (**claude-mem**) available - but it degrades gracefully
and references only the tools actually present in the session.

## License

Apache-2.0 · © w159
