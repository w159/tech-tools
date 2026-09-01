#!/usr/bin/env python3
"""Atlas control plane: behavior knobs, ecosystem inventory, connector operations.

Backs the dashboard's /api/behavior, /api/ecosystem, /api/mcp/* and the
connector test / import / export routes. It lives beside atlas_dashboard.py so
that file stays the HTTP + UI layer instead of growing a second personality.

Every write is allowlisted and lands in exactly one of three places:

  ~/.claude/settings.json  env / disabledMcpServers / enabledPlugins
  ~/.claude.json           mcpServers  (user-scope MCP servers, `claude mcp add`)
  <plugin>/.env            connector credentials (handled in atlas_dashboard)

Behavior knobs go to settings.json `env` because Claude Code exports that block
into every hook subprocess, which is where the ATLAS_* vars are actually read.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPTS_DIR.parent
CLAUDE_DIR = Path.home() / ".claude"
SETTINGS_PATH = CLAUDE_DIR / "settings.json"
CLAUDE_JSON_PATH = Path.home() / ".claude.json"
PLUGINS_DIR = CLAUDE_DIR / "plugins"

ENV_KEY_RE = re.compile(r"^ATLAS_[A-Z0-9_]+$")
MCP_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")
MAX_VALUE_LEN = 2048


# --- settings.json / .claude.json read + write --------------------------------


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data: dict) -> None:
    """Write via a temp file in the same directory so a crash cannot truncate."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".atlas-tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def read_settings() -> dict:
    return _read_json(SETTINGS_PATH)


def mutate_settings(fn):
    """Apply fn(settings_dict) in place and persist. Returns the new settings."""
    data = read_settings()
    fn(data)
    _write_json(SETTINGS_PATH, data)
    return data


# --- behavior knobs -----------------------------------------------------------
#
# Each entry documents a variable the atlas hooks actually read, with the
# file:line that reads it so the UI can show its own evidence. `default` is the
# hook's fallback, not a value we write.

