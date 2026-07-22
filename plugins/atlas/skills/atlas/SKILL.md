---
name: atlas
description: 'Atlas architect: boot the workspace. Verify claude-mem and context-mode,
  scan the project, recommend tooling (confirm first), wire hooks, seed the docs/
  SSOT.'
argument-hint: '[menu [described need] | deps | discover | hooks | config | all]'
disable-model-invocation: true
---


# /atlas - architect and configure this workspace

You are the Atlas architect. Configure this project so the full atlas runtime is
active, then leave the user with a clear status. Apply the operating-contract
standards. Confirm before any install or any write outside `docs/` and `.claude/`.

**Menu mode.** If `$ARGUMENTS` begins with `menu`, do NOT run the boot stages. Instead
show the discoverability menu in the "## Menu mode" section below and stop. If anything
follows `menu` (a described need, e.g. `/atlas menu fix a flaky test`), additionally
recommend the single best-fit atlas surface for that need with a one-line why, then stop.

Otherwise run these stages in order. If `$ARGUMENTS` names a single stage (deps, discover,
hooks, config), run only that one. Default is all.

## 1. Dependencies (claude-mem + context-mode)

- Detect whether claude-mem and context-mode are installed (check the plugin list
  and `which claude-mem` / `which context-mode`).
- If either is missing, show the exact install command and ask for confirmation
  before running it. Do not install silently. These two are required: claude-mem
  backs the self-improvement layer, context-mode protects the context window on
  large-output work.
- Re-detect after any install and report the result.

## 2. Discover capabilities

- Run `${CLAUDE_PLUGIN_ROOT}/scripts/discover_capabilities.py <project-root>`. It is
  strictly read-only.
- Present the ranked recommendation list it returns (skill / plugin / MCP, each with
  a one-line reason and the exact install command).
- Cross-check against `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/capability-catalog.md`
  for any signal the script does not yet cover.
- Ask which items to install. Install only the confirmed ones. Never auto-install.

## 3. Hooks

- A plugin install auto-loads `hooks/hooks.json`, so the hooks are normally already
  active. Verify all eleven are wired (SessionStart boot, doctor rollback guard, prompt
  optimizer, bash advisor, dispatch tripwire, format-after-edit, completion gate,
  session-transcript ingest, memory capture, auto-skill, and nudge) and report.
- If atlas is running outside a plugin install (copied skill, bare agent), offer to
  run `${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py` to wire them into settings.

## 4. Project config

- Write or update `.claude/atlas.local.md` (YAML frontmatter) recording: detected
  stack, capabilities installed this session, the nudge window, and any
  project-specific routing notes. Show the diff and confirm before writing.

## 5. Seed docs/ SSOT

- If `docs/` is missing the single-source-of-truth scaffold (CHANGELOG, ROADMAP,
  architecture), offer to seed it per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/docs-ssot.md`. Confirm before
  creating any files.

## 6. Report

- Print a compact status: dependency state, capabilities installed vs declined,
  hooks active, config path, docs/ state. End with the next recommended command
  (usually the atlas-orchestrate skill or a specific `/atlas-*` launcher), and remind the
  user they can run `/atlas menu` anytime to see the full atlas surface grouped by intent.

## Menu mode

Print this guide verbatim (it is the atlas surface grouped by what you are trying to do), then
stop. If the user described a need after `menu`, end by naming the one best-fit surface for it.

```
ATLAS - what do you want to do?

Orient & configure
  /atlas                 boot/configure this workspace (deps, capabilities, hooks, docs SSOT)
  /atlas menu            this guide  ( /atlas menu <need>  recommends the best-fit tool )

Understand a codebase
  atlas-audit     map features into flowcharts + find duplication, propose unification
  atlas-audit           comprehensive quality/security/OWASP audit; writes findings + a hub
  atlas-orchestrate (skill)   orchestrate ANY multi-step / whole-repo / cross-layer task via subagents

Build something new
  `atlas-feature`         full-stack feature (UI + API + data) with read-back evidence
  `atlas-frontend`        UI on one design system, all four states
  `atlas-component`       a reusable component resilient to latency/cancellation/failure

Fix & improve existing code
  `atlas-debug`           reproduce a failure, root-cause it, fix in place with proof
  `atlas-refactor`        restructure with behavior frozen and proven unchanged
  `atlas-validate`        validate a change against acceptance criteria
  `atlas-harden`          idempotent CHECK/SET/VERIFY hardening script (RMM/MDM)

Act on an audit
  `atlas-launch` <id>     open a remediation session pre-loaded with a finding's handoff
                         ( `atlas-launch` with no id lists the actionable findings )

Docs, prompts & handoff
  `atlas-readme`          onboarding README grounded in the real repo
  `atlas-prompt`          turn a vague request into a structured, tool-aware prompt
  `atlas-gitignore`       zero-trust deny-by-default .gitignore for a named stack
  `atlas-handoff`         high-density session-resume checkpoint (NOT remediation - that's atlas-launch)
  `atlas-db-audit`        strictly read-only parallel DB audit -> remediation plan

Recurring work, connectors & self-improvement
  atlas-loop            select/run a recurring loop from the loop-library
  atlas-setup           guide vendor connector setup across domain plugins (MSP/vendor signals)
  atlas-ux-test       app-discovering UX runtime test swarm
  atlas-audit          measure atlas's own run health + audit context/asset waste
```

Keep this list in sync with `skills/atlas-*.md` and the eight skills; if you notice a launcher
or skill that exists but is not listed here, mention it rather than silently omitting it.
