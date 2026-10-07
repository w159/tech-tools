#!/usr/bin/env python3
"""Atlas capability discovery. Strictly read-only.

Scans a project for stack signals and emits ranked recommendations (skills,
plugins, MCP servers) with reasons and exact install commands. Never installs
anything. Prints a human table and a JSON block. Exits 0 always.
"""

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tool_routing  # noqa: E402

# Each rule: id, type, reason, install command, and a predicate over the scan context.
RULES = [
    {
        "id": "claude-mem",
        "type": "plugin",
        "reason": "Multi-session codebase; persist lessons across sessions for self-improvement.",
        "cmd": "claude plugin install claude-mem",
        "match": lambda c: True,
    },
    {
        "id": "context-mode",
        "type": "plugin",
        "reason": "Large outputs/logs present; protect the context window.",
        "cmd": "claude plugin install context-mode",
        "match": lambda c: c["has_logs"] or c["big_files"],
    },
    {
        "id": "context7",
        "type": "mcp",
        "reason": "Project uses many third-party libraries; live docs reduce guesswork.",
        "cmd": "claude mcp add context7 -- npx -y @upstash/context7-mcp",
        "match": lambda c: c["dep_count"] >= 8,
    },
    {
        "id": "serena",
        "type": "mcp",
        "reason": "Symbol intelligence for code: activate_project, overview, find, "
        "referencing, surgical edits. Primary nav; never start with Grep/Bash.",
        "cmd": "claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project-from-cwd",
        "match": lambda c: c["has_code"],
    },
    {
        "id": "lean-ctx",
        "type": "mcp",
        "reason": "Context-shaped compose/search/read so raw file bytes stay out of the window. "
        "Fallback when serena is down; first choice for prose/config.",
        "cmd": "claude mcp add lean-ctx -- lean-ctx",
        "match": lambda c: c["has_code"],
    },
    {
        "id": "fallow",
        "type": "cli",
        "reason": "JS/TS codebase intelligence (dead code, duplication, health). "
        "Atlas ships a PreToolUse fallow_gate that blocks git commit/push on "
        "fallow audit fail once the CLI is installed.",
        "cmd": "npm install -g fallow",
        "match": lambda c: c["js_ts"],
    },
    {
        "id": "fallow-mcp",
        "installed": "fallow",
        "type": "mcp",
        "reason": "Structured fallow tools for agents (audit, dead_code, dupes, health).",
        "cmd": "claude mcp add fallow -- fallow-mcp",
        "match": lambda c: c["js_ts"],
    },
    {
        "id": "fallow-skills",
        "type": "plugin",
        "reason": "Agent skills teaching fallow workflows, flags, and adoption recipes.",
        "cmd": "/plugin marketplace add fallow-rs/fallow-skills && "
        "/plugin install fallow-skills@fallow-rs/fallow-skills",
        "match": lambda c: c["js_ts"],
    },
    {
        "id": "playwright",
        "type": "mcp",
        "reason": "Frontend project; browser tests and runtime UI checks.",
        "cmd": "claude mcp add playwright -- npx -y @playwright/mcp@latest",
        "match": lambda c: c["frontend"],
    },
    {
        "id": "ui-ux-pro-max",
        "type": "skill",
        "reason": "Frontend project; design-system and UX guidance.",
        "cmd": "claude plugin install ui-ux-pro-max",
        "match": lambda c: c["frontend"],
    },
    {
        "id": "microsoft-docs",
        "type": "mcp",
        "reason": "Microsoft stack detected (PowerShell, Graph, .NET); official docs grounding.",
        "cmd": "claude mcp add --transport http microsoft-docs https://learn.microsoft.com/api/mcp",
        "match": lambda c: c["microsoft"],
    },
    # No iac/container rules: no real package exists to install, and a placeholder
    # command is worse than silence.
    {
        "id": "ponytail",
        "type": "plugin",
        "reason": "Lazy-senior-dev mode; ~54% less code while keeping safety. Session-augmentation tier.",
        "cmd": "copilot plugin marketplace add DietrichGebert/ponytail && copilot plugin install ponytail@ponytail",
        "match": lambda c: True,
    },
    {
        "id": "loop-library (atlas-loop)",
        "type": "note",
        "reason": "Built-in curated loops; use the atlas-loop skill.",
        "cmd": "(already shipped with atlas)",
        "match": lambda c: True,
    },
    {
        "id": "connectors (atlas-setup)",
        "type": "note",
        "reason": "Vendor MCP connectors ship inside atlas (plugins/atlas/mcp), "
        "unconfigured until credentials are saved; run the dashboard Settings page or "
        "the atlas-setup skill, then check <vendor>_status.",
        "cmd": "(already shipped with atlas)",
        "match": lambda c: c["has_mcp_servers"],
    },
]