BEHAVIOR_KNOBS = [
    # -- Session automation
    {
        "key": "ATLAS_DASHBOARD",
        "group": "Session automation",
        "title": "Auto-start this dashboard",
        "description": "SessionStart launches the shared loopback daemon. Off means you start it yourself with `atlas_dashboard.py ensure`.",
        "kind": "toggle",
        "on": "on",
        "off": "off",
        "default": "on",
        "ref": "hooks/session_boot.py:25",
    },
    {
        "key": "ATLAS_DASHBOARD_PORT",
        "group": "Session automation",
        "title": "Dashboard port",
        "description": "Loopback port for the shared daemon. Every terminal must agree on it.",
        "kind": "number",
        "default": "7421",
        "ref": "scripts/atlas_dashboard.py:35",
    },
    {
        "key": "ATLAS_INGEST",
        "group": "Session automation",
        "title": "Session transcript ingest",
        "description": "Reads the finished session transcript into atlas.db so runs, tools and dispatches show up here. Off leaves this dashboard mostly empty.",
        "kind": "toggle",
        "on": "on",
        "off": "off",
        "default": "on",
        "ref": "hooks/ingest_session.py:26",
    },
    {
        "key": "ATLAS_CHRONICLE",
        "group": "Session automation",
        "title": "Chronicle facet capture",
        "description": "Records per-session facets (what kind of work, which surfaces) used by atlas-doctor to mine cross-session findings.",
        "kind": "toggle",
        "on": "on",
        "off": "off",
        "default": "on",
        "ref": "hooks/chronicle_facet.py:168",
    },
    {
        "key": "ATLAS_MEMORY_CAPTURE",
        "group": "Session automation",
        "title": "Memory capture",
        "description": "Writes durable lessons to ~/.atlas/memory/ at session end. Never creates skills or commands.",
        "kind": "toggle",
        "on": "on",
        "off": "off",
        "default": "on",
        "ref": "hooks/memory_capture.py:319",
    },
    {
        "key": "ATLAS_CONNECTOR_WATCH",
        "group": "Session automation",
        "title": "Connector credential watch",
        "description": "Warns in-session when a connector call fails because its credentials are missing or stale, instead of reporting a permissions problem.",
        "kind": "toggle",
        "on": "on",
        "off": "off",
        "default": "on",
        "ref": "hooks/connector_credential_watch.py:131",
    },
    # -- Guardrails
    {
        "key": "ATLAS_GATE",
        "group": "Guardrails",
        "title": "Completion gate + docs-drift watch",
        "description": "Blocks a 'done' claim that has no verified finding, and flags source changes with no matching docs/ update. Turning this off removes atlas's main evidence guarantee.",
        "kind": "toggle",
        "on": "",
        "off": "off",
        "default": "",
        "ref": "hooks/completion_gate.py:432",
    },
    {
        "key": "ATLAS_TRIPWIRE",
        "group": "Guardrails",
        "title": "Dispatch tripwire",
        "description": "Watches for inline work piling up in an orchestration run and pushes it back toward subagent dispatch.",
        "kind": "toggle",
        "on": "on",
        "off": "off",
        "default": "on",
        "ref": "hooks/dispatch_tripwire.py:261",
    },
    {
        "key": "ATLAS_TRIPWIRE_HARD",
        "group": "Guardrails",
        "title": "Tripwire blocks (not just warns)",
        "description": "On: the tripwire denies the tool call once the threshold is crossed. Off: it only prints a warning.",
        "kind": "toggle",
        "on": "on",
        "off": "off",
        "default": "on",
        "ref": "hooks/dispatch_tripwire.py:192",
    },
    {
        "key": "ATLAS_TRIPWIRE_THRESHOLD",
        "group": "Guardrails",
        "title": "Tripwire threshold",
        "description": "Inline operations allowed in an armed orchestration run before the tripwire fires.",
        "kind": "number",
        "default": "4",
        "ref": "hooks/dispatch_tripwire.py:143",
    },
    {
        "key": "ATLAS_ENGINE_ARM",
        "group": "Guardrails",
        "title": "Arm orchestration from the prompt",
        "description": "Classifies each prompt and arms the orchestration run up front, so substantive work is nudged to dispatch before the first inline edit.",
        "kind": "toggle",
        "on": "on",
        "off": "off",
        "default": "on",
        "ref": "hooks/prompt_optimizer.py:392",
    },
    # -- Prompt optimizer
    {
        "key": "ATLAS_OPTIMIZE",
        "group": "Prompt optimizer",
        "title": "Optimizer mode",
        "description": "trigger: only prompts starting with a trigger prefix. always: every non-trivial prompt (adds model latency to each one). off: never.",
        "kind": "choice",
        "options": ["off", "trigger", "always"],
        "default": "trigger",
        "ref": "hooks/prompt_optimizer.py:155",
    },
    {
        "key": "ATLAS_OPTIMIZE_TRIGGER",
        "group": "Prompt optimizer",
        "title": "Trigger prefixes",
        "description": "Comma-separated prefixes that request optimization in trigger mode.",
        "kind": "text",
        "default": "opt:,optimize:,++",
        "ref": "hooks/prompt_optimizer.py:162",
    },
    {
        "key": "ATLAS_OPTIMIZER_MODEL",
        "group": "Prompt optimizer",
        "title": "Ollama model tag",
        "description": "Local model that rewrites the prompt.",
        "kind": "text",
        "default": "prompt-optimizer:latest",
        "ref": "hooks/prompt_optimizer.py:247",
    },
    {
        "key": "ATLAS_OLLAMA_URL",
        "group": "Prompt optimizer",
        "title": "Ollama base URL",
        "description": "Falls back to $OLLAMA_HOST, then http://127.0.0.1:11434.",
        "kind": "text",
        "default": "http://127.0.0.1:11434",
        "ref": "hooks/prompt_optimizer.py:214",
    },
    {
        "key": "ATLAS_OPTIMIZE_MINLEN",
        "group": "Prompt optimizer",
        "title": "Minimum prompt length",
        "description": "Prompts shorter than this many characters skip the optimizer instantly, before any model call.",
        "kind": "number",
        "default": "12",
        "ref": "hooks/prompt_optimizer.py:165",
    },
    {
        "key": "ATLAS_OPTIMIZE_TIMEOUT",
        "group": "Prompt optimizer",
        "title": "Optimizer timeout (seconds)",
        "description": "Give up and pass the original prompt through after this long. Keep it under the hook timeout in hooks.json (120s).",
        "kind": "number",
        "default": "110",
        "ref": "hooks/prompt_optimizer.py:243",
    },
    {
        "key": "ATLAS_OPTIMIZE_CMD",
        "group": "Prompt optimizer",
        "title": "Override command",
        "description": "Run this instead of ollama. `{prompt}` is substituted; otherwise the prompt is appended as the last argument. Blank uses ollama.",
        "kind": "text",
        "default": "",
        "ref": "hooks/prompt_optimizer.py:183",
    },
    {
        "key": "ATLAS_OPTIMIZE_VERBOSE",
        "group": "Prompt optimizer",
        "title": "Print optimizer banner",
        "description": "Any non-empty value prints a one-line stderr banner when a prompt is rewritten. Quiet by default.",
        "kind": "toggle",
        "on": "1",
        "off": "",
        "default": "",
        "ref": "hooks/prompt_optimizer.py:465",
    },
    {
        "key": "ATLAS_OPTIMIZE_LOG",
        "group": "Prompt optimizer",
        "title": "Audit log path",
        "description": "Append an original-to-optimized line to this file. Blank disables the log.",
        "kind": "text",
        "default": "",
        "ref": "hooks/prompt_optimizer.py:486",
    },
    # -- Storage paths
    {
        "key": "ATLAS_HOME",
        "group": "Storage paths",
        "title": "Atlas state directory",
        "description": "Holds atlas.db, memory/, the dashboard pidfile and log.",
        "kind": "text",
        "default": str(Path.home() / ".atlas"),
        "ref": "scripts/atlas_memory.py:59",
    },
    {
        "key": "ATLAS_DB",
        "group": "Storage paths",
        "title": "Telemetry database",
        "description": "The sqlite file every hook writes to and this dashboard reads. Changing it hides existing history.",
        "kind": "text",
        "default": str(Path.home() / ".atlas" / "atlas.db"),
        "ref": "scripts/atlas_db.py:122",
    },
]

