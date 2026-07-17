# Resolved: blumira-mcp, threatlocker-mcp, vanta-mcp build break (missing mcp_servers/_shared)

**Date:** 2026-07-17
**Area:** mcp_servers/_shared, blumira-mcp, threatlocker-mcp, vanta-mcp
**Status:** resolved (commit `adace06`)

## Issue

Commit `56d1a9f` deleted the top-level `mcp_servers/_shared/` directory
(`error-envelope.ts`, `response-shaper.ts`, `base-url.ts`, etc.). Three servers had no
local fallback copy and imported it via a `@shared/*` alias resolved by each server's
`tsup.config.ts` to `mcp_servers/_shared/`:

- `mcp_servers/threatlocker-mcp/src/domains/_helpers.ts:15,21,26`
- `mcp_servers/blumira-mcp/src/domains/_helpers.ts` (same pattern)
- `mcp_servers/vanta-mcp/src/domains/_helpers.ts` (same pattern)

`npm run build` failed in all three with esbuild "Could not resolve" against the
deleted `mcp_servers/_shared/{response-shaper,error-envelope,base-url}.js`.

## Root cause

`56d1a9f` removed the shared directory without checking for remaining consumers.
`auvik-mcp`, `connectwise-manage-mcp`, and `cipp-mcp` survived because they already
carried private per-server `src/_shared/` copies from an earlier, unrelated fix
(see the 2026-07-17 CHANGELOG entry "Security/correctness remediation from
atlas-audit CODE 2026-07-17", build-break fix section); `blumira-mcp`,
`threatlocker-mcp`, and `vanta-mcp` never got that fallback and depended entirely on
the deleted top-level directory.

## Fix

Commit `adace06` restored `mcp_servers/_shared/` (9 files, including
`__tests__/response-quality.test.ts`) from `56d1a9f^`. The `@shared/*` aliases in the
three affected servers' `tsup.config.ts` now resolve again.

## Evidence

- `git show adace06 --stat -- mcp_servers/_shared/` confirms the 9 restored files.
- `mcp_servers/_shared/` is present on disk post-commit (verified `ls
  mcp_servers/_shared/` -> `__tests__ ADOPTION.md annotate-tool.ts base-url.ts
  error-envelope.ts pack-mcpb.js package.json response-shaper.ts tsconfig.json`).
- `mcp_servers/threatlocker-mcp/src/domains/_helpers.ts:15,21,26` imports
  `@shared/response-shaper.js`, `@shared/error-envelope.js`, `@shared/base-url.js` -
  these now resolve to the restored directory via the `tsup.config.ts` esbuild alias.
- The commit message for `adace06` states `npm run build` was verified passing in
  all three servers and `npm audit` = 0 vulnerabilities repo-wide; this was not
  independently re-executed in this docs-reconciliation pass (a pre-existing,
  session-local `node_modules.nosync.noindex` symlink issue in this sandbox
  environment prevented invoking `tsup` directly here - unrelated to the code
  change; the static import-resolution and file-restore evidence above stands on
  its own).

## Not fixed by this change

`auvik-mcp`, `connectwise-manage-mcp`, and `cipp-mcp` still use their own private
per-server `src/_shared/` copies rather than the now-restored top-level directory -
the DRY-divergence consolidation tech debt item remains open in `docs/ROADMAP.md`.
