# S-panos-destructive-tools-annotated-read-only: NEW DEFECT: 22 of the 32 DESTRUCTIVE panos tools ship with readOnlyHint true and destructiveHint false, including panos_commit, panos_config_set and panos_software_install - plus panos_op, which its own description calls destructive

- id: S-panos-destructive-tools-annotated-read-only
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:50:25+00:00

## Evidence
- tools/list through the SHIPPED bundle: 50 of 60 tools carry annotations {readOnlyHint: true, destructiveHint: false, idempotentHint: true}. Of the 32 tools whose description starts with the DESTRUCTIVE: marker, 22 are annotated read-only: panos_config_set, panos_config_rename, panos_config_clone, panos_config_move, panos_config_override, panos_config_multi_move, panos_config_multi_clone, panos_commit, panos_commit_all, panos_globalprotect_disconnect, panos_import_file, panos_import_certificate, panos_policies_move, panos_updates_download, panos_updates_install, panos_software_download, panos_software_install, panos_cert_generate, panos_cert_renew, panos_cert_import, panos_cert_set_trusted_root, panos_cert_set_forward_trust.
- panos_op is annotated {readOnlyHint: true, destructiveHint: false} while its own description (mcp_servers/panos-mcp/src/domains/operations.ts:20) reads: 'An op command can be destructive (for example a restart, a config load, or a session clear) as easily as it can be read-only ... this tool does not know which commands are safe.' A client honoring the annotation would auto-approve <request><restart><system/></restart></request>.
- Root cause, two files: mcp_servers/panos-mcp/src/domains/_helpers.ts:56-59 destructiveTool() only prefixes the DESCRIPTION and never sets annotations; mcp_servers/panos-mcp/src/annotate-tool.ts:164-172 annotate() therefore classifies by NAME, and classifyTool() at :127-133 falls back to 'read' for any unmatched name. 'set', 'commit', 'op', 'move', 'clone', 'rename', 'override', 'import', 'download', 'install', 'generate', 'renew', 'disconnect' match no DESTRUCTIVE_PATTERNS or CREATE_PATTERNS entry. Only 10 names happen to match (config_edit, config_delete, objects_create/update/delete, policies_create/update/delete, system_reboot, cert_revoke) and are correctly labeled.
- No existing test catches this: boot-probe.mjs counts the DESCRIPTION prefix (destructive-prefixed: 32) and never asserts on annotations.

## Reproduction
Spawn plugins/atlas/mcp/panos/server.mjs, tools/list, then count tools where description.startsWith('DESTRUCTIVE:') and annotations.readOnlyHint === true -> 22

## Proposed fix
Make destructiveTool() set annotations {readOnlyHint: false, destructiveHint: true} directly (annotate() already skips any tool whose readOnlyHint is defined, annotate-tool.ts:166), and give panos_op an explicit non-read-only annotation. Then assert in boot-probe.mjs that every DESTRUCTIVE:-prefixed tool has readOnlyHint false, and that panos_op does too.

## Doc refs
- none

## History
- no earlier verdicts