_KNOBS_BY_KEY = {k["key"]: k for k in BEHAVIOR_KNOBS}

# Hooks reach the environment several ways -- os.environ.get, os.getenv, and
# prompt_optimizer's own _env()/_env_num() wrappers -- so match the variable name
# itself rather than one call shape. The lookbehind keeps module-local constants
# like build_hub's _ATLAS_CSS out of the environment allowlist.
_ENV_READ_RE = re.compile(r"(?<![A-Za-z0-9_])(ATLAS_[A-Z0-9_]+)")


def discovered_env_keys() -> dict:
    """Every ATLAS_* var the shipped hooks and scripts read, with its file:line.

    The curated list above is hand-written and can fall behind the code; this
    scan is what keeps the advanced table honest.
    """
    found: dict[str, str] = {}
    for folder in ("hooks", "scripts"):
        base = PLUGIN_ROOT / folder
        if not base.is_dir():
            continue
        for path in sorted(base.glob("*.py")):
            if path.name.startswith("test_"):
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except Exception:
                continue
            for lineno, line in enumerate(lines, 1):
                for m in _ENV_READ_RE.finditer(line):
                    found.setdefault(m.group(1), f"{folder}/{path.name}:{lineno}")
    return found


def _settings_env() -> dict:
    env = read_settings().get("env")
    return env if isinstance(env, dict) else {}


