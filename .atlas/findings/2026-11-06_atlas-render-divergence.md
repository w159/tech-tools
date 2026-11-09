# atlas-render-divergence: Three ATLAS shapes are a band draw site, a header-restyle draw site and a model-prose line, not one session: each session pins its own atlas plugin tree at start (pid 1983 on 17.1.0 since Nov 5 16:47 vs pid 58350 on 17.2.0), each workspace renders its own .atlas state, and the mod renderer files are byte-identical between 17.1.0 and 17.2.0; image 1's workspace and host are unproven

- id: atlas-render-divergence
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-06T20:49:36+00:00

## Evidence
- .atlas/evidence/2026-11-06-atlas-render-divergence.md
- ls ~/.claude/plugins/cache/tech-tools/atlas/*/.in_use -> 17.1.0/.in_use/1983 (Nov 5 16:51), 17.2.0/.in_use/58350 (Nov 6 08:56); ps shows pid 1983 = claude resume 41e6b90d cwd gwh-firstrespondersapp started Nov 5 16:47 and pid 58350 = claude session-id aa162b87 cwd gwh-doc-analyzer started Nov 6 08:47; 17.1.0/.orphaned_at exists
- shasum -a 256 {17.1.0,17.2.0}/mod/{band.tsx,restyle.tsx,register.ts,theme.ts} identical in both versions; diff -rq 17.1.0 17.2.0 shows omp/usage-statusline.ts, omp/proc.ts, hooks/session_boot_core.py differ
- gates: plugins/atlas/mod/register.ts:721 ATLAS_MOD=off, restyle.tsx:236-238 null snapshot, discipline.ts:3 interactive only, band.tsx:259 cols>=120 collapses the band; commit c06754b6 moved ATLAS_MOD from read-once to per-render
- per-workspace state: gwh-doc-analyzer .atlas/.run Nov 6 15:24 vs gwh-firstrespondersapp Nov 6 15:24 with separate evidence/findings dirs; ~/.omp/.atlas/.run stale Oct 30

## Reproduction
ls ~/.claude/plugins/cache/tech-tools/atlas/*/.in_use && ps -axo pid,lstart,command | grep claude && shasum -a 256 ~/.claude/plugins/cache/tech-tools/atlas/{17.1.0,17.2.0}/mod/{band.tsx,restyle.tsx}

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-06T20:40:52+00:00 verified by atlas:verifier: Root cause of divergent ATLAS rendering across three sessions: each session pins its own atlas plugin tree at start (pid
