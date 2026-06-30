# WS3 - graphify scoping (per-root + non-interactive size gate)

Branch: atlas-ws3-graphify (off main, post-WS1 merge)
Plan author baseline: main @ e522314
Program spec: ../program-spec.md (WS3 section)

## Problem (verified, not assumed)

The user's original framing was that `node_modules`/`.venv` inflate graphify's scope. That is
NOT the cause. Evidence (graphify 0.8.21, `~/.local/share/uv/tools/graphifyy/.../graphify/detect.py`):

- `detect.py:538` `_SKIP_DIRS` already prunes `node_modules, .venv, dist, build, target,
  __pycache__, .ruff_cache, .next, graphify-out, .worktrees`, and more.
- `detect.py:646-650` `detect()` reads `.graphifyignore`, falling back to `.gitignore`.
- `detect.py:865` `detect(root, *, follow_symlinks, google_workspace, extra_excludes)` accepts
  `extra_excludes`; `detect.py:880-885` anchors CLI `--exclude` patterns last (they win).

The real cause is **whole-monorepo scope**. This repo is ~15.6k files / ~21M words across many
*real* source roots (one per MCP server / node lib / plugin). That trips the documented size gate
at `skills/graphify/SKILL.md:110`:

> If `total_words` > 2,000,000 OR `total_files` > 200: show the warning and the top 5
> subdirectories by file count, then ask which subfolder to run on. **Wait for the user's answer
> before proceeding.**

In an automated Workflow (atlas-survey Phase 1) there is no human to answer, so the run stalls.
The gate is pure skill prose; the engine has no non-interactive flag and no TTY check
(verified: no `isatty`, no `--yes`/`--noninteractive` in `__main__.py`).

## Fix (3 surfaces)

1. `skills/graphify/SKILL.md` (source of truth in THIS repo): expose the engine's existing
   scoping + make the size gate non-interactive-safe.
2. `plugins/atlas/skills/atlas-survey/SKILL.md` Phase 1: discover codebase roots dynamically and
   run graphify scoped per root (not zero-arg on the monorepo).
3. `.graphifyignore` at repo root: belt-and-suspenders noise trim for direct invocations.

## Decisions baked in

- **Non-interactive signal:** env var `GRAPHIFY_NONINTERACTIVE=1` (graphify-namespaced, since the
  skill is generic, not atlas-only). atlas-survey sets it when it drives graphify. When set (or
  when stdin is not a TTY), the size gate must NOT wait: auto-scope to the largest subdirectory by
  file count and proceed on it, emitting a clear note; if even that subdir is over threshold,
  hard-fail with an explicit instruction (re-invoke with a narrower path or `--exclude`). This
  matches the spec's "auto-scope to the largest sub-root or hard-fail with an instruction."
- **Primary fix is per-root scoping** (atlas-survey). The non-interactive gate is the safety net
  for any over-threshold automated invocation; `.graphifyignore` only trims obvious generated
  noise (it does NOT, by itself, get the monorepo under 200 files - per-root scoping does).
- **Distribution note:** the graphify skill also has downstream copies under the separate
  `agentic-tools` repo (`skills/`, `plugins/marketplaces/`, `dist/agent-assets/`). Those live in a
  DIFFERENT repo and are out of scope for this branch; flag the sync in the final report.

## Tasks (each ends in one failable check)

### Task 1 - Pin the baseline behavior with a runnable probe
Write `skills/graphify/test_scoping.py` (stdlib + the installed graphify): a probe that
(a) imports `graphify.detect.detect`, (b) runs it on a single MCP-server source root
(`mcp_servers/<one>-mcp/src`), and asserts `total_files > 0` and `total_files <= 200`; and
(c) runs `detect(root, extra_excludes=["**/*.md"])` and asserts the excluded files drop out
(count strictly less than the unfiltered count). This proves scoping + `extra_excludes` work
against the real engine before we document them.
- [ ] Check: `python3 skills/graphify/test_scoping.py` exits 0 and prints the two counts.
  (If graphify is not importable, the probe SKIPs with a clear message and exit 0 - never a hard
  failure that blocks the suite on a machine without graphify.)

### Task 2 - graphify SKILL.md: expose scoping
- Add to the `## Usage` block (`:10-34`): `/graphify <path> --exclude <glob>   # skip paths (gitignore-style, repeatable)`.
- Step 2 detect (`:84-92`): forward excludes - change the one-liner to
  `detect(Path('INPUT_PATH'), extra_excludes=EXCLUDES)` where EXCLUDES is built from any
  `--exclude` args (default `[]`).
- Add a short subsection after Step 2 documenting: `_SKIP_DIRS` auto-pruning, `.graphifyignore`
  (falls back to `.gitignore`), and `--exclude` winning last. Cite that these are engine features
  (do NOT invent behavior - all three verified in detect.py).
