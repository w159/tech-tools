# Crew 16.5.0 evidence (v15 build)

Raw result.json of the nine v15 runs (claude-sonnet-5-5, effort medium, both arms). Full write-up:
docs/audits/2026-10-29_atlas-16.5.0-crew-benchmark.md

| File prefix | Task | Tests | Wall (s) | Median wall | Median tokens |
| --- | --- | ---: | --- | ---: | ---: |
| fixture-v15-1..3 | 8 modules | 213 | 40.4 / 40.6 / 41.4 | 40.6 s | 144,439 |
| fixture3-v15-1..3 | 18 modules | 469 | 47.8 / 43.9 / 49.5 | 47.8 s | 272,761 |
| fixture4-v15-1..3 | 30 modules | 784 | 52.0 / 56.5 / 66.3 | 56.5 s | 416,330 |

Single-arm medians (16.4.0 page): 144.1 s, 181.2 s, 227.8 s.
