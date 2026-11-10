"""Which harness is running a hook, and how a PreToolUse decision is spelled for it.

One detector for every hook. The rules match `atlas_analytics.detect_harness` (test_codex_parity.py
checks that they agree): ATLAS_HARNESS when it names a harness; omp markers; Codex (it sets
PLUGIN_ROOT for plugin hooks, a Codex-only variable, and puts `turn_id` in turn payloads);
Claude Code (CLAUDECODE).

Codex PreToolUse rejects permissionDecision "ask" (hook error, tool still runs) and a bare "allow"
without updatedInput. `codex_safe_decision` turns an ask into a deny that carries the same reason
plus a hint to confirm with the user and re-run. Claude Code and omp pass through unchanged.

Codex tool events use Codex's own tool names (codex-rs core/src/tools, rust-v0.166.0): the shell tool
is already `Bash` with `{"command"}`, MCP tools are `mcp__<server>__<tool>`, but file edits arrive as
`apply_patch` with `{"command": <patch text>}`, sub-agents as `spawn_agent` with `{"message",
"agent_type"}` and the plan tool as `update_plan` with `{"plan": [{"step", "status"}]}`. Codex has no
Read, Grep or Glob tool (reads go through the shell). `expand_tool_payloads` rewrites those three into
the Claude shape (Write/Edit with `file_path`, Agent with `subagent_type`/`prompt`, TodoWrite with
`todos`) so every hook keeps its Claude logic; it is the one place that knows the Codex shapes.
Stdlib only.
"""

from __future__ import annotations

import os

HARNESSES = ("claude", "omp", "codex", "unknown")

CODEX_ASK_HINT = " Codex cannot prompt from a hook: re-run after confirming with the user."


def detect_harness(payload: dict | None = None, env: dict | None = None) -> str:
    env = os.environ if env is None else env
    h = env.get("ATLAS_HARNESS")
    if h in HARNESSES:
        return h
    keys = list(env)
    if "OMPCODE" in keys or any(k.startswith(("OMP_", "PI_")) for k in keys):
        return "omp"
    if "PLUGIN_ROOT" in keys or any(k.startswith("CODEX_") for k in keys):
        return "codex"
    if isinstance(payload, dict) and "turn_id" in payload:
        return "codex"
    if "CLAUDECODE" in keys or any(k.startswith("CLAUDE_CODE_") for k in keys):
        return "claude"
    return "unknown"


def codex_safe_decision(
    decision: str, reason: str, harness: str | None = None, payload: dict | None = None
) -> tuple[str, str]:
    """(decision, reason) as the harness can honour it: ask becomes deny under codex."""
    h = harness if harness is not None else detect_harness(payload)
    if h == "codex" and decision == "ask":
        return "deny", (reason or "").rstrip() + CODEX_ASK_HINT
    return decision, reason


def codex_safe_output(doc: dict, harness: str | None = None, payload: dict | None = None) -> dict:
    """Apply `codex_safe_decision` to a finished hook-output document (mutates and returns it)."""
    spec = doc.get("hookSpecificOutput") if isinstance(doc, dict) else None
    if not isinstance(spec, dict) or spec.get("hookEventName") != "PreToolUse":
        return doc
    h = harness if harness is not None else detect_harness(payload)
    if h != "codex":
        return doc
    d = spec.get("permissionDecision")
    if d == "ask":
        spec["permissionDecision"], spec["permissionDecisionReason"] = codex_safe_decision(
            "ask", spec.get("permissionDecisionReason") or "", h
        )
        spec.pop("updatedInput", None)
    elif d == "allow" and "updatedInput" not in spec:
        spec.pop("permissionDecision", None)
        spec.pop("permissionDecisionReason", None)
    return doc


# --- Codex tool payload normalization -------------------------------------------------------------

CODEX_TOOLS = frozenset({"apply_patch", "spawn_agent", "update_plan"})
MAX_PATCH_FILES = 20
# Agents installed by atlas_codex_agents.py are named "atlas-<agent>"; the Claude name is "atlas:<agent>".
CODEX_AGENT_PREFIX = "atlas-"
from atlas_lazyre import lre  # noqa: E402
_PATCH_FILE = lre(r"^\*\*\* (Add|Update|Delete) File: (.+?)\s*$")
_PATCH_MOVE = lre(r"^\*\*\* Move to: (.+?)\s*$")


