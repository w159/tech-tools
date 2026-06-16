# Cowork Plugin Management Plugin

Claude plugin for creating, customizing, and managing Claude Code plugins inside the
Cowork desktop environment.

## Overview

This plugin helps users build new plugins and tailor existing ones to a specific
organization's tools and workflows, without leaving a Cowork session.

## Skills

- `create-cowork-plugin` - guide users through creating a new plugin from scratch:
  scaffold the structure, design commands and skills, and wire up any MCP servers.
- `cowork-plugin-customizer` - customize an existing plugin for a specific organization's
  tools, settings, and workflows.

## Tools used

These skills use standard file operations to scaffold and edit plugin files (plugin.json,
commands, skills, agents) in the working directory. No external API credentials are
required.

## Notes

- Intended to run inside a Cowork session where the plugin directory is writable.
- The skills produce plugin files; review and test them with the repo test harness before
  packaging or distribution.