def behavior_state() -> dict:
    """Curated knob groups plus every other ATLAS_* key the code reads."""
    settings_env = _settings_env()
    discovered = discovered_env_keys()

    def resolve(key, default):
        if key in settings_env:
            return str(settings_env[key]), "settings"
        if os.environ.get(key) not in (None, ""):
            return os.environ[key], "process"
        return default, "default"

    groups: dict[str, dict] = {}
    for knob in BEHAVIOR_KNOBS:
        value, source = resolve(knob["key"], knob.get("default", ""))
        entry = dict(knob)
        entry["value"] = value
        entry["source"] = source
        entry["ref"] = discovered.get(knob["key"], knob.get("ref", ""))
        g = groups.setdefault(
            knob["group"], {"id": knob["group"], "title": knob["group"], "knobs": []}
        )
        g["knobs"].append(entry)

    advanced = []
    for key, ref in sorted(discovered.items()):
        if key in _KNOBS_BY_KEY:
            continue
        value, source = resolve(key, "")
        advanced.append({"key": key, "value": value, "source": source, "ref": ref})
    # Keys already set in settings.json that no shipped file reads: still show them.
    for key in sorted(settings_env):
        if (
            key.startswith("ATLAS_")
            and key not in _KNOBS_BY_KEY
            and key not in discovered
        ):
            advanced.append(
                {
                    "key": key,
                    "value": str(settings_env[key]),
                    "source": "settings",
                    "ref": "(not read by any shipped file)",
                }
            )

    return {
        "groups": list(groups.values()),
        "advanced": advanced,
        "settings_path": str(SETTINGS_PATH),
        "note": 'Values are written to settings.json "env", which Claude Code exports into every hook process. Reload Claude Code for a change to reach a running session.',
    }


def write_behavior_updates(updates: dict) -> dict:
    """Write ATLAS_* knobs to settings.json env. Empty value removes the key."""
    if not isinstance(updates, dict) or not updates:
        return {"ok": False, "error": "updates_required"}
    allowed = set(_KNOBS_BY_KEY) | set(discovered_env_keys())
    cleaned: dict[str, str] = {}
    removed: list[str] = []
    bad: list[str] = []
    for key, raw in updates.items():
        key = str(key or "").strip()
        if not ENV_KEY_RE.match(key) or key not in allowed:
            bad.append(key)
            continue
        value = "" if raw is None else str(raw)
        value = value.replace("\n", "").replace("\r", "").strip()
        if len(value) > MAX_VALUE_LEN:
            bad.append(key)
            continue
        if value == "":
            removed.append(key)
        else:
            cleaned[key] = value
    if bad:
        return {
            "ok": False,
            "error": "keys_not_allowlisted",
            "keys": bad,
            "hint": "Only ATLAS_* variables that a shipped hook or script actually reads can be set here.",
        }

    def apply(data):
        env = data.get("env")
        if not isinstance(env, dict):
            env = {}
            data["env"] = env
        env.update(cleaned)
        for key in removed:
            env.pop(key, None)

    mutate_settings(apply)
    return {
        "ok": True,
        "set": sorted(cleaned),
        "cleared": sorted(removed),
        "settings_path": str(SETTINGS_PATH),
        "note": "Saved. Reload Claude Code so hooks pick up the new environment.",
    }


# --- MCP servers --------------------------------------------------------------
#
# Claude Code disables a server by listing its name in settings.disabledMcpServers.
# A plugin-provided server is named "plugin:<plugin>:<server>"; a user server from
# ~/.claude.json is named by its own key.


def _disabled_servers() -> list:
    v = read_settings().get("disabledMcpServers")
    return [str(x) for x in v] if isinstance(v, list) else []


def _plugin_mcp_servers(plugin_dir: Path, plugin_name: str) -> list:
    """Servers declared by one plugin, as (qualified_name, bare_name, cfg)."""
    manifest = _read_json(plugin_dir / ".claude-plugin" / "plugin.json")
    ref = manifest.get("mcpServers")
    servers = {}
    if isinstance(ref, str):
        # The manifest points at a sibling file, usually "./.mcp.json". Strip the
        # "./" as a prefix -- lstrip() would eat the leading dot of ".mcp.json".
        rel = ref[2:] if ref.startswith("./") else ref
        servers = (_read_json(plugin_dir / rel) or {}).get("mcpServers") or {}
    elif isinstance(ref, dict):
        servers = ref
    elif (plugin_dir / ".mcp.json").is_file():
        servers = _read_json(plugin_dir / ".mcp.json").get("mcpServers") or {}
    out = []
    for bare, cfg in (servers or {}).items():
        out.append(
            (f"plugin:{plugin_name}:{bare}", bare, cfg if isinstance(cfg, dict) else {})
        )
    return out


