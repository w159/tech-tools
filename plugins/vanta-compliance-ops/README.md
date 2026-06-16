# Vanta Compliance Ops Plugin

Claude plugin for Vanta GRC operations, backed by the Vanta MCP server.

## Overview

This plugin gives Claude working knowledge of a Vanta account so it can answer
audit-readiness, evidence, vendor-risk, and vulnerability questions directly from
the API:

- Framework audit readiness - failing tests and the controls they map to for a
  given framework (SOC 2, ISO 27001, HIPAA, etc.)
- Evidence gaps - missing, expiring, or stale evidence documents across frameworks
- Vendor risk - third-party risk rollup, stale reviews, highest-risk vendors
- Vulnerability triage - overdue and SLA-breaching vulnerabilities by fix availability

## Commands

- `/vanta-audit-prep <framework-id-or-name>` - audit-prep dossier for a specific framework.
- `/vanta-morning` - daily GRC standup: failing tests, expiring evidence, overdue vulns,
  vendors in pending review.

## Skills

- `framework-audit-readiness` - assess audit readiness for a named framework and surface
  every non-passing test plus the controls it affects.
- `evidence-gap-hunter` - find missing, expiring, or stale evidence documents.
- `vendor-risk-rollup` - status breakdown, stale reviews, and highest-risk vendors.
- `vulnerability-triage` - rank vulnerabilities by SLA deadline and fix availability.

## Tools used

All skills call the Vanta MCP server. Run `vanta_status` first to confirm credentials,
then use the read tools such as `vanta_frameworks_list` / `vanta_frameworks_get`,
`vanta_controls_list`, `vanta_tests_list`, `vanta_documents_list`, `vanta_vendors_list`,
and `vanta_vulnerabilities_list`.

## Configuration

The Vanta MCP server must be installed and connected for these skills to work. It
authenticates with Vanta OAuth client credentials. `VANTA_BASE_URL` is optional and
defaults to `https://api.vanta.com/v1`; only set it for a non-default region.

## Notes

- The skills are read-only reporting workflows.
- If `vanta_status` reports the server is not connected, install and connect the Vanta
  MCP server in your Claude environment first.