SKIP_DIRS = {
    ".git",
    ".kilo",
    "node_modules",
    ".venv",
    ".venv.nosync.noindex",
    "venv",
    "dist",
    "build",
    "__pycache__",
    ".next",
    ".nuxt",
    ".cache",
}


def scan(root):
    c = {
        "dep_count": 0,
        "frontend": False,
        "js_ts": False,
        "has_code": False,
        "terraform": False,
        "containers": False,
        "microsoft": False,
        "has_logs": False,
        "big_files": False,
        "has_mcp_servers": False,
        "has_loops": True,
        "files": 0,
    }
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        if "mcp_servers" in dns:
            c["has_mcp_servers"] = True
        for fn in fns:
            c["files"] += 1
            low = fn.lower()
            if low.endswith(".mcpb"):
                c["has_mcp_servers"] = True
            if low.endswith(".tf"):
                c["terraform"] = True
            if low.endswith(".log"):
                c["has_logs"] = True
            if low.endswith(".ps1") or low.endswith(".csproj") or low.endswith(".sln"):
                c["microsoft"] = True
            if (
                fn == "Dockerfile"
                or low.endswith(".dockerfile")
                or fn in ("docker-compose.yml", "docker-compose.yaml")
            ):
                c["containers"] = True
            if low.endswith((".yaml", ".yml")) and (
                "k8s" in dp.lower() or "kustomize" in low or "deployment" in low
            ):
                c["containers"] = True
            if low.endswith(
                (
                    ".ts",
                    ".tsx",
                    ".js",
                    ".jsx",
                    ".mjs",
                    ".cjs",
                    ".mts",
                    ".cts",
                    ".py",
                    ".go",
                    ".rs",
                    ".java",
                    ".cs",
                )
            ):
                c["has_code"] = True
            if low.endswith(
                (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts")
            ):
                c["js_ts"] = True
                c["has_code"] = True
            if fn in (
                "pyproject.toml",
                "setup.py",
                "requirements.txt",
                "go.mod",
                "Cargo.toml",
            ):
                c["has_code"] = True
            if fn == "package.json":
                c["js_ts"] = True
                c["has_code"] = True
                try:
                    with open(os.path.join(dp, fn), encoding="utf-8") as fh:
                        pkg = json.load(fh)
                    deps = {}
                    deps.update(pkg.get("dependencies", {}) or {})
                    deps.update(pkg.get("devDependencies", {}) or {})
                    c["dep_count"] = max(c["dep_count"], len(deps))
                    if any(
                        k in deps
                        for k in (
                            "react",
                            "vue",
                            "svelte",
                            "next",
                            "@angular/core",
                            "solid-js",
                        )
                    ):
                        c["frontend"] = True
                except Exception:
                    pass
            try:
                if os.path.getsize(os.path.join(dp, fn)) > 1_000_000:
                    c["big_files"] = True
            except Exception:
                pass
    return c


def _mcp_server_names(root):
    """MCP servers already configured: user scope (~/.claude.json) and the project .mcp.json."""
    names = set()
    for path in (os.path.expanduser("~/.claude.json"), os.path.join(root, ".mcp.json")):
        try:
            with open(path, encoding="utf-8") as fh:
                names |= set((json.load(fh).get("mcpServers") or {}))
        except (OSError, ValueError, AttributeError):
            continue
    return names


def is_installed(rule, root, servers):
    """True when the recommendation is already present, so it is not recommended again."""
    name = rule.get("installed", rule["id"])
    if rule["type"] == "cli":
        return shutil.which(name) is not None
    if rule["type"] == "note":
        return False
    return name in servers or tool_routing.plugin_enabled(name, root)


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    c = scan(root)
    servers = _mcp_server_names(root)
    recs = []
    for r in RULES:
        try:
            if r["match"](c) and not is_installed(r, root, servers):
                recs.append(
                    {
                        "id": r["id"],
                        "type": r["type"],
                        "reason": r["reason"],
                        "command": r["cmd"],
                    }
                )
        except Exception:
            pass
    print("Atlas capability recommendations:")
    print("  scanned %d files under %s" % (c["files"], os.path.abspath(root)))
    if not recs:
        print("  (no recommendations beyond the base set)")
    for r in recs:
        print("  [%-6s] %-16s - %s" % (r["type"], r["id"], r["reason"]))
        print("           install: %s" % r["command"])
    print("\nJSON:")
    print(json.dumps({"context": c, "recommendations": recs}, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
