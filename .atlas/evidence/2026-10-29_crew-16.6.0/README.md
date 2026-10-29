# Crew 16.6.0 evidence (v18 build)

Raw result.json of the nine v18 runs (claude-sonnet-5-5, effort medium, both arms). Full write-up:
docs/audits/2026-10-29_atlas-16.6.0-crew-benchmark.md

| File prefix | Task | Tests | Wall (s) | Median wall | Median tokens |
| --- | --- | ---: | --- | ---: | ---: |
| fixture-v18-1..3 | 8 modules | 213 | 40.0 / 36.9 / 41.6 | 40.0 s | 142,980 |
| fixture3-v18-1..3 | 18 modules | 469 | 47.5 / 46.9 / 48.7 | 47.5 s | 269,723 |
| fixture4-v18-1..3 | 30 modules | 784 | 62.4 / 51.6 / 52.3 | 52.3 s | 408,654 |

Source paths (bench scratchpad, <runs> = /tmp/claude-0/-home-user/f7cc7cab-6754-5976-b57d-d0817aade866/scratchpad/bench/runs):

- fixture-v18-N.json  <- <runs>/fixture-skill-v18-N/result.json
- fixture3-v18-N.json <- <runs>/fixture3-skill-v18-N/result.json
- fixture4-v18-N.json <- <runs>/fixture4-skill-v18-N/result.json

Single-arm medians (16.4.0 page): 144.1 s, 181.2 s, 227.8 s.
