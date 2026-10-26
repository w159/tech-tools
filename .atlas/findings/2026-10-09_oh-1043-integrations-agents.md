# OH-1043-integrations-agents: Integrations connectors with health/configured/missing env (no secrets); /api/agents without project_id returns plugin roster

- id: OH-1043-integrations-agents
- status: verified
- verified_by: SessionVerifier
- verified_at: 2026-10-09T15:12:53+00:00

## Evidence
- live /api/v2/integrations: keys ok,herdr,tools,mcp,connectors; 12 connectors, e.g. auvik health=ok configured=true missing_required=[] env_vars[is_set,sensitive,source]; all env values '<redacted>'
- live /api/agents (no project_id): 13 agents source=plugin
- test_settings_center.py:15,71 pass

## Reproduction
curl /api/v2/integrations ; curl /api/agents

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
