# atlas-mod-plan-rev3: Atlas mod plan rev3 fact-check (visual v2, section 7)

- id: atlas-mod-plan-rev3
- status: rejected
- verified_by: verifier-mod-plan-rev3
- verified_at: 2026-10-09T21:14:21+00:00

## Evidence
- REFUTED: hooks.json has 21 hook commands not 42 (doc L415,L455; 42 = grep count of the word command); Svg prop is isInteractive not animate (index.d.ts:12299-12306, doc L108); Svg exists on mobile+vscode per types (index.d.ts:3805-3857) so 'Mobile has neither'/'Svg Desktop-only' wrong vs types (interface.md table says Desktop); BoxProps has no scope, it is hover.scope (index.d.ts:877,925, doc L97); atlas_herdr status does 2 socket pings + possible herdr --version (atlas_herdr.py:335,857,555-563; doc L471); <root>/scripts/atlas_herdr.py does not exist (doc L67; lives in plugins/atlas/scripts); $.session.usage has no token total (index.d.ts:11712-11738, doc L143); s7 'never rewrites a prompt' contradicts s6.4 prompt.submit context. All s7 admin/settings claims CONFIRMED (admin.md:26-38,58-63,66,151-152,203,221,233-239,268,304,314-331,362; settings-ref.md:4019-4030,4048-4058,5939-5945); repo line cites CONFIRMED. Client/Raster/Image/Text/hover/AbovePrompt/sites/advance/144-110/audio asset/prompt.suggest/agent statuses/TurnStepInput/AgentSpawnInput CONFIRMED.

## Reproduction
python3 -c "import json;h=json.load(open('plugins/atlas/hooks/hooks.json'))['hooks'];print(sum(len(g['hooks']) for v in h.values() for g in v))"

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
