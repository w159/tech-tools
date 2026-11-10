# penny-persona-humor-ownership: Penny humor ownership contradiction resolved and verified: the always-on base voice now grants no humor permission at all (0 forbidden phrases remain) and assigns humor solely to the verified-IT IT teammate register, which n8n lacks - so the live n8n agent gets one consistent rule instead of both a humor grant and a humor ban; three contract assertions lock it, and the paste-ready n8n delta was corrected to match

- id: penny-persona-humor-ownership
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-06T22:45:10+00:00

## Evidence
- agent-penny-teams commit cbfc373f2 (on top of 6c8fce9a, bd7ff0c), local and unpushed, touching only agent-penny-src/agent/instructions.md and agent/lib/persona.test.ts; persona.ts untouched so IT_BANTER_BLOCK keeps the humor, the one-bit rule, receipts-only and the hard stop
- git show HEAD:agent-penny-src/agent/instructions.md | grep -cEi 'sense of humor|do not ration|dry line|GoFundMe|Here is the register for IT|one good line per reply|bit is not landing|running (gag|joke)|invent a bit' -> 0
- npx vitest run agent/lib/persona.test.ts -> 19 passed (19); npx eslint agent/lib/persona.ts agent/lib/persona.test.ts -> clean
- independent verification: base voice lines 33-34 assign humor to the IT register and forbid jokes with end users; persona.ts lines 22/26/32/33 still carry the IT humor rules; the n8n delta retains human review, no-humor-under-stress, injection safety, never-store-secrets and broadcast-safe, and states the Agent has no IT register

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/agent-penny-teams/agent-penny-src && PATH=/opt/homebrew/bin:/Users/jerry/.cargo/bin:/Users/jerry/.openclaw/bin:/Users/jerry/.local/bin:/Users/jerry/.openclaw/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/usr/local/share/dotnet:~/.dotnet/tools:/opt/homebrew/bin npx vitest run agent/lib/persona.test.ts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