- [ ] Check: `grep -n "extra_excludes" skills/graphify/SKILL.md` shows the forwarded call, and
  `grep -n -- "--exclude" skills/graphify/SKILL.md` shows the Usage line. No mention of any flag
  the engine lacks (`grep -n -- "--noninteractive\|--yes" skills/graphify/SKILL.md` -> empty).

### Task 3 - graphify SKILL.md: non-interactive size gate
Rewrite the `:110` gate bullet into interactive vs non-interactive paths:
- Interactive (TTY and `GRAPHIFY_NONINTERACTIVE` unset): unchanged (top-5 subdirs, ask, wait).
- Non-interactive (`GRAPHIFY_NONINTERACTIVE=1` OR stdin not a TTY): do NOT wait. Auto-scope to the
  single largest subdirectory by file count, re-run detect on it, and proceed - emitting
  "auto-scoped to <subdir> (N files); pass an explicit path or --exclude to change scope." If the
  largest subdir is still over threshold, STOP with an explicit instruction (narrower path /
  `--exclude`), never hang.
- [ ] Check: `grep -n "GRAPHIFY_NONINTERACTIVE" skills/graphify/SKILL.md` present; the words
  "Wait for the user's answer" appear ONLY inside the interactive branch
  (`grep -n "Wait for the user" skills/graphify/SKILL.md` -> exactly one hit, under the
  interactive path).

### Task 4 - atlas-survey Phase 1: discover roots, scope per root
- `:10-12` (Zero-arg discovery) and `:87-89` (Phase 1): replace "invoke graphify on the codebase"
  with: (1) a discovery pass - an `atlas:explorer` over the tree plus graphify's `detect()` for a
  minimal-context read - to enumerate codebase roots (single-package repo -> 1 root; this monorepo
  -> one per MCP server / node lib / plugin); (2) run graphify **scoped per discovered root** with
  `GRAPHIFY_NONINTERACTIVE=1` set, writing `graphify-out/` under each root; (3) merge each root's
  hot-spot nodes into the Phase-1 hot-spot list.
- `:65` Output tree: note the per-root `graphify-out/` location.
- [ ] Check: `grep -n "per discovered root\|GRAPHIFY_NONINTERACTIVE\|roots" plugins/atlas/skills/atlas-survey/SKILL.md`
  shows the scoping language; the old unscoped "build the codebase knowledge graph" sentence no
  longer implies a single whole-repo graphify run.

### Task 5 - repo-root .graphifyignore
Add `.graphifyignore` excluding repo-specific generated/bundled noise that `_SKIP_DIRS` does not
already cover: `**/*.mcpb`, `docs/audits/`, `docs/.run/`, `.superpowers/`, `**/*.min.js`. Keep it
short, commented, and accurate (do not duplicate `_SKIP_DIRS` entries). Note in a comment that
node_modules/dist/.venv/graphify-out are already pruned by the engine.
- [ ] Check: `python3 skills/graphify/test_scoping.py --root .` (extended probe) confirms a
  detect on repo root EXCLUDES at least one `.mcpb` and the `docs/audits/` tree (count drops vs a
  run with `extra_excludes=[]` ... documented as a manual note if the probe can't diff cheaply).

### Task 6 - Propagation + final verification
- Propagate per D5: graphify SKILL Usage (done T2), atlas-survey Output tree (done T4). Check
  `plugins/atlas/.claude-plugin/plugin.json` and any README that describes survey's graph step;
  update only if they assert the unscoped behavior.
- [ ] Final check (acceptance, spec WS3): run the driver on one root non-interactively and confirm
  a populated `graphify-out/` (or a clean detect summary) with NO interactive prompt:
  `GRAPHIFY_NONINTERACTIVE=1 python3 skills/graphify/test_scoping.py` exits 0; and a dry
  walk-through of atlas-survey Phase 1 prose shows no step that can block on input.

## Acceptance (whole workstream)

atlas-survey Phase 1 completes on this repo without stalling, producing a `graphify-out/` per
detected root, each under the 200-file gate; and a direct `/graphify` on an over-threshold path in
a non-interactive context auto-scopes or hard-fails with an instruction instead of hanging.
Evidence: the Task 1/6 probe output (counts, exit 0, no prompt) captured under
`docs/audits/atlas-cohesion-2026-06-29/evidence/`.

## Out of scope (YAGNI)

- No engine fork/patch of graphify (we use its existing `extra_excludes`/`.graphifyignore`/CLI).
- No syncing the downstream `agentic-tools` copies (different repo; flagged in final report).
- WS4 hub/launcher consumes these graphs; not built here.
