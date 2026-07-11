# Claude Code Setup Audit & Tune

Sometimes the root cause is not the code: it's that Claude Code is missing a tool, plugin, or setting that would make the whole session faster, cheaper, or more capable. This is the orchestrator's "fix the toolbox, not just the bug" capability.

**Autonomy:** recommend first, then apply low-risk fixes **only with the user's approval** (batch them into one approval). Never silently mutate the user's `~/.claude` or a project's `.claude`.

**Verify commands live:** plugin-install syntax and marketplace names drift between versions. Before running any `/plugin ...` or settings edit, confirm the exact current form against the live `/plugin` UI, `claude --version`, or a fresh check of the relevant doc page (see "Authoritative sources" below). Do not fire a hard-coded command that may be stale.

## What to read

`~/.claude/settings.json` (+ `settings.local.json`), the project's `.claude/settings.json` (+ `.local`), `enabledPlugins`, `~/.claude/agents/` + `.claude/agents/`, hooks, MCP config (`~/.claude.json` projects/user scope, project `.mcp.json`), and the CLAUDE.md hierarchy. Use `context-mode` to read these without flooding context. Diff against the checklist below; produce a gap report; propose fixes ranked by leverage.

## High-leverage gap checks

### Token & context economy (usually the biggest wins)
- **Code-intelligence LSP plugins for active languages.** One LSP call replaces 3-10 file reads and gives automatic post-edit diagnostics. Detect languages from manifests; check `enabledPlugins` for the matching `*-lsp@claude-plugins-official` (e.g. `typescript-lsp`, `pyright-lsp`, `gopls-lsp`, `rust-analyzer-lsp`). Missing ones for a language in active use = recommend install + enable. (Note any `serena`/other symbol MCP already covering this, don't stack redundant nav.)
- **`permissions.deny` Read rules for build artifacts** so they never enter context: `Read(./**/dist/**)`, `Read(./**/build/**)`, `Read(./**/*.generated.*)`, `Read(./**/node_modules/**)`, `Read(./**/.venv*/**)`, `Read(./vendor/**)`.
- **`claudeMdExcludes`** (in `settings.local.json`) to skip CLAUDE.md for packages outside the task scope; and prefer launching from the relevant sub-package dir so sibling CLAUDE.md files don't load.
- **`subagentDefaults.maxTurns` / `contextHandling`** set, so subagents are bounded and can fork context off the main thread.
- Output-noise filters / `statusLine` cost readout if the user wants live spend visibility.

### Automation & safety hooks (audit which events have handlers)
- `PostToolUse` matching `Edit|Write` -> run the formatter (prettier/ruff/gofmt) automatically.
- `PreToolUse` matching `Bash` -> guard destructive commands (`rm -rf`, `git push --force`).
- `SessionStart` -> inject orientation/context; `Stop` -> notify task complete; `Notification` (idle) -> desktop alert.
- `PreCompact`/`PostCompact` -> preserve key state across compaction.

**This skill already ships ready-made implementations** of the first two plus an automatic
prompt-optimizer (`UserPromptSubmit`), install them with `scripts/install_hooks.py` rather
than hand-writing handlers. Details: `references/hooks-automation.md`.

### Capability coverage
- **Specialist agents** present for the project's surfaces (FE/BE/DB/security/test). Each agent file has required `name` + `description` and an explicit `model`.
- **Skills** for repeated procedures (recurring CLAUDE.md "how we do X" sections -> convert to a skill). Skill descriptions present (else they won't auto-invoke); `skillListingBudgetFraction` tuned if listing is crowded.
- **MCP hygiene**: secrets not committed in `.mcp.json`; servers scoped correctly (private/project/user); needed token env vars in `settings.json` `env` (not just the shell profile, which non-interactive runs don't source).
- **Memory**: `autoMemoryEnabled` on (or a memory mechanism in place); `~/.claude/CLAUDE.md` exists; large project CLAUDE.md refactored into path-scoped `.claude/rules/*.md` (`paths:` frontmatter) to load only when relevant.
- **`effortLevel` / `model`** persisted to match the work (e.g. `high` for complex codebases).

### Stack-fit plugin candidates (verify names/cost before recommending)
Match to detected stack; check the plugin's per-turn **context cost** before suggesting (a heavy plugin can cost more than it saves):
- FE<->BE contract drift -> `drift-guard` (OpenAPI/GraphQL/gRPC schema diffs).
- Postgres / Cloud SQL -> `whodb`, data-agent-kit.
- Test scaffolding -> `memoriant-test-coverage`, `test-generator`; e2e -> `playwright-pro`.
- API/Python security (auth, IDOR, RLS, OWASP) -> `backend-security-skills`, `vibeguard`.
- GCP / Firebase infra -> `gcp-devkit`, `firebase-development`.
- Token reduction -> `cc-boost` (strips noisy tool output), `context-os` (repo symbol graph), `parrot` (kills response repetition).

## Apply protocol

1. Present the gap report grouped by leverage (token economy -> automation -> coverage -> plugins), each with the concrete change and its benefit.
2. On approval, apply low-risk changes in one batch: settings `permissions.deny`/`claudeMdExcludes`/`subagentDefaults`, format/guard hooks, LSP-plugin installs, agent/skill files. Respect the user's source-of-truth layout (e.g. write to their managed source and let their sync/symlinks pick it up; don't bypass it).
3. **Verify the change took effect**: re-read settings, `/plugin` shows it enabled/installed, `/reload-plugins` or `/reload-skills` if needed, a probe confirms the new capability works.
4. Record applied changes in `.atlas/docs/` (the consolidated SSOT, e.g. `.atlas/docs/CHANGELOG.md` / `.atlas/docs/audits/`) and offer to note durable conventions in the user-level `~/.claude/CLAUDE.md`.

## Authoritative sources (re-verify against these, don't trust memory)
`code.claude.com/docs/en/`: `settings`, `hooks`, `mcp`, `memory`, `sub-agents`, `large-codebases`, `discover-plugins`, `skills`, `goal`, `workflows`. The user's own setup conventions take precedence over any default.
