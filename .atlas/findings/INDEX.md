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

atlas:docs-curator maintains this file. atlas-setup only creates it.
