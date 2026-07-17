# Plugin development scope: atlas and armada

Canonical companion to `AGENTS.md` Section 0. Read this if you are new to the
repository, or any time a request touches "atlas" or "armada" and you are unsure
what the user means.

The one rule this document exists to enforce:

> In this repository, "atlas" and "armada" are **software products under
> development**. A request about them is a request to **edit their source code**
> under `plugins/atlas/` or `plugins/armada/`, not to install, set up, configure,
> deploy, or operate them inside this workspace.

Everything below explains why that rule exists, exactly where the source lives,
and how to tell a code-change request from an operate-the-plugin request.

---

## 1. What this repository is

This is the **atlas marketplace** repo. Its root manifest,
`.claude-plugin/marketplace.json`, declares a Claude Code plugin marketplace named
`atlas` that publishes two plugins:

| Plugin   | Source directory   | What the product is                                                                 |
|----------|--------------------|-------------------------------------------------------------------------------------|
| `atlas`  | `plugins/atlas/`   | Multi-agent coding architect: skills, core agents, hooks, output styles, MCP config. |
| `armada` | `plugins/armada/`  | Organizational deployment layer for atlas: department agents and department skills.  |

A consumer would add this marketplace in Claude Code and install one or both
plugins. That consumer workflow is **not** what happens in this repo. Here, we are
the authors: we change the plugins' code and ship new versions.

The repository also holds the plugins' dependencies (see Section 4) and their
developer documentation (this `docs/` tree).

## 2. Why the distinction matters (the confusion vector)

atlas and armada are unusual to develop because **the harness you are working in
has them loaded and running.** While you edit atlas's source, an instance of atlas
is simultaneously active in your session:

- the active output style may be `atlas:Atlas Orchestrator`;
- atlas and armada skills appear in the skill list (`atlas-setup`, `atlas-audit`,
  `/armada:armada`, and dozens more);
- the atlas subagent squad (`atlas:explorer`, `atlas:verifier`, ...) is registered;
- a running atlas writes runtime state into `.atlas/` as you go.

This creates a trap. A prompt like "configure ConnectWise and NinjaOne for armada"
can be misread two ways:

1. **Wrong (operate):** invoke `/armada:armada` and walk its interactive setup to
   write a department config into `.atlas/departments/it-operations.yaml`, as if
   this repo were a customer's live environment. This has already happened in a
   prior session and is exactly what we are preventing.
2. **Right (develop):** edit the armada plugin source so the product knows how to
   handle ConnectWise and NinjaOne - the department agent definition under
   `plugins/armada/agents/`, the relevant skill, and the backing MCP connector.

Default to interpretation 2. If a prompt genuinely asks you to run the plugin
against this workspace, confirm scope first.

## 3. Source maps

### atlas - `plugins/atlas/`

```
plugins/atlas/
├── SKILL.md            # top-level atlas skill entry
├── agents/             # core subagent definitions (explorer, verifier, planner, ...)
├── hooks/              # self-improvement + lifecycle hooks
├── mcp/                # atlas's own MCP config
├── output-styles/      # the Atlas Orchestrator output style
├── references/         # reference material bundled with the plugin
├── scripts/            # helper scripts shipped with the plugin
├── skills/             # the /atlas-* skills (atlas-orchestrate, atlas-audit, ...)
├── CHANGELOG.md
└── README.md
```

Edit targets for an atlas change: whichever of `skills/`, `agents/`, `hooks/`,
`output-styles/`, `scripts/`, `mcp/` owns the behavior, plus `plugin.json` and
`CHANGELOG.md`/`README.md` when the user-visible surface changes.

### armada - `plugins/armada/`

```
plugins/armada/
├── agents/             # one department agent per file (armada-data.md, armada-it-ops.md, ...)
└── skills/             # department skills carrying org branding, policy, compliance context
```

Edit targets for an armada change: the department agent(s) under `agents/`, the
relevant department skill(s) under `skills/`, plus the plugin manifest when the
surface changes.

### The marketplace

`.claude-plugin/marketplace.json` is the product manifest: plugin names, source
paths, descriptions, keywords, and marketplace version. Update it when a plugin's
identity, description, or published surface changes.

## 4. Dependencies (also in scope)

When the user says "atlas/armada or their dependencies," that includes everything
the plugins are built on:

- **Shared plugin libraries:** `plugins/_standards/`, `plugins/_templates/`, and
  the top-level `skills/` library that plugin skills draw from.
- **Vendor connectors that armada department agents call:**
  - `mcp_servers/<svc>-mcp/` - the MCP server per vendor (Auvik, Blumira, CIPP,
    ConnectWise Manage, KnowBe4, NinjaOne, Paylocity, Spanning, ThreatLocker, Vanta).
  - the `.mcpb` archives those servers pack into.
  - `mcp_node/node-<svc>/` - the Node client libraries those servers depend on.

Changes to a vendor connector propagate across every layer for that vendor. That
propagation is already specified in `AGENTS.md` Sections 1 and 2 (the "tools"
definition and the mandatory propagation checklist). Follow it.

## 5. Correct vs incorrect interpretation

| User says | Wrong (operate the plugin) | Right (develop the plugin) |
|-----------|----------------------------|-----------------------------|
| "Add a step to atlas-orchestrate that runs the verifier twice." | Run `/atlas-orchestrate` and do the work. | Edit `plugins/atlas/skills/atlas-orchestrate/SKILL.md`. |
| "armada's IT-ops agent should mention SLA policy." | Run `/armada:armada` to reconfigure a department. | Edit `plugins/armada/agents/armada-it-ops.md`. |
| "Fix the atlas nudge hook - it fires too often." | Adjust `.atlas/nudge/` runtime state. | Edit the hook source in `plugins/atlas/hooks/`. |
| "Set up ConnectWise for armada." | Walk `/armada:armada` setup, write `.atlas/departments/*.yaml`. | Edit the armada department agent/skill and the `connectwise-manage` MCP connector. |
| "Bump atlas and publish." | Try to install/publish into this session. | Edit `plugins/atlas/plugin.json` + `.claude-plugin/marketplace.json` versions, update CHANGELOG. |

## 6. Runtime artifacts - not the product

These directories are state written by a *running* atlas/armada in this session or
prior ones. They are not the plugin source and are not edit targets unless the user
explicitly asks about atlas's own runtime behavior:

- `.atlas/` (`departments/`, `evidence/`, `nudge/`, `self-improvement/`)
- `.fallow/`, `.supermemory/`, `.taskmaster/`

If a task pushes you to write into these instead of into `plugins/`, that is the
signal you have slipped from "develop" into "operate." Stop and re-read Section 2.

## 7. When to confirm scope

Ask before acting only when the prompt is genuinely ambiguous about develop vs
operate - for example, a request that could plausibly mean "add a runtime fixture
for testing atlas's own behavior." In every ordinary case (add/fix/change/improve
a feature), the default holds: change the plugin source under `plugins/`, then
verify with evidence.
