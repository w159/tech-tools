#!/usr/bin/env python3
"""Atlas capability discovery. Strictly read-only.

Scans a project for stack signals and emits ranked recommendations (skills,
plugins, MCP servers) with reasons and exact install commands. Never installs
anything. Prints a human table and a JSON block. Exits 0 always.
"""

import json
import os
import sys

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
        "cmd": "claude mcp add microsoft-docs -- npx -y @microsoft/mcp-docs",
        "match": lambda c: c["microsoft"],
    },
    {
        "id": "iac-skill",
        "type": "skill",
        "reason": "Terraform/IaC files found; infra-aware review and generation.",
        "cmd": "claude plugin install <iac-skill>",
        "match": lambda c: c["terraform"],
    },
    {
        "id": "container-tooling",
        "type": "skill",
        "reason": "Dockerfiles or k8s manifests found; container build/deploy awareness.",
        "cmd": "claude plugin install <container-skill>",
        "match": lambda c: c["containers"],
    },
    {
        "id": "ponytail",
        "type": "plugin",
        "reason": "Lazy-senior-dev mode; ~54% less code while keeping safety. Session-augmentation tier.",
        "cmd": "copilot plugin marketplace add DietrichGebert/ponytail && copilot plugin install ponytail@ponytail",
        "match": lambda c: True,
    },
    {
        "id": "loop-library (atlas-chronos)",
        "type": "note",
        "reason": "Built-in curated loops; use the atlas-chronos skill.",
        "cmd": "(already shipped with atlas)",
        "match": lambda c: True,
    },
    {
        "id": "connectors (atlas-hermes)",
        "type": "note",
        "reason": "Vendor MCP connectors live in the domain plugins (it-operations, "
        "security-compliance, microsoft-365, hr-payroll), disabled by default; use "
        "atlas-hermes as the cross-plugin setup guide.",
        "cmd": "(already shipped with atlas)",
        "match": lambda c: c["has_mcp_servers"],
    },
]

SKIP_DIRS = {
    ".git",
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
            if fn == "package.json":
                try:
                    pkg = json.load(open(os.path.join(dp, fn)))
                    deps = {}
                    deps.update(pkg.get("dependencies", {}))
                    deps.update(pkg.get("devDependencies", {}))
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


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    c = scan(root)
    recs = []
    for r in RULES:
        try:
            if r["match"](c):
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
