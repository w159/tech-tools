# atlas-render-divergence-verdict: Surface-by-surface verification verdict: no ATLAS behavioural difference is established between the three sessions; the version pin is refuted as the cause (identical renderer sources and hooks.json across 17.1.0 and 17.2.0), the band and header-pill surfaces coexist by design, and two earlier claims are corrected - commit c06754b6 did NOT make ATLAS_MOD a per-render read (installed 17.2.0 restyle.tsx:232-239 reads it once per registration) and the missing prompt.submit hook was a naming artifact (the hook is UserPromptSubmit, firing 51 times in 5fa73dfc and 23 times in aa162b87)

- id: atlas-render-divergence-verdict
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-06T21:05:02+00:00

## Evidence
- .atlas/evidence/2026-11-06-atlas-render-divergence.md Finding 9
- ATLAS_MOD unset in every session; ATLAS_DASHBOARD=off gates only the web dashboard; ATLAS_QUIET is not a code gate; no surface is suppressed in one session and present in another
- grep -o 'hookName[^,]*' on both transcripts: UserPromptSubmit 51 (5fa73dfc) and 23 (aa162b87)
- shasum identical for ~/.claude/plugins/cache/tech-tools/atlas/{17.1.0,17.2.0}/mod/{band.tsx,restyle.tsx,register.ts,theme.ts} and hooks/hooks.json
- shadowing user copy ~/.omp/agent/extensions/usage-statusline.ts sha256 831b02773687d8de... vs plugin copy 164538e2ea74b5c0...

## Reproduction
grep -o 'hookName[^,]*' ~/.claude/projects/-Users-jerry-MEGA-Projects-Web-gwh-firstrespondersapp/5fa73dfc-*.jsonl ~/.claude/projects/-Users-jerry-MEGA-Projects-Web-gwh-doc-analyzer/aa162b87-*.jsonl | sort | uniq -c | grep UserPromptSubmit

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
