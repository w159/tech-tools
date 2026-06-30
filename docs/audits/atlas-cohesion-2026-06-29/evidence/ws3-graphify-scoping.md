# WS3 evidence - graphify scoping

Date: 2026-06-30. Engine: graphify (graphifyy) 0.8.21, uv tool at
`~/.local/share/uv/tools/graphifyy`. Branch: atlas-ws3-graphify.

## Root cause (verified, corrects the original framing)

The original report blamed `node_modules`/`.venv`. That is wrong - the engine already prunes them:

- `detect.py:538` `_SKIP_DIRS` includes `node_modules, .venv/venv, dist, build, target,
  __pycache__, .ruff_cache, .next/.nuxt/.turbo, graphify-out, .worktrees`, etc.
- `detect.py:646-650` `detect()` reads `.graphifyignore`, falling back to `.gitignore`.
- `detect.py:865` `detect(root, *, extra_excludes=...)`; `detect.py:880-885` CLI `--exclude` wins last.

Actual cause: whole-monorepo scope (~15.6k files) trips the size gate at
`skills/graphify/SKILL.md` (`total_files > 200`), whose prose said "ask which subfolder to run on.
Wait for the user's answer" - fatal in an automated Workflow with no human to answer.

## Proof 1 - per-root scoping + extra_excludes (skills/graphify/test_scoping.py)

```
$ GRAPHIFY_NONINTERACTIVE=1 python3 skills/graphify/test_scoping.py
PASS: root=mcp_servers/cipp-mcp/src total_files=12 total_words=17331 (<= 200 gate)
PASS: extra_excludes dropped files 12 -> 3
probe exit=0
```

A single MCP-server source root is 12 files - well under the 200-file gate, so per-root scoping
never trips the interactive stall. `extra_excludes` measurably drops files (12 -> 3), proving the
mechanism the SKILL now forwards as `detect(..., extra_excludes=EXCLUDES)`.

## Proof 2 - no hang (headless, sub-second)

```
$ /usr/bin/time -p sh -c 'GRAPHIFY_NONINTERACTIVE=1 python3 skills/graphify/test_scoping.py ...'
real 0.08
```

Completes in 0.08s and exits 0 - it never blocks waiting on input.

## Proof 3 - repo-root .graphifyignore honored at every depth

A temp tree with the repo's `.graphifyignore` copied in, then `detect()`:

```
total_files: 2  names: ['a.py', 'b.ts']
PASS: .graphifyignore keeps source, excludes .mcpb / docs-audits / .superpowers / *.min.js at all depths
```

Source files (`a.py`, `b.ts`) are kept; `conn.mcpb`, `docs/audits/old.md`,
`.superpowers/sdd/progress.md`, and both root- and nested-level `*.min.js` are excluded.

Gotcha captured: graphify's `**/*.ext` does NOT match repo-root-level files (only nested). The
gitignore-idiomatic slash-less `*.ext` matches at every depth, so `.graphifyignore` uses `*.mcpb`
and `*.min.js`, not `**/*.mcpb`/`**/*.min.js`.

## Changes (all committed on atlas-ws3-graphify)

- `skills/graphify/SKILL.md` - `--exclude` in Usage; `extra_excludes` forwarded in Step 2;
  scoping subsection (`_SKIP_DIRS`, `.graphifyignore`/`.gitignore`, `--exclude`-wins-last);
  size gate split into interactive vs non-interactive (`GRAPHIFY_NONINTERACTIVE`/no-TTY ->
  auto-scope to largest subdir or hard-fail with instruction, never block).
- `plugins/atlas/skills/atlas-survey/SKILL.md` - Phase 1 discovers roots dynamically and runs
  graphify scoped per root with `GRAPHIFY_NONINTERACTIVE=1`; Output tree notes per-root
  `graphify-out/`.
- `.graphifyignore` (new, allowlisted in `.gitignore`) - trims `.mcpb`/`docs/audits`/`docs/.run`/
  `.superpowers`/`*.min.js`.
- `skills/graphify/test_scoping.py` (new) - the probe above; SKIPs cleanly if graphify absent.

## Not done here (flagged)

- The downstream `agentic-tools` repo carries copies of the graphify skill
  (`skills/graphify/SKILL.md`, `plugins/marketplaces/`, `dist/agent-assets/`). Those live in a
  separate repo and were not synced on this branch.