def mcp_inventory() -> dict:
    """Every MCP server this install can see, with its enabled state and origin."""
    disabled = set(_disabled_servers())
    rows = []

    for name, cfg in (_read_json(CLAUDE_JSON_PATH).get("mcpServers") or {}).items():
        cfg = cfg if isinstance(cfg, dict) else {}
        rows.append(
            {
                "name": name,
                "bare_name": name,
                "origin": "user",
                "origin_detail": str(CLAUDE_JSON_PATH),
                "transport": cfg.get("type") or ("http" if cfg.get("url") else "stdio"),
                "command": cfg.get("command") or cfg.get("url") or "",
                "enabled": name not in disabled,
                "env_keys": sorted((cfg.get("env") or {}).keys()),
                "removable": True,
            }
        )

    for plugin in installed_plugins():
        pdir = Path(plugin["path"]) if plugin.get("path") else None
        if not pdir or not pdir.is_dir():
            continue
        for qualified, bare, cfg in _plugin_mcp_servers(pdir, plugin["name"]):
            rows.append(
                {
                    "name": qualified,
                    "bare_name": bare,
                    "origin": "plugin",
                    "origin_detail": plugin["key"],
                    "transport": cfg.get("type")
                    or ("http" if cfg.get("url") else "stdio"),
                    "command": cfg.get("command") or cfg.get("url") or "",
                    "enabled": plugin["enabled"] and qualified not in disabled,
                    "plugin_enabled": plugin["enabled"],
                    "env_keys": sorted((cfg.get("env") or {}).keys()),
                    "removable": False,
                }
            )

    rows.sort(key=lambda r: (r["origin"] != "plugin", r["name"]))
    return {"servers": rows, "disabled": sorted(disabled)}


def set_mcp_enabled(name: str, enabled: bool) -> dict:
    name = str(name or "").strip()
    if not name:
        return {"ok": False, "error": "name_required"}
    known = {r["name"] for r in mcp_inventory()["servers"]}
    if name not in known:
        return {"ok": False, "error": "unknown_server", "name": name}

    def apply(data):
        current = data.get("disabledMcpServers")
        current = [str(x) for x in current] if isinstance(current, list) else []
        if enabled:
            current = [x for x in current if x != name]
        elif name not in current:
            current.append(name)
        # Drop the key entirely when nothing is disabled, rather than leaving an
        # empty array behind in the user's settings.
        if current:
            data["disabledMcpServers"] = sorted(current)
        else:
            data.pop("disabledMcpServers", None)

    mutate_settings(apply)
    return {
        "ok": True,
        "name": name,
        "enabled": bool(enabled),
        "note": "Saved to settings.json disabledMcpServers. Reload Claude Code to apply.",
    }


def add_mcp_server(spec: dict) -> dict:
    """Add a user-scope stdio or http MCP server to ~/.claude.json."""
    name = str((spec or {}).get("name") or "").strip()
    if not MCP_NAME_RE.match(name):
        return {
            "ok": False,
            "error": "invalid_name",
            "hint": "Letters, digits, dot, dash, underscore; 1-64 chars.",
        }
    url = str(spec.get("url") or "").strip()
    command = str(spec.get("command") or "").strip()
    if not url and not command:
        return {"ok": False, "error": "command_or_url_required"}
    if url and not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "invalid_url"}

    args = spec.get("args")
    if isinstance(args, str):
        import shlex

        args = shlex.split(args)
    args = [str(a) for a in (args or [])]

    env = spec.get("env")
    env = {str(k): str(v) for k, v in env.items()} if isinstance(env, dict) else {}

    cfg: dict = (
        {"type": "http", "url": url} if url else {"command": command, "args": args}
    )
    if env:
        cfg["env"] = env

    data = _read_json(CLAUDE_JSON_PATH)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        servers = {}
        data["mcpServers"] = servers
    existed = name in servers
    servers[name] = cfg
    _write_json(CLAUDE_JSON_PATH, data)
    return {
        "ok": True,
        "name": name,
        "replaced": existed,
        "path": str(CLAUDE_JSON_PATH),
        "note": "Saved to ~/.claude.json. Reload Claude Code to connect.",
    }


