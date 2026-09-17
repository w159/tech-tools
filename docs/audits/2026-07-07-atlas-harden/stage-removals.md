# Stage: Removals and Reversions - atlas-harden 2026-07-07

Executed in place, no parallel copies, no commits, no pushes.
REPO = `/Users/jerry/MEGA/Projects/Agentic/tech-tools`
ATLAS = `/Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/atlas`
(the task's `undefined/` placeholders resolved to ATLAS for plugin-internal paths and
to REPO for `.kimi-plugin/marketplace.json` and `plugins/README.md`.)

Authority: `docs/audits/atlas-harden-2026-07-07/decisions.md` (Jerry, Step 0 gate).

---

## Step 1 - Guard then delete agent specs

Guard = `grep -rn <name> plugins/atlas/skills/ plugins/atlas/commands/`.

Guard results (dispatch-scope grep):

| Agent | Hits in skills/ + commands/ | Blocks delete? |
|---|---|---|
| ux-cartographer | SKILL.md:150, ux-test-swarm.md:71, atlas-expedition/references/personas.md:5 | No - narration/reference only, not a Task dispatch; two are the exempt files, personas.md is a descriptive mention. Deletion approved unconditionally in decisions.md item 2. |
| ux-persona | SKILL.md:150, ux-test-swarm.md:72 | No - exempt files only |
| ux-fuzzer | SKILL.md:150, ux-test-swarm.md:73 | No - exempt files only |
| ux-accuracy-oracle | SKILL.md:150, ux-test-swarm.md:74 | No - exempt files only |
| ux-reporter | SKILL.md:150, ux-test-swarm.md:75 | No - exempt files only |
| api-usage-map | **0 hits** | No dispatch found -> delete cleared per the guard in decisions.md item 2 |

All 6 files were git-tracked (`git ls-files --error-unmatch` succeeded for each), so removed
with `git rm`.

Command + output:
```
$ git rm plugins/atlas/agents/{ux-cartographer,ux-persona,ux-fuzzer,ux-accuracy-oracle,ux-reporter,api-usage-map}.md
rm 'plugins/atlas/agents/api-usage-map.md'
rm 'plugins/atlas/agents/ux-accuracy-oracle.md'
rm 'plugins/atlas/agents/ux-cartographer.md'
rm 'plugins/atlas/agents/ux-fuzzer.md'
rm 'plugins/atlas/agents/ux-persona.md'
rm 'plugins/atlas/agents/ux-reporter.md'
```
After: `ls plugins/atlas/agents/ | grep -E 'ux-|api-usage-map'` -> 0 remaining.
Staged as `D` in `git status --porcelain` (deletion staged, NOT committed).

---

## Step 2 - Strike every reference to the deleted agents

Full-tree grep before edits found the 6 names in these files (beyond the deleted specs):
README.md, output-styles/atlas-orchestrator.md, skills/atlas-engine/SKILL.md,
skills/atlas-engine/references/ux-test-swarm.md, skills/atlas-expedition/references/personas.md.
CHANGELOG.md had **zero** hits (no historical-record rewrite needed).

Edits:

1. `plugins/atlas/README.md` - agent roster tree:
   - count `# 18 subagents` -> `# 12 subagents`
   - removed the `api-usage-map.md` line
   - removed the 5 `ux-*` lines
   - moved the tree terminator ``` `-- ``` onto `completeness-critic.md` (now the last agent)
   - Verified: 12 agents listed, terminator correct.

2. `plugins/atlas/output-styles/atlas-orchestrator.md` - dispatch roster:
   - dropped `, atlas:api-usage-map` from the DB-agent group
   - removed the UX-swarm list; kept surviving `atlas:ui-runtime-tester`

3. `plugins/atlas/skills/atlas-engine/SKILL.md` - "Your squad":
   - removed the entire "UI/UX test swarm" bullet (named all 5 deleted agents).
   - UX testing stays represented by `atlas-expedition` on the meta-skills bullet.
   - Side effect (correct): the list is now exactly the 3 bullets its "Three complementary
     sets:" lead-in promises.

4. `plugins/atlas/skills/atlas-expedition/references/personas.md:5`:
   - `Phase 0 (atlas:ux-cartographer)` -> `Phase 0 discovery`

5. `plugins/atlas/skills/atlas-engine/references/ux-test-swarm.md` - collapsed from 113 lines
   to an 11-line pointer stating `atlas-expedition` is the sole canonical UX-testing owner
   and where it lives (`plugins/atlas/skills/atlas-expedition/`, `/atlas-expedition`). File
   kept so existing citations resolve.

Verification (0-hit proof):
```
$ grep -rn 'ux-cartographer\|ux-persona\|ux-fuzzer\|ux-accuracy-oracle\|ux-reporter\|api-usage-map' plugins/atlas/
0 hits - all references struck
```

---

## Step 3 - rmdir plugins/atlas/references/

`ls -A` returned empty (0 entries). `rmdir plugins/atlas/references/` -> exit 0.
`[ -d plugins/atlas/references ]` -> confirmed removed. Nothing skipped.
(Not shown in `git status`: it was an empty, untracked directory - invisible to git.)

---

## Step 4 - Delete UNTRACKED caches only

Tracking verified before deletion (`git ls-files <dir> | wc -l` == 0 for all three;
`.pytest_cache` and `.ruff_cache` reported `!!` = ignored by `git status --porcelain --ignored`):

| Path | Tracked files | Entries removed | Result |
|---|---|---|---|
| plugins/atlas/.pytest_cache | 0 (ignored) | .gitignore, CACHEDIR.TAG, README.md, v | removed OK |
| plugins/atlas/.ruff_cache | 0 (ignored) | .gitignore, 0.15.12, CACHEDIR.TAG | removed OK |
| plugins/atlas/scripts/.claude | 0 (untracked, empty) | (none) | removed OK |

No tracked file was deleted. None of these appear in `git status` (correctly, as ignored/untracked).

---

## Step 5 - Revert uncommitted marketplace.json / README.md  -- DEVIATION, see below

Instruction: `git checkout -- .kimi-plugin/marketplace.json plugins/README.md` to revert the
uncommitted local-relative-path scheme (decisions.md item 3), keeping tracked `.kimi-plugin`
content (deviation note).

**State at execution differs from the task/session-start snapshot.** The session-start snapshot
showed HEAD = `82bfb02` with `M .kimi-plugin/marketplace.json` and `M plugins/README.md`.
The LIVE repo at execution has HEAD = `4cf8fcc`, with an intervening commit
`d1be66b feat(marketplace): update plugin sources to use local paths instead of GitHub links`
(author date 2026-07-07 05:25) that **committed** exactly the local-relative-path scheme the
decision says to reject. Evidence:
```
$ git ls-files -- .kimi-plugin/marketplace.json plugins/README.md      # both tracked
$ git diff --stat HEAD -- .kimi-plugin/marketplace.json plugins/README.md   # EMPTY = clean vs HEAD
$ grep -n '"source"' .kimi-plugin/marketplace.json | head
7:      "source": "./plugins/atlas"     # local paths ARE present, i.e. the rejected scheme
$ git show --stat d1be66b   # .kimi-plugin/marketplace.json (24 chg), plugins/README.md (2 chg)
```

Consequence: there is nothing to revert in the working tree. `git checkout -- <paths>` ran and
was a no-op (exit 0; status empty before and after):
```
$ git status --porcelain -- .kimi-plugin/marketplace.json plugins/README.md    # empty
$ git checkout -- .kimi-plugin/marketplace.json plugins/README.md              # exit 0
$ git status --porcelain -- .kimi-plugin/marketplace.json plugins/README.md    # still empty
```

**Not done, by boundary:** actually reverting the local-path scheme now requires undoing commit
`d1be66b` (via `git reset`/`git revert`), i.e. a commit or history rewrite. The task mandates
"NO git commits" and my authority excludes commits/history changes. I did not reset or revert
history. This needs a human decision (see unverified). I did NOT touch `.kimi-plugin/import-plan.json`
(pre-existing `M`) or `.kimi-plugin/import-report.json` (pre-existing `??`) - out of scope, and
tracked `.kimi-plugin` content is retained per the deviation note.

---

## Step 6 - plugin.json still parses

```
$ python3 -c "import json; d=json.load(open('plugins/atlas/.claude-plugin/plugin.json')); print(list(d.keys()))"
PARSE OK; top-level keys: ['name','version','description','author','repository','homepage','license','keywords']
```

---

## Final working-tree status (`git status --porcelain`)

```
 M .kimi-plugin/import-plan.json          <- pre-existing, NOT touched by this stage
 M plugins/atlas/README.md                <- Step 2
D  plugins/atlas/agents/api-usage-map.md  <- Step 1
D  plugins/atlas/agents/ux-accuracy-oracle.md
D  plugins/atlas/agents/ux-cartographer.md
D  plugins/atlas/agents/ux-fuzzer.md
D  plugins/atlas/agents/ux-persona.md
D  plugins/atlas/agents/ux-reporter.md
 M plugins/atlas/output-styles/atlas-orchestrator.md            <- Step 2
 M plugins/atlas/skills/atlas-engine/SKILL.md                   <- Step 2
 M plugins/atlas/skills/atlas-engine/references/ux-test-swarm.md<- Step 2 (collapsed)
 M plugins/atlas/skills/atlas-expedition/references/personas.md <- Step 2
?? .kimi-plugin/import-report.json         <- pre-existing, NOT touched
?? docs/audits/atlas-harden-2026-07-07/    <- this report + decisions/orientation
```

`plugins/README.md` (repo-level) is absent from status = clean, confirming Step 5 was a no-op
and that this stage did not modify it. Removed caches and the empty `references/` dir do not
appear (ignored/untracked/empty), as expected.
