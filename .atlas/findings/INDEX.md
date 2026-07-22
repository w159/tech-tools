# Findings index

Durable, dated learning ledger. Each resolved issue, fix, or decision
gets one `<YYYY-MM-DD>-<slug>.md` file in this folder; this index links
them so an agent can check for prior art before starting non-trivial
work, without re-reading every finding file.

## How to use

- Before non-trivial work, scan this index for entries touching the same
  area before starting; the fix may already exist.
- After a verified fix, add a row here in the same change that adds the
  dated finding file.

## Index

| Date | Slug | Area | Summary |
|---|---|---|---|
| 2026-07-17 | atlas-canonical-structure-scaffolding | atlas-setup, docs-ssot, docs-curator, docs-auditor, session_boot, atlas-gitignore | `atlas-setup` only scaffolded a partial `docs/`+`.atlas/` tree while the docs-ssot refs, docs-curator, and session_boot advisory already assumed the full 25-path canonical structure existed, so older-scaffolded repos silently drifted from what the rest of the fleet expected. Fixed by making the canonical structure one definition, mirrored byte-identical across both docs-ssot references, scaffolded/repaired idempotently by `scaffold_docs.py`, and enforced consistently by docs-curator (owner), docs-auditor (read-only checker), session_boot (advisory), and atlas-gitignore (zero-trust seed + validator). See `.atlas/findings/2026-07-17-atlas-canonical-structure-scaffolding.md`. |
| 2026-07-17 | mcp-shared-build-break-resolved | mcp_servers/_shared, blumira-mcp, threatlocker-mcp, vanta-mcp | `mcp_servers/_shared/` was deleted in `56d1a9f`, breaking the build for three servers with no local fallback (`@shared/*` imports unresolved, e.g. `mcp_servers/threatlocker-mcp/src/domains/_helpers.ts:15,21,26`). Fixed by commit `adace06`, which restored the 9-file top-level directory. Note: `auvik-mcp`, `connectwise-manage-mcp`, and `cipp-mcp` still carry separate private per-server copies - consolidation remains open (see `docs/ROADMAP.md` DRY-divergence item). See `.atlas/findings/2026-07-17-mcp-shared-build-break-resolved.md`. |
| 2026-07-21 | remove-m365-vendor-assessment | plugins/atlas/skills | Deleted the unused `atlas-m365` and `atlas-vendor-assessment` skills (no callers; `atlas-m365` overlapped armada's own M365 coverage). Atlas plugin skill count: 22 -> 20. See `.atlas/findings/2026-07-21-remove-m365-vendor-assessment.md`. |
| 2026-07-22 | kimi-marketplace-manifest-fix | kimi-plugin, marketplace, plugins/atlas, plugins/armada, plugins/programmer | Kimi marketplace installation was broken: armada and programmer plugins missing `.kimi-plugin/plugin.json` manifests; root `kimi.plugin.json`, `.kimi-plugin/marketplace.json`, and `marketplace.json` used local paths instead of GitHub URLs. Added missing manifests and updated all three files with GitHub source URLs. All 3 plugins (atlas, armada, programmer) now installable via Kimi marketplace. See `.atlas/findings/2026-07-22-kimi-marketplace-manifest-fix.md`. |
| 2026-07-21 | programmer-plugin-move | plugins/programmer, .claude-plugin/marketplace.json | Moved the standalone `pragmatic-programmer` plugin into the atlas marketplace as `programmer` (skills renamed `tpp-*`). Marketplace catalog: `3.0.0` -> `3.1.0`, now lists `atlas`, `armada`, `programmer`. Verified CONFIRMED by two independent verifier passes after fixing one stale `LICENSE:3` reference. See `.atlas/findings/2026-07-21-programmer-plugin-move.md` and `.atlas/evidence/2026-07-21-programmer-plugin-move.md`. |

atlas:docs-curator maintains this file. atlas-setup only creates it.