def remove_mcp_server(name: str) -> dict:
    name = str(name or "").strip()
    data = _read_json(CLAUDE_JSON_PATH)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict) or name not in servers:
        return {"ok": False, "error": "unknown_user_server", "name": name}
    servers.pop(name)
    _write_json(CLAUDE_JSON_PATH, data)
    return {"ok": True, "name": name, "path": str(CLAUDE_JSON_PATH)}


# --- plugins, skills, agents, hooks ------------------------------------------


def _count_dir(path: Path, suffixes=(".md",)) -> int:
    if not path.is_dir():
        return 0
    n = 0
    for entry in path.iterdir():
        if entry.is_dir() and (entry / "SKILL.md").is_file():
            n += 1
        elif entry.is_file() and entry.suffix in suffixes:
            n += 1
    return n


def _plugin_search_paths() -> dict:
    """Map plugin key -> on-disk root, from installed_plugins.json and marketplaces."""
    roots: dict[str, Path] = {}
    installed = _read_json(PLUGINS_DIR / "installed_plugins.json").get("plugins") or {}
    for key, entries in installed.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            path = Path(str((entry or {}).get("installPath") or ""))
            if path.is_dir():
                roots[key] = path
                break
    # Marketplace checkouts host the source copy; use them when no install cache exists.
    market = PLUGINS_DIR / "marketplaces"
    if market.is_dir():
        for repo in market.iterdir():
            if not repo.is_dir():
                continue
            for candidate in list(
                repo.glob("plugins/*/.claude-plugin/plugin.json")
            ) + list(repo.glob(".claude-plugin/plugin.json")):
                pdir = candidate.parent.parent
                name = (_read_json(candidate).get("name") or pdir.name).strip()
                roots.setdefault(f"{name}@{repo.name}", pdir)
    return roots


def installed_plugins() -> list:
    """Installed plugins with enabled state and a content census."""
    enabled_map = read_settings().get("enabledPlugins") or {}
    roots = _plugin_search_paths()
    keys = sorted(set(roots) | set(k for k in enabled_map if isinstance(k, str)))
    out = []
    for key in keys:
        name, _, marketplace = key.partition("@")
        pdir = roots.get(key)
        manifest = _read_json(pdir / ".claude-plugin" / "plugin.json") if pdir else {}
        servers = _plugin_mcp_servers(pdir, name) if pdir else []
        out.append(
            {
                "key": key,
                "name": manifest.get("name") or name,
                "marketplace": marketplace or "",
                "version": manifest.get("version") or "",
                "description": (manifest.get("description") or "")[:400],
                "path": str(pdir) if pdir else "",
                "installed": bool(pdir),
                "enabled": bool(enabled_map.get(key)),
                "skills": _count_dir(pdir / "skills") if pdir else 0,
                "agents": _count_dir(pdir / "agents") if pdir else 0,
                "commands": _count_dir(pdir / "commands") if pdir else 0,
                "output_styles": _count_dir(pdir / "output-styles") if pdir else 0,
                "hooks": 1 if pdir and (pdir / "hooks" / "hooks.json").is_file() else 0,
                "mcp_servers": [qualified for qualified, _bare, _cfg in servers],
            }
        )
    out.sort(key=lambda p: (not p["enabled"], p["key"]))
    return out


def set_plugin_enabled(key: str, enabled: bool) -> dict:
    key = str(key or "").strip()
    known = {p["key"] for p in installed_plugins()}
    if key not in known:
        return {"ok": False, "error": "unknown_plugin", "key": key}
    if key.startswith("atlas@") and not enabled:
        return {
            "ok": False,
            "error": "cannot_disable_host_plugin",
            "hint": "Atlas serves this page. Disable it with `claude plugin disable atlas` from a terminal.",
        }

    def apply(data):
        plugins = data.get("enabledPlugins")
        if not isinstance(plugins, dict):
            plugins = {}
            data["enabledPlugins"] = plugins
        plugins[key] = bool(enabled)

    mutate_settings(apply)
    return {
        "ok": True,
        "key": key,
        "enabled": bool(enabled),
        "note": "Saved. Reload Claude Code to apply.",
    }


