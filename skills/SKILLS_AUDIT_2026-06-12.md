# Standalone Skills Audit - 2026-06-12

Scope: the 13 standalone skills under `skills/`. Evaluated against
`plugins/_standards/skill-quality-checklist.md`, with primary focus on the
`description` field (the field that drives skill triggering).

## Summary table

| Skill | Health | Description quality | Issues found | Action taken |
|---|---|---|---|---|
| az-cost-optimize | good | weak -> fixed | Description stated WHAT but no WHEN/trigger phrases. Single SKILL.md, no references. | Rewrote description to add when-to-use + trigger phrases. |
| azure-deployment-preflight | good | strong | None. Valid frontmatter, 3 reference files all linked correctly. | None. |
| cloud-design-patterns | good | adequate -> strengthened | Had what+when but no concrete trigger phrases. 9 reference files, all links resolve. | Rewrote description to add pattern-name trigger phrases. |
| codebase-brain | good | strong | None. Rich what+when+trigger description. Has hooks/scripts/templates/references. Note: compiled `.pyc` files present (cosmetic, not a SKILL.md issue). | None. |
| database-optimization | good | strong | None. Decision matrix + trigger phrases. 2 references resolve. | None. |
| entra-agent-user | good | weak -> fixed | Description stated WHAT but no WHEN/trigger phrases. Single SKILL.md. | Rewrote description to add when-to-use + trigger phrases. |
| graphify | good | strong (unusual style) | Description opens with a lowercase pipeline fragment ("any input ... -> knowledge graph") - stylistically odd but functionally rich with what+when. Body intact. | Left as-is (works; rewriting risks weakening a working trigger). |
| msgraph-sdk | good | strong | None. Clear what+when, language routing. 3 references resolve. | None. |
| msoffice-docs | good | strong | None. What+when+trigger phrases. 3 references resolve. | None. |
| orchestrate | good | strong | None. Strong when/trigger description. Large supporting tree (agents, hooks, references, scripts). | None. |
| scrapling-official | good | strong | None. Has extended frontmatter (version, license, metadata) which is valid. References + examples present. | None. |
| security-audit | good | strong | None. Six-discipline routing table, exhaustive trigger phrases. All 6 references resolve. | None. |
| webapp-testing | good | weak -> fixed | Description stated WHAT but no WHEN/trigger phrases. Has assets/test-helper.js. | Rewrote description to add when-to-use + trigger phrases. |

## Structural health

- Every SKILL.md has valid YAML frontmatter with both `name` and `description`.
- Every `name` matches its folder name.
- All relative reference/links in every SKILL.md resolve to existing files
  (checked cloud-design-patterns x9, azure-deployment-preflight x3+summary,
  msgraph-sdk x3, security-audit x6+summary; the rest have no internal links).
- No broken links, no placeholder/TODO content found in any SKILL.md.

Note: the checklist's `triggers` array field is not used by any of these skills;
they all embed trigger phrases inside the prose `description` instead, which is
the actual mechanism the platform uses for triggering. This is consistent across
all 13 and is the more effective approach, so no `triggers` arrays were added.

## Overlaps / redundancies

- **az-cost-optimize vs azure-deployment-preflight vs cloud-design-patterns**:
  all three are Azure/cloud-architecture adjacent but have distinct, non-competing
  jobs - cost optimization + GitHub issues, pre-deploy Bicep validation, and
  technology-agnostic pattern catalog respectively. Trigger phrases are now
  distinct enough to avoid mis-routing. No action needed.
- **msgraph-sdk vs entra-agent-user**: both Microsoft identity/Graph adjacent.
  msgraph-sdk is about integrating the Graph SDK into an app; entra-agent-user is
  specifically about provisioning an Entra agent-user identity. Minor conceptual
  proximity but different intents; descriptions now disambiguate. No action.
- **orchestrate vs codebase-brain**: both relate to working in a codebase across
  sessions, but orchestrate is a subagent-driven execution coordinator and
  codebase-brain is a persistent knowledge/memory layer. Complementary, not
  redundant. No action.
- No two skills have descriptions that overlap heavily enough to cause
  trigger collisions after the rewrites.

## Dead / placeholder skills to consider removing

- None. All 13 skills have substantive bodies and supporting material. No empty
  or placeholder skills were found.
- Housekeeping only (NOT skill defects, flagged for optional manual cleanup since
  bash unlink is denied on this iCloud path): compiled Python `__pycache__/*.pyc`
  files are committed under `codebase-brain/hooks`, `codebase-brain/scripts`,
  and `orchestrate/hooks` + `orchestrate/scripts`; `orchestrate/.ruff_cache/` and
  several `.DS_Store` files are also present. These do not affect skill behavior.

## Descriptions rewritten (exact list)

1. **az-cost-optimize** - added when-to-use clause and trigger phrases
   (Azure cost optimization, reduce Azure spend, right-size, idle resources,
   cloud bill too high, optimize my resource group).
2. **entra-agent-user** - added when-to-use clause and trigger phrases
   (Entra agent user, agent identity, digital worker, idtyp=user, AI agent
   mailbox access, ServiceIdentity service principal).
3. **webapp-testing** - added when-to-use clause and trigger phrases
   (test the web app, browser test, Playwright, check the UI, screenshot the
   page, debug the frontend, console errors).
4. **cloud-design-patterns** - kept the existing what+when, added concrete
   pattern-name trigger phrases (circuit breaker, retry, saga, CQRS, event
   sourcing, bulkhead, sidecar, strangler fig, anti-corruption layer, etc.).

No body content, workflows, or skill purposes were changed. No files deleted.
