# atlas-9.0.0-reverify: atlas 9.0.0 RC second pass: F1-F4, N1-N4, E1-E3, R1-R3 all independently reproduced

- id: atlas-9.0.0-reverify
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-05T15:49:25+00:00

## Evidence
- F1 CONFIRMED (E1 removing lens-set.md mention with references/ still present -> 1 failed naming atlas-audit/references/lens-set.md; real tree 35 passed). F2 CONFIRMED (verifier-brief.md git diff --stat HEAD empty; literal ${CLAUDE_PLUGIN_ROOT}/skills/... at verifier-brief.md:26 and handoff.md:18 inside dispatch templates; targets exist). F3 CONFIRMED (hooks-automation.md:44-49 use ${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py; plugins/atlas/scripts/install_hooks.py exists). F4 CONFIRMED (own YAML-parse of HEAD, tolerant fallback for atlas-dogfood: old 29074, new 17454, pov 1518, docs-curator 579; module 35 tests). N1 CONFIRMED (stdlib _skill_meta equals yaml.safe_load on 7 keys x 59 files, 0 diffs; module has no import yaml; passes 35 with yaml import blocked via meta_path). N2 CONFIRMED (omp 18.6.1 src/task/discovery.ts:145-155 reads only <plugin root>/agents; discovery/agent-plugin-format.ts:566-571 pluginUsesClaudeModelDialect true when .claude-plugin/plugin.json present and no .omp-plugin/plugin.json; atlas has neither plugin.json nor .omp-plugin). N3 CONFIRMED (findings.json numstat 38 0, zero removed lines; new row evidence has no omp-cache path, only prose omp 8.6.0 cache; row claims true but verified_by is the orchestrator). N4 CONFIRMED (bun test 245 pass 0 fail; pytest hooks scripts 1887 passed 3 skipped). E1 E2 E3 CONFIRMED (500-char desc -> test_description_stays_concise failed atlas-pov 500 chars; TOC removed -> toc test failed self-telemetry.md; Use when stripped -> agent test failed verifier.md; block scalar -> AssertionError block scalar not supported for description). R1 CONFIRMED (empty diff). R2 CONFIRMED (numstat 1 1 each; plugin.json 9.0.0; marketplace atlas 9.0.0; root 4.5.1). R3 CONFIRMED with caveat (no file under ~/.claude/plugins newer than 07:00; under ~/.omp/plugins nothing newer than 08:00; lock and tech-tools___atlas___8.6.0 mtime Oct 3 00:25; only marketplace clone dirs refreshed 07:45-07:46 coincident with omp binary startup, content is Oct 2 upstream 8.6.0, cannot prove who triggered).

## Reproduction
bash /tmp/exp.sh; python3 /tmp/n1.py; python3 /tmp/f4.py; cd plugins/atlas/omp && bun test; cd plugins/atlas && python3 -m pytest -q hooks scripts; git diff --numstat .atlas/.run/findings.json; git diff --stat HEAD -- <R1 paths>; find ~/.omp/plugins ~/.claude/plugins -newermt 2026-10-05

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
