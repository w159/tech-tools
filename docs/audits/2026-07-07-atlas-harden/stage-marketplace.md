# Repoint atlas marketplace to w159/tech-tools

Note on task path: the task instructions referenced `undefined/scripts/atlas_doctor.py`
and `undefined/stage-marketplace.md`. No literal `undefined` directory exists anywhere
under `~/.claude` or the repo. The only `atlas_doctor.py` on disk is at
`/Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/atlas/scripts/atlas_doctor.py`
(confirmed via `find /Users/jerry/.claude -iname "atlas_doctor.py"` returning nothing,
and `find /Users/jerry/MEGA/Projects/Agentic/tech-tools -iname "atlas_doctor.py"`
returning that one path). This file is written to the audit folder as the nearest
sane resolution of the mangled output path.

## Command 1: plain doctor (before)

Command: `python3 plugins/atlas/scripts/atlas_doctor.py` (cwd:
`/Users/jerry/MEGA/Projects/Agentic/tech-tools`)

```
PASS  registered           atlas@tech-tools at 2.6.0
FAIL  marketplace-source   https://github.com/henssler-financial/tech-tools.git (expected w159/tech-tools)
FAIL  clone-remote         https://github.com/henssler-financial/tech-tools.git
PASS  version-sync         installed 2.6.0, marketplace 2.6.0
PASS  rollback             2.6.0 >= floor 2.6.0
PASS  install-path         cache manifest 2.6.0 vs entry 2.6.0
PASS  hooks-wired          all hook files present
PASS  assets               {"commands": 19, "agents": 18, "skills": 9}
PASS  stale-assets         none found
PASS  orchestration-wiring tripwire sees Skill/Agent/Task and auto-marks
2 PROBLEM(S) - atlas
```

Exit code: 1.

Failing checks: `marketplace-source` (known_marketplaces.json source URL pointed at
the `henssler-financial` fork) and `clone-remote` (the marketplace clone's git
`origin` pointed at the same fork).

## Command 2: doctor --fix

Command: `python3 plugins/atlas/scripts/atlas_doctor.py --fix`

```
FIX: repointed marketplace source to https://github.com/w159/tech-tools.git
FIX: reset marketplace clone to origin/main
PASS  registered           atlas@tech-tools at 2.6.0
PASS  marketplace-source   https://github.com/w159/tech-tools.git (expected w159/tech-tools)
PASS  clone-remote         https://github.com/w159/tech-tools.git
PASS  version-sync         installed 2.6.0, marketplace 2.6.0
PASS  rollback             2.6.0 >= floor 2.6.0
PASS  install-path         cache manifest 2.6.0 vs entry 2.6.0
PASS  hooks-wired          all hook files present
PASS  assets               {"commands": 19, "agents": 18, "skills": 9}
PASS  stale-assets         none found
PASS  orchestration-wiring tripwire sees Skill/Agent/Task and auto-marks
HEALTHY - atlas
```

`--fix` (via its own internal CHECK -> SET -> VERIFY cycle, per
`plugins/atlas/scripts/atlas_doctor.py:344-421`) fully repaired both failing checks
on its own:

1. Rewrote `known_marketplaces.json`'s `plugins["tech-tools"].source.url` to
   `https://github.com/w159/tech-tools.git`.
2. Ran `git remote set-url origin https://github.com/w159/tech-tools.git` against
   the marketplace clone at `/Users/jerry/.claude/plugins/marketplaces/tech-tools`,
   fetched, and hard-reset to `origin/main`.

No manual `known_marketplaces`/remote edit was needed, so step 3 of the task
(manual targeted fix) was not exercised - the automated fixer already reached
0 problems.

## Command 3: plain doctor (after, re-run per step 4)

Command: `python3 plugins/atlas/scripts/atlas_doctor.py`; `echo "EXIT:$?"`

```
PASS  registered           atlas@tech-tools at 2.6.0
PASS  marketplace-source   https://github.com/w159/tech-tools.git (expected w159/tech-tools)
PASS  clone-remote         https://github.com/w159/tech-tools.git
PASS  version-sync         installed 2.6.0, marketplace 2.6.0
PASS  rollback             2.6.0 >= floor 2.6.0
PASS  install-path         cache manifest 2.6.0 vs entry 2.6.0
PASS  hooks-wired          all hook files present
PASS  assets               {"commands": 19, "agents": 18, "skills": 9}
PASS  stale-assets         none found
PASS  orchestration-wiring tripwire sees Skill/Agent/Task and auto-marks
HEALTHY - atlas
EXIT:0
```

0 problems, exit code 0.

## Independent verification (outside the doctor script)

```
$ clone=$(python3 -c "import json; print(json.load(open('/Users/jerry/.claude/plugins/known_marketplaces.json'))['tech-tools']['installLocation'])")
$ git -C "$clone" remote -v
origin  https://github.com/w159/tech-tools.git (fetch)
origin  https://github.com/w159/tech-tools.git (push)

$ python3 -c "import json; m=json.load(open('/Users/jerry/.claude/plugins/known_marketplaces.json'))['tech-tools']; print(m['source'])"
{'source': 'git', 'url': 'https://github.com/w159/tech-tools.git'}
```

Both the config file entry and the actual git remote independently confirm the
repoint to the canonical `w159/tech-tools` repo.

## Scope notes

- Nothing under `/Users/jerry/MEGA/Projects/Agentic/tech-tools` (the working repo,
  referred to as "undefined" in the task) was modified. All changes were confined
  to `~/.claude/plugins/known_marketplaces.json` and the git remote/HEAD of
  `~/.claude/plugins/marketplaces/tech-tools`, both applied by the doctor script's
  own `--fix` path, not by hand.
- `/reload-plugins` was intentionally NOT run (session-level command, left for the
  user per task instructions).
