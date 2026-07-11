---
name: atlas-hermes
description: Guided cross-plugin setup for the ten vendor MCP connectors (Auvik, Blumira, CIPP, ConnectWise Manage, Spanning, KnowBe4, NinjaOne, Paylocity, ThreatLocker, Vanta), which live in their owning domain plugins (it-operations, security-compliance, microsoft-365, hr-payroll), not atlas. Detects installed domain plugins, shows enabled connectors, and points you to the owning plugin's /plugin config for credentials. Atlas ships no connectors itself.
when_to_use: the task involves hermes
---


# Atlas connectors setup guide

Atlas does not bundle any vendor MCP connector. The ten connectors are single-sourced
in their owning domain plugins:

| Domain plugin | Connectors |
| --- | --- |
| it-operations | auvik, connectwise-manage, ninjaone, spanning |
| security-compliance | blumira, knowbe4, threatlocker, vanta |
| microsoft-365 | cipp |
| hr-payroll | paylocity |

Each domain plugin declares its own `userConfig` credential keys in its
`.claude-plugin/plugin.json` and its own `.mcp.json` launching the connector. They ship
INERT: every `userConfig` key defaults to `""`, so with no credentials the server fails
its own credential check and never loads. Filling a vendor's required keys on the
**owning plugin** is what enables it - not atlas.

**Elicitation:** when the user has not named a vendor, ask ONE multiSelect
AskUserQuestion listing the connectors with their current enabled/disabled state
(detected, not guessed) so they pick what to turn on. Credentials themselves are
collected via `/plugin` config on the owning domain plugin per the vendor table -
never through free-text chat, and never echoed back.

The full per-vendor table (keys, defaults, where to get each credential, doc paths,
owning plugin) lives in `vendors.md` next to this file. Read it before guiding any
setup.

## The ten connectors

auvik, blumira, cipp, connectwise-manage, spanning, knowbe4, ninjaone,
paylocity, threatlocker, vanta. The owning plugin and connector's svc dir are listed
in `vendors.md`.

## No-args behavior: status scan

When invoked with no specific vendor, report which connectors are set up vs not,
across every domain plugin that is installed.

1. Detect installed plugins: read `~/.claude/plugins/installed_plugins.json` if
   present. If it cannot be read or parsed, fall back to advising the user to run
   `/plugin` and read the list from there.
2. For each of the ten connectors, resolve its owning domain plugin (see the table
   above / `vendors.md`). If the owning plugin is not installed, mark the connector
   NOT INSTALLED and skip the enabled check - there is nothing to configure yet.
3. For connectors whose owning plugin is installed, read that plugin's effective
   `userConfig` values (the merged plugin config) and mark the connector ENABLED if
   all of its required keys (see `vendors.md`, "Required to enable") are non-empty,
   otherwise DISABLED.
4. Print a compact table: connector | owning plugin | installed/not installed |
   enabled/disabled. Then say which connectors are fully ready, which have an
   installed-but-unconfigured owning plugin, and which need the owning plugin
   installed first.

## Guided enable (a vendor was named, or the user picks one)

Work one connector at a time.

1. Open `vendors.md` and find the connector's row. Tell the user EXACTLY what
   that connector needs and nothing else:
   - the owning domain plugin (install it first via `/plugin` if not already
     installed);
   - the `userConfig` keys on that plugin, flagged required vs optional;
   - where to get each credential (the "Where to get credentials" column and the
     `docs/vendors/<dir>/` path);
   - the base-url / region default, and that the optional `*_base_url` key can be
     left blank to use it.
2. Tell the user to set those keys via `/plugin config` on the **owning domain
   plugin** - not on atlas. Required keys must be non-empty; optional keys,
   including every base URL, may stay blank.
3. Confirm: restate which keys were set on which plugin, and note that the
   connector loads on next use of that plugin's MCP server. If the owning plugin
   isn't installed yet, say so and give the install step first.

## Guardrails

- Never invent credential values. Collect them from the operator.
- Only collect the keys a chosen connector actually needs; do not over-ask.
- Leaving an optional base-url key blank is correct and expected; do not push the
  user to set it.
- Never direct credentials at atlas's own plugin config - atlas has no
  connector-related `userConfig` keys. Credentials always go on the owning domain
  plugin.
