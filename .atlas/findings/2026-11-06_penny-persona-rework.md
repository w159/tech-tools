# penny-persona-rework: Penny persona rework verified as a source draft only: commit bd7ff0c (agent-penny-teams, local and unpushed) carries the new base voice and IT banter block with persona.test.ts at 17/17; the hand-adapted paste-ready n8n delta was corrected after verification found it had dropped four production rules - uncertain-means-serious, receipts-only, the bit-off switch, proactive reach-out with human review - plus the injection-safety line; the unrequested git init in agent-penny was removed and its two doc edits kept as plain files

- id: penny-persona-rework
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-06T22:33:53+00:00

## Evidence
- npx vitest run agent/lib/persona.test.ts -> 17/17 pass in agent-penny-src; npm test additionally fails 2 pre-existing assertions in the UNTRACKED penny/learning/memory-optimizer.test.ts, which no persona file references
- git show --stat bd7ff0c -> exactly agent-penny-src/agent/instructions.md, agent/lib/persona.ts, agent/lib/persona.test.ts; branch master, unpushed
- independent verification of the paste-ready n8n delta against the committed instructions.md: it kept the no-narration, no-date-preamble, no-throat-clearing, no-restating, one-good-line, no-humor-at-end-users and no-humor-under-stress rules and did not contradict vendor silence; the four dropped rules and the injection-safety line were then restored in docs/features/2026-11-03-n8n-penny-agent.md
- agent-penny has no .git (unrequested repo creation removed); docs/CHANGELOG.md 2026-11-06 entry and the feature doc persona sections remain as plain file edits

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/agent-penny-teams/agent-penny-src && npx vitest run agent/lib/persona.test.ts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
