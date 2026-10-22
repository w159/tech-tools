# CC15 runtime acceptance (T10), main 67913c08

Served from `git archive 67913c08 plugins/atlas` (scratchpad) on 127.0.0.1:7499, because the working tree changed mid-run (HEAD moved to 5eaeee16 and app.js reverted to v14 content while I was testing). No branch change, no repo edits.

## Suites
- node --test dashboard_ui/js/*.test.js: tests 111, pass 111, fail 0
- test_atlas_contract: Ran 111 tests, OK (skipped=3)  [expected skipped=4: deviation]
- contrast.py: ALL PAIRS PASS, exit 0

## Route x width (fresh browser context per width; viewport reported by browser is scaled 0.9: 1600/1111/433 CSS px)
| route | width | console errors | scrollWidth <= innerWidth | screenshot |
|---|---|---|---|---|
| run,agents,board,channels,health,settings | 1440 | 0 each | yes (1600/1600) | .atlas/evidence/cc15/<route>-1440.png |
| run,agents,board,channels,health,settings | 1000 | 0 each | yes (1111/1111) | .atlas/evidence/cc15/<route>-1000.png |
| run,agents,board,channels,health,settings | 390 | 0 each | NO: 476/433 on all six | .atlas/evidence/cc15/<route>-390.png |

FAIL (390): horizontal overflow on every route. Offenders by bounding rect: DIV.counts and TIME.clock in the band (right edge 476), plus DIV.segmented on #/agents and BUTTON.settings-nav-link on #/settings.
Note: after 12 s some pages still had `.region-state.loading` nodes (channels 2, health 3, settings 1 at 1440; run 3-5 at 1000/390 on some loads). Loading state resolves on some loads and lingers on others; not diagnosed.
At 390: phase rail shows one pill (RESEARCH); seats/columns stack in one column (run-390.png). The top tab strip shows all six tabs.

## Redirects (6/6)
overview -> #/run; activity -> #/channels; improve -> #/health; projects -> #/settings; colony -> #/agents; terminal -> #/agents?tab=terminal

## States on #/run
- success: run-1440.png (and project tech-tools: seats list with lead-b46c3b etc.)
- empty: "all projects" shows seats list; feed "No messages yet."; steer input disabled, placeholder "select a project to steer" (run-empty-1440.png)
- error: daemon killed, project switch: three regions show "network: the dashboard daemon is not reachable" + Retry (run-error-1440.png). Page-level variant: "This page failed to load. Failed to fetch dynamically imported module .../pages/run.js" + Retry, band shows Offline. After daemon restart, Retry shows "bad_token: missing or invalid X-Atlas-Token" because the token rotated on restart (page needs reload); recovery via Retry alone not observed, fresh load works.
- loading: MutationObserver saw 5 `.region-state.loading` at 44 ms and 2 at 984 ms after navigation.

## Steer
- Note "T10 acceptance probe, no action needed" on tech-tools: row visible in feed at 2297 ms after Enter, input cleared (run-steer-1440.png). A probe note now exists in the lead-b46c3b channel.
- Bad token: POST /api/v2/channels, X-Atlas-Token: bad, JSON content type -> 401 {"ok":false,"error":"bad_token","why":"missing or invalid X-Atlas-Token","do":"reload the dashboard page to obtain a fresh token"}. (Without a JSON content type: 415 unsupported_media_type.)
- renderSteerError via page module: not reachable, covered by run.test.js [unverified live].

## Keys
- `/` opens palette (palette-1440.png); Escape closes it.
- `3` then Tab: focus lands on A.btn inside DIV.need warning (needs-you).
- Meta+f: defaultPrevented=false.
