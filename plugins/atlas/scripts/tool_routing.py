#!/usr/bin/env python3
"""Atlas tool-routing helpers: stack signals + compact boot lines.

The full matrix lives in skills/atlas-orchestrate/references/tool-routing.md.
This module only emits short, load-bearing lines for session_boot and discovery
so boot context stays tiny while still forcing serena/lean-ctx/claude-mem usage
instead of Bash grep/cat bloat.

Stdlib only. Fail-open callers should catch exceptions.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

# One batched ToolSearch paste for dispatch specs / agent first actions.
# Unmatched names are skipped by ToolSearch, so missing servers cost nothing.
TOOLSEARCH_BATCH = (
    'ToolSearch("select:'
    "mcp__lean-ctx__ctx_compose,"
    "mcp__lean-ctx__ctx_search,"
    "mcp__lean-ctx__ctx_read,"
    "mcp__lean-ctx__ctx_glob,"
    "mcp__lean-ctx__ctx_tree,"
    "mcp__lean-ctx__ctx_callgraph,"
    "mcp__serena__activate_project,"
    "mcp__serena__get_symbols_overview,"
    "mcp__serena__find_symbol,"
    "mcp__serena__find_referencing_symbols,"
    "mcp__serena__find_declaration,"
    "mcp__serena__find_implementations,"
    "mcp__serena__replace_symbol_body,"
    "mcp__serena__insert_after_symbol,"
    "mcp__serena__get_diagnostics_for_file,"
    "mcp__plugin_context-mode_context-mode__ctx_batch_execute,"
    "mcp__plugin_context-mode_context-mode__ctx_execute,"
    "mcp__plugin_claude-mem_mcp-search__search,"
    "mcp__plugin_claude-mem_mcp-search__timeline,"
    "mcp__plugin_claude-mem_mcp-search__get_observations"
    '")'
)

_SKIP = {
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
    "target",
    "vendor",
}

_CODE_EXTS = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "typescript",
    ".jsx": "typescript",
    ".mjs": "typescript",
    ".cjs": "typescript",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".kt": "kotlin",
    ".swift": "swift",
    ".cpp": "cpp",
    ".c": "c",
}


def scan_stack(root: str | Path, budget: int = 4000) -> dict:
    """Cheap stack signals for routing. Never walks deep vendor trees."""
    root = os.path.abspath(str(root))
    out = {
        "root": root,
        "has_code": False,
        "js_ts": False,
        "python": False,
        "languages": [],
        "has_package_json": False,
        "has_pyproject": False,
        "serena_yml": False,
        "serena_languages_ok": False,
        "docs": False,
    }
    counts: dict[str, int] = {}
    seen = 0
    try:
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if d not in _SKIP and not d.startswith(".venv")]
            rel = os.path.relpath(dp, root)
            if rel == "docs" or rel.startswith("docs" + os.sep):
                out["docs"] = True
            for fn in fns:
                seen += 1
                low = fn.lower()
                path = os.path.join(dp, fn)
                if fn == "package.json":
                    out["has_package_json"] = True
                    out["js_ts"] = True
                    out["has_code"] = True
                if fn in ("pyproject.toml", "setup.py", "requirements.txt"):
                    out["has_pyproject"] = True
                    out["python"] = True
                    out["has_code"] = True
                if rel in (".serena",) or dp.rstrip(os.sep).endswith(os.sep + ".serena"):
                    if low in ("project.yml", "project.yaml"):
                        out["serena_yml"] = True
                        try:
                            text = Path(path).read_text(encoding="utf-8")
                            out["serena_languages_ok"] = any(
                                line.startswith("languages:") for line in text.splitlines()
                            )
                        except Exception:
                            pass
                ext = os.path.splitext(fn)[1].lower()
                lang = _CODE_EXTS.get(ext)
                if lang:
                    out["has_code"] = True
                    counts[lang] = counts.get(lang, 0) + 1
                    if lang == "typescript":
                        out["js_ts"] = True
                    if lang == "python":
                        out["python"] = True
            if seen >= budget:
                break
    except Exception:
        pass
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    out["languages"] = [name for name, _ in ranked[:5]]
    if not out["serena_yml"]:
        # also check canonical path without walk hit
        yml = os.path.join(root, ".serena", "project.yml")
        if os.path.isfile(yml):
            out["serena_yml"] = True
            try:
                text = Path(yml).read_text(encoding="utf-8")
                out["serena_languages_ok"] = any(
                    line.startswith("languages:") for line in text.splitlines()
                )
            except Exception:
                pass
    out["docs"] = out["docs"] or os.path.isdir(os.path.join(root, "docs"))
    return out


def boot_lines(stack: dict | None = None, root: str | None = None) -> list[str]:
    """3-6 compact lines for SessionStart additionalContext. No essay."""
    if stack is None:
        stack = scan_stack(root or os.getcwd())
    lines = [
        "Tool routing (min context): code symbols/edits -> serena "
        "(activate_project on cwd FIRST, then get_symbols_overview/find_symbol/"
        "replace_symbol_body); tree orient/search -> lean-ctx ctx_compose/ctx_search/"
        "ctx_read; output >~20 lines -> context-mode ctx_batch_execute; "
        "prior lessons -> claude-mem search then timeline then get_observations "
        "(ids as numbers); never Bash grep/cat/sed as first code read.",
    ]
    if stack.get("has_code"):
        langs = ",".join(stack.get("languages") or []) or "code"
        lines.append(
            "Code stack (%s): load ToolSearch batch once before Read/Grep/Bash; "
            "serena down -> lean-ctx only, still no Bash file reads. "
            "Matrix: atlas-orchestrate/references/tool-routing.md"
            % langs
        )
        if not stack.get("serena_yml"):
            lines.append(
                "serena: no .serena/project.yml - after MCP is connected, "
                "activate_project(cwd) then onboarding if needed; atlas-setup install covers this."
            )
        elif not stack.get("serena_languages_ok"):
            lines.append(
                "serena: project.yml missing top-level languages: key - session_boot heals this; "
                "then activate_project before symbol calls."
            )
        else:
            lines.append(
                "serena: project.yml present - call activate_project on this cwd before symbol work."
            )
    if stack.get("js_ts"):
        lines.append(
            "JS/TS: fallow for dead-code/dupes/health/audit (CLI or fallow-mcp); "
            "agent git commit/push still gated by fallow_gate when CLI present."
        )
    return lines


def discovery_rules() -> list[dict]:
    """Extra discover_capabilities RULES entries (callables filled by importer)."""
    return [
        {
            "id": "serena",
            "type": "mcp",
            "reason": "Codebase symbol intelligence: activate_project, overview, find, "
            "referencing, surgical edits. Primary code nav; never start with Grep.",
            "cmd": "claude mcp add serena -- <your serena launcher; see serena docs>",
            "match_key": "has_code",
        },
        {
            "id": "lean-ctx",
            "type": "mcp",
            "reason": "Context-shaped reads: ctx_compose/ctx_search/ctx_read keep raw "
            "bytes out of the window. Fallback when serena is down; first choice for prose/config.",
            "cmd": "claude mcp add lean-ctx -- <lean-ctx launcher>",
            "match_key": "has_code",
        },
    ]


def main() -> int:
    import sys

    root = sys.argv[1] if len(sys.argv) > 1 else "."
    stack = scan_stack(root)
    print(json.dumps({"stack": stack, "boot_lines": boot_lines(stack), "toolsearch": TOOLSEARCH_BATCH}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
