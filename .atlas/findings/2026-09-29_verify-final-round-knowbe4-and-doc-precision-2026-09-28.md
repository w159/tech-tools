# verify-final-round-knowbe4-and-doc-precision-2026-09-28: final-round verification: env loader placeholder guard + KnowBe4 Azure wiring PASS; one remaining contradiction in docs/architecture/mcp-gateway-design.md over KnowBe4's API key in pluginConfigs

- id: verify-final-round-knowbe4-and-doc-precision-2026-09-28
- status: verified
- verified_by: VerifyFinalRound
- verified_at: 2026-09-29T01:13:45+00:00

## Evidence
- load.mjs and load.py read in full: direct env-file loading lives in ONE shared function per loader (loadEnvFile in load.mjs / _load_env_file in load.py) used for BOTH ~/.config/atlas/atlas.env and ATLAS_ENV_FILE - no drift possible; guard is `if (key && value !== "" && !UNEXPANDED.test(value))` with `const UNEXPANDED = /^\$\{.*\}$/` (load.mjs) and `if key and value != "" and not _is_unexpanded(value)` with `_is_unexpanded = startswith('${') and endswith('}')` (load.py); both skip empty AND unexpanded-placeholder values
- JS regression: `printf 'X=${user_config.x}\n' > /tmp/atlas-verify-final.env && X=from-shell ATLAS_ENV_FILE=/tmp/atlas-verify-final.env node --import /Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/atlas/mcp/_env/load.mjs -e 'console.log(process.env.X)'` -> output exactly `from-shell` (not the literal placeholder); note `--import plugins/...` relative spec fails with ERR_MODULE_NOT_FOUND in node 22 regardless of guard - used absolute module path
- Python regression: `X=from-shell ATLAS_ENV_FILE=/tmp/atlas-verify-final.env python3 -c "import os,runpy; runpy.run_path('plugins/atlas/mcp/_env/load.py', run_name='not_main'); print(os.environ.get('X'))"` -> output exactly `from-shell`
- Azure (no secret values shown): `az keyvault secret show --vault-name gwh-mcp-gateway-kv --name knowbe4-api-key --query '{name:name, enabled:attributes.enabled}'` -> `{\"enabled\": true, \"name\": \"knowbe4-api-key\"}`; `az containerapp show -n gwh-mcp-gateway -g gwh-mcp-gateway-rg --query \"properties.template.containers[0].env[?name=='KNOWBE4_API_KEY']\"` -> `[{\"name\": \"KNOWBE4_API_KEY\", \"secretRef\": \"knowbe4-api-key\"}]`
- docs/architecture/mcp-gateway-design.md (a): line 335 KnowBe4 Key Vault column = `loaded`, matching the other 5 loaded rows (NinjaOne/PAN-OS/ThreatLocker/Vanta lines 331-334) - PASS
- docs/architecture/mcp-gateway-design.md (b): table header col 5 (line 327) = `~/.config/atlas/atlas.env (needs plugin reinstall to take effect in this omp session; NOT yet live here)` - no current-session live implication - PASS
- docs/architecture/mcp-gateway-design.md (c): incident note lines ~204-228 names all 7 (six by name lines ~204-207, KNOWBE4_API_KEY in the grep sentence ~209-212, 'rotate all seven'), and all 4 storage locations (Key Vault, ~/.config/atlas/atlas.env, plugins/atlas/.env, pluginConfigs) - PASS
- docs/architecture/mcp-gateway-design.md (d) FAIL - CONTRADICTION FOUND: incident bullet lines 227-228 says pluginConfigs `it does not hold ThreatLocker's or KnowBe4's API key`, but line 335 table row says KnowBe4 pluginConfigs = `**complete**`, line 77 prose says `KnowBe4 (complete)`, and a presence-only boolean check of ~/.claude/settings.json confirms `knowbe4_api_key` IS present and non-empty in pluginConfigs['atlas@tech-tools'].options; the ThreatLocker half of the sentence is correct (table line 333: partial, missing api key); only the KnowBe4 half is wrong - the bullet should say it does not hold ThreatLocker's API key
- plugins/atlas/references/connector-config-flow.md (e): line 138 `2. copies each CFG_NAME into NAME when the canonical name is unset` - says 'unset' only, no 'unset, empty, or...' wording - PASS

## Reproduction
python3 -c "import json,os; opt=json.load(open(os.path.expanduser('~/.claude/settings.json')))['pluginConfigs']['atlas@tech-tools']['options']; print('knowbe4_api_key' in opt and bool(opt['knowbe4_api_key']))" -> True (presence only, value never read)

## Proposed fix
docs/architecture/mcp-gateway-design.md:227-228 - change to name only ThreatLocker's API key as absent from pluginConfigs (drop `or KnowBe4's API key`), matching table line 335 and the presence check

## Doc refs
- docs/architecture/mcp-gateway-design.md
- plugins/atlas/references/connector-config-flow.md

## History
- no earlier verdicts