def parse_patch(patch: str) -> list[dict]:
    """Files touched by an apply_patch body: [{"op", "path", "old", "new", "content"}], in order."""
    files: list[dict] = []
    cur = None
    for line in (patch or "").splitlines():
        m = _PATCH_FILE.match(line)
        if m:
            cur = {"op": m.group(1).lower(), "path": m.group(2), "old": [], "new": [], "content": []}
            files.append(cur)
            continue
        m = _PATCH_MOVE.match(line)
        if m and cur is not None:
            cur["path"] = m.group(1)
            continue
        if line.startswith("*** ") or cur is None:
            if line.startswith(("*** End Patch", "*** Begin Patch")):
                cur = None
            continue
        if line.startswith("+"):
            cur["new"].append(line[1:])
            if cur["op"] == "add":
                cur["content"].append(line[1:])
        elif line.startswith("-"):
            cur["old"].append(line[1:])
    return files


def _abs(path: str, cwd) -> str:
    if os.path.isabs(path) or not isinstance(cwd, str) or not cwd:
        return path
    return os.path.normpath(os.path.join(cwd, path))


def _replace_tool(payload: dict, name: str, tool_input: dict) -> dict:
    out = dict(payload)
    out["tool_name"] = name
    out["tool_input"] = tool_input
    out["codex_tool_name"] = payload.get("tool_name")
    return out


def _agent_type(value) -> str:
    t = value if isinstance(value, str) else ""
    return "atlas:" + t[len(CODEX_AGENT_PREFIX):] if t.startswith(CODEX_AGENT_PREFIX) else t


def expand_tool_payloads(payload) -> list[dict]:
    """Claude-shaped payloads for one hook payload. Non-Codex tools come back as `[payload]` (the
    very object). apply_patch yields one Write (Add File) or Edit (Update/Delete File) per touched file,
    so a multi-file patch is gated file by file. Never raises."""
    if not isinstance(payload, dict):
        return [payload]
    tool = payload.get("tool_name")
    ti = payload.get("tool_input")
    if tool not in CODEX_TOOLS or not isinstance(ti, dict):
        return [payload]
    try:
        if tool == "apply_patch":
            files = parse_patch(ti.get("command") if isinstance(ti.get("command"), str) else "")
            out = []
            for f in files[:MAX_PATCH_FILES]:
                path = _abs(f["path"], payload.get("cwd"))
                if f["op"] == "add":
                    out.append(_replace_tool(payload, "Write", {"file_path": path, "content": "\n".join(f["content"])}))
                else:
                    out.append(
                        _replace_tool(
                            payload,
                            "Edit",
                            {"file_path": path, "old_string": "\n".join(f["old"]), "new_string": "\n".join(f["new"])},
                        )
                    )
            return out or [payload]
        if tool == "spawn_agent":
            prompt = ti.get("message") if isinstance(ti.get("message"), str) else ""
            if not prompt and isinstance(ti.get("items"), list):
                prompt = "\n".join(str(i.get("text", "")) for i in ti["items"] if isinstance(i, dict))
            return [
                _replace_tool(
                    payload,
                    "Agent",
                    {"subagent_type": _agent_type(ti.get("agent_type")), "prompt": prompt, "description": prompt[:80]},
                )
            ]
        plan = ti.get("plan")
        todos = [
            {"content": str(i.get("step", "")), "status": i.get("status", "pending"), "activeForm": str(i.get("step", ""))}
            for i in (plan if isinstance(plan, list) else [])
            if isinstance(i, dict)
        ]
        return [_replace_tool(payload, "TodoWrite", {"todos": todos})]
    except Exception:  # noqa: BLE001 -- a malformed Codex payload must not break the hook chain
        return [payload]


def normalize_tool_payload(payload):
    """The first Claude-shaped payload for `payload` (a multi-file patch adds the other paths as
    tool_input["files"]). For hooks that handle one file per run."""
    out = expand_tool_payloads(payload)
    first = out[0]
    if len(out) > 1:
        first = dict(first)
        first["tool_input"] = dict(first["tool_input"], files=[o["tool_input"]["file_path"] for o in out])
    return first


def was_translated(payload) -> bool:
    """True when `payload` came from `expand_tool_payloads` rewriting a Codex tool."""
    return isinstance(payload, dict) and bool(payload.get("codex_tool_name"))