def _list_names(path: Path, suffixes=(".md",)) -> list:
    if not path.is_dir():
        return []
    names = []
    for entry in sorted(path.iterdir()):
        if entry.name.startswith("."):
            continue
        if entry.is_dir() and (entry / "SKILL.md").is_file():
            names.append(entry.name)
        elif entry.is_file() and entry.suffix in suffixes:
            names.append(entry.stem.replace(".agent", ""))
    return names


def atlas_wiring() -> dict:
    """What atlas ships versus what is actually wired into this install."""
    hooks_json = _read_json(PLUGIN_ROOT / "hooks" / "hooks.json").get("hooks") or {}
    bindings = []
    for event, blocks in hooks_json.items():
        for block in blocks if isinstance(blocks, list) else []:
            for hook in (block or {}).get("hooks") or []:
                command = str(hook.get("command") or "")
                m = re.search(r"/(hooks|scripts)/([A-Za-z0-9_]+\.py)", command)
                script = f"{m.group(1)}/{m.group(2)}" if m else command[:80]
                bindings.append(
                    {
                        "event": event,
                        "matcher": (block or {}).get("matcher") or "*",
                        "script": script,
                        "present": (PLUGIN_ROOT / script).is_file() if m else False,
                        "timeout": hook.get("timeout"),
                    }
                )
    settings = read_settings()
    return {
        "plugin_enabled": bool(
            (settings.get("enabledPlugins") or {}).get("atlas@tech-tools")
        ),
        "hooks_disabled_globally": bool(settings.get("disableAllHooks")),
        "output_style": settings.get("outputStyle") or "",
        "bindings": bindings,
        "skills": _list_names(PLUGIN_ROOT / "skills"),
        "agents": _list_names(PLUGIN_ROOT / "agents"),
        "output_styles": _list_names(PLUGIN_ROOT / "output-styles"),
        "plugin_root": str(PLUGIN_ROOT),
    }


def ecosystem_inventory() -> dict:
    settings = read_settings()
    user_hooks = settings.get("hooks") or {}
    return {
        "plugins": installed_plugins(),
        "mcp": mcp_inventory(),
        "atlas": atlas_wiring(),
        "user": {
            "skills": _list_names(CLAUDE_DIR / "skills"),
            "agents": _list_names(CLAUDE_DIR / "agents"),
            "commands": _list_names(CLAUDE_DIR / "commands"),
            "output_styles": _list_names(CLAUDE_DIR / "output-styles"),
            "hook_events": sorted(user_hooks.keys())
            if isinstance(user_hooks, dict)
            else [],
            "active_output_style": settings.get("outputStyle") or "default",
        },
        "settings_path": str(SETTINGS_PATH),
        "claude_json_path": str(CLAUDE_JSON_PATH),
    }


# --- connector connection test ------------------------------------------------


def _rpc_line(obj) -> bytes:
    return (json.dumps(obj) + "\n").encode("utf-8")


def connector_entry(name: str) -> tuple[Path, list[str] | None]:
    """Resolve a connector's vendored entry point and how to start it.

    Node connectors are a single ESM bundle. Python connectors are a vendored
    source tree that uv runs against its own pinned lockfile, through the
    Python env preloader so CFG_* values are promoted the same way.
    """
    node_bundle = PLUGIN_ROOT / "mcp" / name / "server.mjs"
    if node_bundle.is_file():
        return node_bundle, ["node", str(node_bundle)]
    project = PLUGIN_ROOT / "mcp" / name / "pyproject.toml"
    if project.is_file():
        servers = _read_json(PLUGIN_ROOT / ".mcp.json").get("mcpServers") or {}
        args = (servers.get(name) or {}).get("args") or []
        module = args[-1] if args else ""
        return project, [
            "uv",
            "run",
            "--project",
            str(project.parent),
            "python",
            str(PLUGIN_ROOT / "mcp" / "_env" / "load.py"),
            module,
        ]
    return node_bundle, None


