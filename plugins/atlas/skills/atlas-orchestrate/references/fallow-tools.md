# Fallow tools (JS/TS codebase intelligence)

Load when the project is JavaScript/TypeScript (package.json or .ts/.tsx/.js
sources), when cleaning dead code / duplication / complexity, when setting up a
PR quality gate, or when a git commit/push is blocked by the atlas fallow gate.

Fallow is external tooling ([docs.fallow.tools](https://docs.fallow.tools)). Atlas
does not vendor the binary; it wires discovery, agent guidance, and a PreToolUse
gate so every atlas user who installs fallow gets the same agent-side audit.

## What atlas ships vs what the user installs

| Surface | Who provides it | What it does |
|---|---|---|
| `hooks/fallow_gate.py` | **atlas plugin** (auto-loaded) | On Bash `git commit` / `git push`, runs `fallow audit --format json --quiet --explain --gate-marker agent`. Deny on `verdict: fail`. Fail-open if fallow is missing. |
| fallow CLI | user (`npm install -g fallow` or project devDependency) | Analysis binary |
| `fallow-mcp` | user (`claude mcp add fallow -- fallow-mcp`) | Typed MCP tools for agents |
| `fallow-skills` | user (marketplace `fallow-rs/fallow-skills`) | Skill knowledge for workflows |

Do **not** also run `fallow hooks install --target agent` in an atlas session
unless the user explicitly wants a second, project-local gate. Atlas already
ships the agent gate; a second install double-audits every commit.

Disable the atlas gate with `ATLAS_FALLOW=off` (settings.json `env`). Override
the version floor with `FALLOW_GATE_MIN_VERSION` (default `2.85.0`; empty string
disables). Pin the audit base with `FALLOW_AUDIT_BASE` (forks / non-main
integration branches).

## Agent command matrix (always `--format json`)

Prefer MCP tools when `fallow-mcp` is connected. Otherwise shell:

```bash
# Full picture (repo clean / adoption)
npx fallow --format json --quiet
npx fallow dead-code --format json --quiet
npx fallow dupes --format json --quiet
npx fallow health --format json --quiet

# Changed-files gate (PR clean / before commit)
npx fallow audit --format json --quiet --explain

# Auto-fix preview then apply (mutating; needs user write consent)
npx fallow fix --dry-run --format json
npx fallow fix --yes --format json

# Capability introspection
npx fallow schema
npx fallow list --entry-points --format json
```

## When to run what

1. **After implementing JS/TS changes** (verifier or implementer close-out):
   `fallow audit --format json --quiet`. Treat `verdict: fail` as a failing
   check; fix introduced findings before claiming done.
2. **Dead-code / cleanup tasks**: full-repo `fallow` / `dead-code` / `dupes` /
   `health` first (adoption path), not audit-only. Prefer fixing code over
   broad suppressions. Mechanisms: `@public` / `@expected-unused`, `entry`,
   `ignorePatterns`, `ignoreDependencies`, narrow `fallow-ignore-next-line`.
3. **Before the agent commits or pushes**: the PreToolUse gate runs audit
   automatically. If it denies, read the JSON in the deny reason, fix, retry.
4. **CI**: still wire `fallow audit` (or the fallow GitHub Action) in the repo's
   pipeline. The agent gate is local containment, not a substitute for CI.

## MCP tools (when fallow-mcp is live)

Common tools: `analyze` / dead-code equivalents, `audit`, dupes/health helpers,
`inspect_target`, security candidates. Use `--format json` equivalents via the
tool params. Set `FALLOW_BIN` only when the CLI is not on PATH.

## Setup shortlist (atlas-setup / `/atlas` discover)

For `js_ts` projects, `discover_capabilities.py` recommends:

- `npm install -g fallow` (or add `fallow` as a devDependency and use `npx`)
- `claude mcp add fallow -- fallow-mcp`
- `/plugin marketplace add fallow-rs/fallow-skills` then install the skill pack

Confirm each install with the user. Never install silently.

## Relation to atlas gates

- **completion_gate** still enforces atlas definition-of-done (evidence,
  verifier, docs). Fallow does not replace it.
- **fallow_gate** is orthogonal: it enforces fallow's changed-file policy on
  agent git commit/push when the CLI is present.
- Both fail open on their own missing dependencies.
