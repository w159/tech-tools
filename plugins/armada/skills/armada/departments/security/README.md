# Security & Compliance Plugin

Claude plugin bundling security and compliance skills across Vanta (GRC),
KnowBe4 (security awareness), and ThreatLocker (zero-trust endpoint).

## Overview

This plugin gives Claude a cross-vendor security and compliance toolkit:

- Vanta - framework audit readiness and evidence gaps for SOC 2, ISO 27001, HIPAA, etc.
- KnowBe4 - user risk heatmaps with 90-day trend deltas
- ThreatLocker - approval-queue triage and audit-log forensics

## Skills

- `framework-audit-readiness` - assess audit readiness for a named Vanta framework and
  surface every failing test plus the controls it maps to.
- `evidence-gap-hunter` - find missing, expiring, or stale Vanta evidence documents.
- `risk-heatmap` - build a current user risk heatmap across groups with 90-day trend
  deltas from KnowBe4; useful before QBRs.
- `approval-queue-triage` - triage pending ThreatLocker approval requests with file-history,
  computer, and org context, including a recommended approve/deny verdict.
- `audit-forensics` - forensic walk of ThreatLocker audit logs to investigate a specific
  file, computer, or time window.

## Tools used

Skills call the Vanta, KnowBe4, and ThreatLocker MCP servers depending on the workflow.
Run each vendor's `*_status` tool first to confirm credentials before other calls.

## Configuration

The relevant MCP servers (Vanta, KnowBe4, ThreatLocker) must be installed and connected
for the matching skills to work. Each vendor's base URL is optional and defaults to the
documented endpoint; only set it for a non-default region or shard.

## Notes

- The skills are read-only reporting and triage workflows.
- If a vendor `*_status` tool reports the server is not connected, install and connect that
  MCP server before running its skills.