def test_connector(name: str, env: dict | None = None, timeout: float = 20.0) -> dict:
    """Start the connector's stdio bundle and complete an MCP handshake.

    Proves the bundle runs and lists tools. It does not prove the vendor
    credentials are accepted -- that needs a live call the caller can make with
    the connector's own *_status tool.
    """
    name = str(name or "").strip()
    if not re.match(r"^[a-z0-9_-]+$", name):
        return {"ok": False, "error": "invalid_name"}
    entry, argv = connector_entry(name)
    if argv is None:
        return {"ok": False, "error": "bundle_missing", "path": str(entry)}

    proc_env = dict(os.environ)
    proc_env.update({str(k): str(v) for k, v in (env or {}).items()})
    started = time.time()
    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=proc_env,
            cwd=str(PLUGIN_ROOT),
        )
    except FileNotFoundError:
        return {
            "ok": False,
            "error": f"{argv[0]}_not_found",
            "hint": f"Install {argv[0]} to run this connector.",
        }

    payload = b"".join(
        [
            _rpc_line(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "atlas-dashboard", "version": "1.0"},
                    },
                }
            ),
            _rpc_line({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            _rpc_line(
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
            ),
        ]
    )
    try:
        out, err = proc.communicate(payload, timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, err = proc.communicate()
        return {
            "ok": False,
            "error": "timeout",
            "seconds": timeout,
            "stderr": (err or b"").decode("utf-8", "replace")[-600:],
        }

    server_info = {}
    tools: list = []
    for line in (out or b"").decode("utf-8", "replace").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        result = msg.get("result") or {}
        if msg.get("id") == 1:
            server_info = result.get("serverInfo") or {}
        elif msg.get("id") == 2:
            tools = result.get("tools") or []

    if not server_info and not tools:
        return {
            "ok": False,
            "error": "no_handshake",
            "exit_code": proc.returncode,
            "stderr": (err or b"").decode("utf-8", "replace")[-600:],
        }
    return {
        "ok": True,
        "name": name,
        "server": server_info.get("name") or name,
        "version": server_info.get("version") or "",
        "tool_count": len(tools),
        "tools": [t.get("name") for t in tools[:12] if isinstance(t, dict)],
        "elapsed_ms": int((time.time() - started) * 1000),
        "note": "The bundle started and listed its tools. Vendor credentials are only proven by a live call.",
    }


# --- bulk env import / export -------------------------------------------------

ENV_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")


def parse_env_block(text: str) -> dict:
    """Parse pasted KEY=VALUE lines. Ignores comments, blanks and export prefixes."""
    updates: dict[str, str] = {}
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = ENV_LINE_RE.match(line)
        if not m:
            continue
        value = m.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if value:
            updates[m.group(1)] = value
    return updates


def env_export(connectors: list, redact: bool = True) -> str:
    """A .env template grouped by connector. Secrets are redacted by default."""
    lines = [
        "# Atlas connector credentials",
        "# Generated by the Atlas dashboard. Fill in the blanks and paste it back",
        "# into Connectors > Bulk import, or drop it at plugins/atlas/.env",
        "",
    ]
    for connector in connectors or []:
        lines.append(f"# --- {connector.get('name', '?')} ---")
        for field in connector.get("fields") or []:
            key = field.get("env_key") or (field.get("user_config_key") or "").upper()
            if not key:
                continue
            if field.get("sensitive"):
                # The marker goes on its own comment line: an inline "# set" would
                # be parsed back as the secret's value on re-import.
                if field.get("is_set"):
                    lines.append(f"# {key} is already set; fill in only to replace it")
                lines.append(f"{key}={'' if redact else str(field.get('value') or '')}")
            else:
                lines.append(f"{key}={field.get('value') or ''}")
        lines.append("")
    return "\n".join(lines)


def main(argv=None):
    """Small CLI so the control plane is inspectable without the web UI."""
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd = argv[0] if argv else "behavior"
    if cmd == "behavior":
        payload = behavior_state()
    elif cmd == "ecosystem":
        payload = ecosystem_inventory()
    elif cmd == "test" and len(argv) > 1:
        payload = test_connector(argv[1])
    else:
        sys.stderr.write(
            "usage: atlas_control.py [behavior|ecosystem|test <connector>]\n"
        )
        return 2
    json.dump(payload, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
