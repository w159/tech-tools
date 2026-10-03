#!/usr/bin/env python3
"""Dispatch tripwire: counts inline ops in the main session and curbs drift.

Two tiers, branched on the payload's hook_event_name:
  - PostToolUse (advisory): after an op lands, injects a STOP nag at threshold.
    This is the original behavior, unchanged.
  - PreToolUse (deny): before an op lands, and ONLY in orchestration-flagged
    sessions, DENIES the call when inline ops since the last dispatch reach the
    hard limit, when the op edits production target code inline, or when an
    atlas:* dispatch is malformed -- no code-nav TOOLS block, missing the
    bounding dispatch spec from subagent-kit.md (GOAL, DELIVERABLE, SUCCESS
    CRITERIA, OUT OF SCOPE, STOP CONDITIONS), or bundling several GOALs into a
    single subagent. The last two are what keep a dispatch small and bounded
    instead of one agent running for an hour.

Fail-open: any error exits 0. Logs to the atlas observability DB.
Disable drift tiers with ATLAS_TRIPWIRE=off; ATLAS_TRIPWIRE_HARD=off disables
denies. In docs/ projects, native Grep/Glob are denied toward ctx_search/ctx_glob
only when lean-ctx is plausibly reachable -- the binary on PATH AND a lean-ctx MCP
server configured for the project (.mcp.json, project/`~` Claude settings) --
otherwise a one-time allow-nudge, so no session is stranded without a working
search. Read/Bash receive one allow-nudge per session.
"""

import contextlib
import io
import json
import os
import re
import sys
import tempfile
import shutil

sys.path.insert(0, os.path.dirname(__file__))
from pathlib import Path  # noqa: E402

from docs_drift import find_root  # noqa: E402

INLINE_TOOLS = {"Read", "Grep", "Glob", "Edit", "Write", "Bash"}
DISPATCH_TOOLS = {"Agent", "Task"}
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# PreToolUse deny tier: the Nth UNSANCTIONED inline op with no intervening dispatch
# is denied. 6 prior ops means this call is the 7th -> deny. Sanctioned writes (the
# orchestrator's own docs/ and .atlas/ edits, which the completion gate requires at
# closeout) are excluded from the count, which is what makes a tighter limit safe.
DENY_THRESHOLD = 6
# The dispatch spec every atlas:* prompt must carry (subagent-kit.md, "The
# dispatch spec (use this shape, nothing extra)"). These five blocks are what
# bound a subagent's scope and runtime, and they are exactly what went missing
# on the dispatches that sprawled into 30-60 minute sessions: without
# DELIVERABLE/SUCCESS CRITERIA there is no finish line, without OUT OF SCOPE it
# wanders into neighbouring code, without STOP CONDITIONS it pushes through a
# blocker instead of reporting back. The skill has said this for versions; only
# a deny makes it true.
REQUIRED_SPEC_BLOCKS = (
    ("GOAL:",),
    ("DELIVERABLE:", "DELIVERABLES:"),
    ("SUCCESS CRITERIA:", "SUCCESS CRITERION:"),
    ("OUT OF SCOPE:",),
    ("STOP CONDITIONS:", "STOP CONDITION:"),
)
# Skills whose invocation means the session IS an atlas orchestration run.
# Deliberately excludes advisory/config skills (atlas-setup, atlas-validate)
# and narrow single-purpose skills (atlas-prompt, atlas-readme,
# atlas-gitignore, atlas-handoff, atlas-db-audit)
# so casual sessions never trip the completion gate.
ORCH_SKILLS = {
    "atlas-orchestrate",
    "atlas-audit",
    "atlas-ux-test",
    "atlas-loop",
    "atlas-feature",
    "atlas-debug",
    "atlas-refactor",
    "atlas-harden",
    "atlas-launch",
    "atlas-component",
    "atlas-frontend",
}


FINDINGS_RELPATH = (".atlas", ".run", "findings.json")
VERIFIER_WATCH_RELPATH = (".atlas", ".run", "verifier_watch.json")


def _is_verifier(subagent_type):
    return "verifier" in str(subagent_type or "").lower()


def _findings_count(root):
    """Number of entries in findings.json. -1 when the count is unknowable, which
    suppresses the check rather than warning on a guess."""
    if root is None:
        return -1
    try:
        data = json.loads(root.joinpath(*FINDINGS_RELPATH).read_text(encoding="utf-8"))
    except Exception:
        return 0  # missing/corrupt reads as empty: a verdict written now still counts
    items = data if isinstance(data, list) else data.get("findings", [])
    return len(items) if isinstance(items, list) else 0


def _watch_path(root):
    return root.joinpath(*VERIFIER_WATCH_RELPATH)


def _stash_findings_count(root, session):
    """PreToolUse side of the verifier-verdict check: remember how many findings
    existed before the verifier ran. ponytail: one slot per session, so N verifiers
    dispatched in parallel share a baseline -- if any one of them writes, none are
    flagged. Under-warning beats false-warning here."""
    if root is None:
        return
    try:
        path = _watch_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"session_id": session, "count": _findings_count(root)}),
            encoding="utf-8",
        )
    except Exception:
        pass  # advisory only


def _verdict_missing(root, session):
    """PostToolUse side: True when a verifier returned and findings.json did not grow."""
    if root is None:
        return False
    try:
        state = json.loads(_watch_path(root).read_text(encoding="utf-8"))
    except Exception:
        return False  # no baseline -> cannot judge -> stay silent
    if not isinstance(state, dict) or state.get("session_id") != session:
        return False
    before = state.get("count")
    if not isinstance(before, int):
        return False
    return _findings_count(root) <= before


def _in_subagent(payload):
    """True when this hook is firing inside a dispatched subagent.

    Subagent transcripts live at `<session-dir>/subagents/agent-<id>.jsonl`,
    which is the only reliable marker in the payload: a subagent's session_id
    (`agent-xxxxx`) has no run row, so nothing in the observability DB can
    answer this.
    """
    return "/subagents/" in str(payload.get("transcript_path") or "").replace("\\", "/")


def _deny_nested_dispatch(tool):
    """A subagent that dispatches its own subagent forks the work out of the
    orchestrator's view: the nested agent's dispatch is never counted, its
    verdict never reaches findings.json, and its context is invisible to the
    session that owns the task. Subagents execute; only the orchestrator
    delegates. Unconditional -- not gated on the run being flagged
    orchestrating, because a subagent session never is."""
    _deny(
        "DENY - a subagent must never dispatch another subagent. You are running "
        "inside a dispatched agent; nesting hides the work from the orchestrator "
        "that owns this task (its dispatch is uncounted, its verdict never reaches "
        "findings.json, its context is unreachable). Do the work yourself with the "
        "tools you have. If it genuinely needs another role, stop and say so in your "
        "final report -- name the role and the exact task -- and let the orchestrator "
        "dispatch it. (%s)" % tool
    )


def _threshold():
    try:
        return int(os.environ.get("ATLAS_TRIPWIRE_THRESHOLD", "4"))
    except ValueError:
        return 4


def _system_temp_roots():
    """Realpaths of the system temp dir plus the common macOS/Linux aliases
    (/tmp, /private/tmp), since /tmp is a symlink to /private/tmp on macOS and
    tempfile.gettempdir() can report either form."""
    roots = set()
    for candidate in (tempfile.gettempdir(), "/tmp", "/private/tmp"):
        try:
            roots.add(os.path.realpath(candidate).replace("\\", "/").rstrip("/"))
        except Exception:
            pass
    return roots


def _is_orchestration_path(path):
    if not path:
        return True  # unknown path -> do not punish
    norm = path.replace("\\", "/")
    if (
        norm.startswith("docs/")
        or "/docs/" in norm
        or norm.startswith(".atlas/")
        or "/.atlas/" in norm
    ):
        return True
    # Session scratch space (e.g. the Claude Code scratchpad under the system
    # temp dir) is not target code: it is ephemeral workspace outside the
    # project root, and denying writes there wastes turns for no benefit.
    try:
        real = os.path.realpath(norm).replace("\\", "/").rstrip("/")
    except Exception:
        return False
    return any(
        real == root or real.startswith(root + "/") for root in _system_temp_roots()
    )


def _deny(reason):
    # Documented PreToolUse blocking form (code.claude.com/docs/en/hooks.md):
    # exit 0 with hookSpecificOutput.permissionDecision "deny" plus a reason.
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(out))


def _toolkit_gap(tinput):
    """An atlas:* dispatch whose prompt never orders real code-nav tools.

    Measured: 3 of 12 recorded subagent runs got no TOOLS block and made 0 MCP calls,
    reading the repo through Bash grep/cat instead. Requiring ToolSearch alone was not
    enough when the batch omitted serena/lean-ctx; require both the load step and a
    named symbol/context tool so agents cannot "ToolSearch" a decoy and still grep.
    """
    agent = str(tinput.get("subagent_type") or "")
    if not agent.startswith("atlas:"):
        return None  # forks inherit the parent's loaded tools; non-atlas agents opt out
    # Docs-only roles still benefit from lean-ctx; keep the bar for all atlas:*.
    prompt = str(tinput.get("prompt") or "")
    low = prompt.lower()
    # ATLAS_TOOLKIT_LOAD=omp is set only by the omp hook bridge: omp has no ToolSearch (tools are xd:// devices),
    # so the load step cannot be asked of it. The named-navigation-tool requirement below still applies.
    has_load = "ToolSearch" in prompt or "toolsearch" in low or os.environ.get("ATLAS_TOOLKIT_LOAD") == "omp"
    has_nav = any(
        token in low
        for token in (
            "serena",
            "lean-ctx",
            "lean_ctx",
            "ctx_compose",
            "ctx_search",
            "ctx_read",
            "get_symbols_overview",
            "find_symbol",
            "activate_project",
            "replace_symbol_body",
        )
    )
    if has_load and has_nav:
        return None
    return agent


def _toolkit_gap_reason(tool, gap):
    """Deny text for a dispatch missing its code-nav TOOLS block.

    Claude wording asks for a batched ToolSearch. ATLAS_TOOLKIT_LOAD=omp (set only by the omp bridge) means the
    caller has no ToolSearch, so it is told the one-line block it can actually write instead."""
    if os.environ.get("ATLAS_TOOLKIT_LOAD") == "omp":
        return (
            "DENY - this %s dispatch is missing the code-nav TOOLS block. Add one line to the task, "
            "e.g. `TOOLS: use lean-ctx via its xd:// devices (write JSON to xd://mcp__lean_ctx_ctx_search, "
            "_ctx_read, _ctx_glob); noisy output via context-mode ctx_execute; do not activate serena "
            "unless a symbol edit needs it`. Without it %s greps the tree." % (tool, gap)
        )
    return (
        "DENY - this %s dispatch is missing the code-nav TOOLS block. "
        "Paste subagent-kit.md / tool-routing.md: one batched ToolSearch that "
        "includes lean-ctx (ctx_compose/ctx_search/ctx_read) AND serena "
        "(activate_project, get_symbols_overview, find_symbol, and for "
        "implementers replace_symbol_body), plus context-mode for noisy "
        "output. The subagent must run that before Read/Grep/Bash; serena "
        "down -> lean-ctx only, never Bash grep. Without it %s greps the tree." % (tool, gap)
    )


def _unbounded_dispatch(tinput):
    """An atlas:* dispatch with no finish line, or several tasks crammed in one.

    Two failure modes, one check. A prompt missing the bounding blocks gets a
    subagent that runs until it wanders; a prompt carrying more than one GOAL
    is a whole wave compressed into a single context, which is the opposite of
    delegation - it is the orchestrator's own sprawl moved one level down.

    Returns (agent, missing_blocks, goal_count) or None when the spec holds.
    """
    agent = str(tinput.get("subagent_type") or "")
    if not agent.startswith("atlas:"):
        return None  # forks inherit the parent's brief; non-atlas agents opt out
    prompt = str(tinput.get("prompt") or "")
    low = prompt.lower()
    missing = [
        variants[0]
        for variants in REQUIRED_SPEC_BLOCKS
        if not any(v.lower() in low for v in variants)
    ]
    # Line-anchored so a mention inside prose ("the goal:") is not a block, and
    # SUBGOAL:/STRETCH GOAL: never inflate the count.
    goals = len(re.findall(r"(?im)^[ \t]*GOAL[ \t]*:", prompt))
    if not missing and goals <= 1:
        return None
    return agent, missing, goals


# Colony protocol guards. The per-call dispatch fields below are what turn a
# one-off subagent into a colony member: `name` puts the sibling on the roster
# (SendMessage, board notes), and the definition's frontmatter `model:` fixes
# its cost/runtime tier. Both guards fire under the same gate as the toolkit
# and dispatch-spec checks above: armed-orchestration runs, atlas:* agents
# only, kill-switched by ATLAS_TRIPWIRE_HARD=off. The name requirement lifts
# under CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 (naming would make the dispatch
# a teammate, not a scoped subagent).
AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"
# Block texts run in a shell the model opens itself, where $CLAUDE_PLUGIN_ROOT is
# unset (Claude Code expands it only for the hook command line): name scripts by
# the absolute path resolved here.
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
_SAFE_AGENT_NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")


def _frontmatter_model(agent):
    """The `model:` value pinned in an atlas agent definition.

    Returns None when the file cannot be read or the agent name is not a plain
    identifier -- the caller fails open on those. Returns "" when the file has
    no frontmatter `model:` (nothing pinned, accept any), and "inherit" when it
    says so (accept any by design).
    """
    if not _SAFE_AGENT_NAME.match(agent or ""):
        return None
    try:
        text = (AGENTS_DIR / ("%s.md" % agent)).read_text(encoding="utf-8")
    except Exception:
        return None
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return ""  # no frontmatter -> nothing pinned
    for line in lines[1:]:
        stripped = line.strip()
        if stripped == "---":
            break
        if stripped.startswith("model:"):
            return stripped[len("model:"):].strip().strip("'\"")
    return ""


def _name_missing(tinput):
    """An atlas:* dispatch with no non-empty `name`: the colony channel is
    unreachable for that worker, so its siblings cannot message it and the
    board cannot address notes to it. Returns the agent name or None.

    Skipped while `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`: with agent teams
    enabled, a named dispatch launched from the main conversation becomes a
    teammate (inherits the lead's effort, runs in the lead's cwd) instead of
    a scoped subagent (code.claude.com/docs/en/sub-agents, "Subagent
    names"), and an atlas worker must stay a subagent so its definition's
    effort/model tier and tool guardrails apply."""
    agent = str(tinput.get("subagent_type") or "")
    if not agent.startswith("atlas:"):
        return None
    if os.environ.get("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS") == "1":
        return None
    if str(tinput.get("name") or "").strip():
        return None
    return agent


def _model_override(tinput):
    """An atlas:* dispatch whose per-call `model` differs from the definition's
    frontmatter `model:`. Per-role tiers are set once per colony; a per-call
    override drifts them silently. Returns (agent, declared, given), or None
    when the definition accepts any model (frontmatter missing, `inherit`),
    when the dispatch passes no `model`, when the values match
    case-insensitively, or when the definition cannot be read (fail open)."""
    agent = str(tinput.get("subagent_type") or "")
    if not agent.startswith("atlas:"):
        return None
    given = str(tinput.get("model") or "").strip()
    if not given:
        return None
    declared = _frontmatter_model(agent[len("atlas:"):])
    if not declared or declared.lower() == "inherit":
        return None  # unpinned, inherit, or unreadable -> fail open
    if given.lower() == declared.lower():
        return None
    return agent, declared, given


def _pre_tool_use(conn, atlas_db, tool, session, path, tinput=None):
    """Deny tier: fires before the op lands, orchestration-flagged sessions only."""
    # The deny tier is independently kill-switchable; the advisory tier persists.
    if os.environ.get("ATLAS_TRIPWIRE_HARD", "on").lower() == "off":
        return
    run_id = atlas_db.current_run_id(conn, session)
    if run_id is None:
        return  # no active run -> nothing to gate
    if not atlas_db.is_orchestrating(conn, session):
        return  # non-orchestration sessions are NEVER denied anything
    if tool in DISPATCH_TOOLS:
        # (c0) A dispatch with no sibling name never joins the colony: without
        # a name it is absent from the sibling roster (no SendMessage in, no
        # addressed board notes) and its report is unattributable.
        unnamed = _name_missing(tinput or {})
        if unnamed:
            _deny(
                "DENY - this %s dispatch to %s carries no `name`. Named dispatches "
                "are the colony: only a named sibling appears on the sibling roster "
                "and can SendMessage the others, its report stays attributable, and "
                "board notes can be addressed to it. Re-dispatch with "
                "name: <role>-<slice> (e.g. auth-explorer)." % (tool, unnamed)
            )
            return
        # (c1) A per-call model override drifts the colony's cost/runtime tier.
        override = _model_override(tinput or {})
        if override:
            over_agent, declared, given = override
            _deny(
                "DENY - this %s dispatch to %s overrides model with '%s'. The agent "
                "definition pins model: %s; per-role models are the colony's "
                "cost/runtime contract and a per-call override drifts it quietly. "
                "Drop the `model` param and re-dispatch. Wrong tier for the job? "
                "Fix the definition, not the dispatch." % (tool, over_agent, given, declared)
            )
            return
        # (c) A dispatch that never names the toolset gets a subagent that greps.
        gap = _toolkit_gap(tinput or {})
        if gap:
            _deny(_toolkit_gap_reason(tool, gap))
            return
        unbounded = _unbounded_dispatch(tinput or {})
        if unbounded:
            agent, missing, goals = unbounded
            if goals > 1:
                _deny(
                    "DENY - this %s dispatch carries %d GOAL: blocks. One dispatch is "
                    "ONE bounded task - that is what keeps a subagent's context small "
                    "and its runtime short. Split it into %d dispatches, each with its "
                    "own GOAL, DELIVERABLE, and SUCCESS CRITERIA; independent ones can "
                    "run in the same parallel wave." % (tool, goals, goals)
                )
            else:
                _deny(
                    "DENY - this %s dispatch to %s is unbounded: missing %s. A subagent "
                    "with no finish line runs until it wanders. Paste the dispatch spec "
                    "from subagent-kit.md: GOAL (one measurable sentence), DELIVERABLE "
                    "(the exact artifact), SUCCESS CRITERIA (independently checkable, "
                    "each with its evidence), OUT OF SCOPE (what not to touch), STOP "
                    "CONDITIONS (when to halt and report back rather than push "
                    "through)." % (tool, agent, ", ".join(missing))
                )
        return
    # (b) Editing production target code inline is the sharpest violation.
    if tool in EDIT_TOOLS and not _is_orchestration_path(path):
        _deny(
            "DENY - atlas orchestrators never edit target code inline. "
            "Route this %s of %s to atlas:implementer." % (tool, path)
        )
        return
    # (a) Too many inline ops with no intervening dispatch.
    # Fail CLOSED on DB error: an unverified count must never let an inline
    # op past the hard limit mid-orchestration. The broad __main__ fail-open
    # covers garbage stdin / connect failures, not this trust decision.
    try:
        count = atlas_db.unsanctioned_inline_ops_since_last_dispatch(conn, run_id)
    except Exception:
        _deny(
            "DENY - tripwire could not verify the inline-op count (DB error). "
            "Failing closed; dispatch the next step to atlas:explorer "
            "(investigation) or atlas:implementer (edits) instead of acting inline."
        )
        return
    if count >= DENY_THRESHOLD:
        _deny(
            "DENY - %d inline ops since your last dispatch. Orchestrators delegate: "
            "the work happens in subagents so this session's context stays clean. "
            "Dispatch the next step to atlas:explorer (investigation) or "
            "atlas:implementer (edits). Right-size it - one bounded change is ONE "
            "implementer dispatch, not a squad. (Your own docs/ and .atlas/ writes "
            "are not counted here; only unsanctioned inline work is.)" % count
        )


def _arm_orchestrating(conn, atlas_db, session, cwd):
    """Flag the run as orchestration; on DB failure record one friction row so
    the silent miss is observable, then fall through fail-open. The friction
    write is itself guarded: a doubly failing DB must not raise out of the
    hook (the outer main try would abort the rest of the tool's processing)."""
    try:
        atlas_db.mark_orchestrating(conn, session, cwd)
    except Exception:
        try:
            conn.rollback()
            atlas_db.record_friction(
                conn,
                session,
                "orchestration_flag_arm_failed",
                snippet="mark_orchestrating raised; run not flagged",
            )
        except Exception:
            pass


LEAN_CTX_TOKENS = ("lean-ctx", "lean_ctx")


def _read_json(path):
    """Unreadable/invalid config is 'no data': the availability gate must fail
    open to the nudge, never deny, on a file it could not parse."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _lean_hits(servers):
    """Server keys (dict) or enabled names (list) that look like lean-ctx:
    the key, or a dict spec's command, containing 'lean-ctx' or 'lean_ctx'."""
    try:
        if isinstance(servers, dict):
            return [
                key
                for key, spec in servers.items()
                if any(
                    token in "%s %s" % (key, spec.get("command", "") if isinstance(spec, dict) else "")
                    for token in LEAN_CTX_TOKENS
                )
            ]
        if isinstance(servers, list):
            return [
                name
                for name in servers
                if isinstance(name, str) and any(token in name for token in LEAN_CTX_TOKENS)
            ]
    except Exception:
        pass
    return []


def _lean_ctx_server_key(root):
    """First MCP server key that looks like lean-ctx, checked in the documented
    precedence: <project>/.mcp.json; <project>/.claude/settings*.json
    (mcpServers, then enabledMcpjsonServers); ~/.claude.json (top-level
    mcpServers, then projects[<root>].mcpServers); ~/.claude/settings.json.
    The key is what the deny text turns into the ToolSearch selector.
    None means lean-ctx MCP is not plausibly configured for this project, so
    the Grep/Glob deny must downgrade to the one-time nudge. Unreadable config
    fails open: None, never an exception."""
    home = Path.home()
    try:
        # (1) <project>/.mcp.json
        mcp = _read_json(root / ".mcp.json")
        hits = _lean_hits((mcp or {}).get("mcpServers"))
        if hits:
            return hits[0]
        # (2) <project>/.claude/settings*.json
        try:
            settings = sorted((root / ".claude").glob("settings*.json"))
        except Exception:
            settings = []
        for settings_path in settings:
            data = _read_json(settings_path)
            if not data:
                continue
            hits = _lean_hits(data.get("mcpServers"))
            if hits:
                return hits[0]
            hits = _lean_hits(data.get("enabledMcpjsonServers"))
            if hits:
                return hits[0]
        # (3) ~/.claude.json: top-level mcpServers, then projects[<root>]
        claude_json = _read_json(home / ".claude.json")
        if claude_json:
            hits = _lean_hits(claude_json.get("mcpServers"))
            if hits:
                return hits[0]
            projects = claude_json.get("projects")
            if isinstance(projects, dict):
                project = projects.get(str(root))
                if isinstance(project, dict):
                    hits = _lean_hits(project.get("mcpServers"))
                    if hits:
                        return hits[0]
        # (4) ~/.claude/settings.json
        home_settings = _read_json(home / ".claude" / "settings.json")
        if home_settings:
            hits = _lean_hits(home_settings.get("mcpServers"))
            if hits:
                return hits[0]
            hits = _lean_hits(home_settings.get("enabledMcpjsonServers"))
            if hits:
                return hits[0]
    except Exception:
        pass  # fail open: unknown availability must nudge, never deny
    return None


NATIVE_TOOLS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "contracts", "native-tools.json"
)


def _native_tool_contract():
    """{claude tool name: (mode, primary replacement)} from contracts/native-tools.json.

    Shared with omp/contracts.ts. Unreadable or malformed -> {} so every native
    call is allowed silently (fail open)."""
    try:
        with open(NATIVE_TOOLS_PATH) as fh:
            kinds = json.load(fh)["kinds"]
        return {
            spec["claude"]: (spec["mode"], spec["replacements"][0]["tool"])
            for spec in kinds.values()
        }
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError):
        return {}


# Twin of omp/contracts.ts explorationSegments/EXPLORATION_TOOL: same split
# regex, same token rules, same ctx_* mapping. Both iterate
# contracts/native-tools.json explorationShell.cases.
_WRITE_TOKENS = frozenset(("tee", "-delete", "-exec", "-execdir"))
_EXPLORATION_TOOL = {
    "cat": "ctx_read", "head": "ctx_read", "tail": "ctx_read",
    "grep": "ctx_search", "rg": "ctx_search", "ag": "ctx_search",
    "ls": "ctx_tree", "tree": "ctx_tree",
    "find": "ctx_glob", "fd": "ctx_glob",
}
_SEGMENT_SPLIT = re.compile(r"&&|\|\||[;|\n]")
# Redirections that write nothing: fd duplications (`2>&1`, `1>&2`) and redirects
# to exactly /dev/null (`>/dev/null`, `2>/dev/null`, `&>/dev/null`, `>>/dev/null`).
# Stripped before the "any `>` is a write" check; whatever `>` is left
# (`> out.txt`, `2>err.log`, `2>1`, `> /dev/nullx`) still counts as a write.
# Twin: omp/contracts.ts HARMLESS_REDIRECT.
_HARMLESS_REDIRECT = re.compile(r"\d*>&\d+|(?:\d*|&)>>?\s*/dev/null(?![\w./-])")


def _exploration_segments(command):
    """[[command-basename, *args], ...] when `command` is exploration-only, else
    None. Splits the RAW text, so quoted operators (`grep 'a && b'`) over-split
    and every such misparse lands on 'not exploration' - the allow direction.
    Missing/malformed contract section -> None (fail open)."""
    if not isinstance(command, str):
        return None
    command = _HARMLESS_REDIRECT.sub(" ", command)
    if ">" in command:
        return None
    try:
        with open(NATIVE_TOOLS_PATH) as fh:
            commands = json.load(fh)["explorationShell"]["commands"]
        if not isinstance(commands, list) or not all(isinstance(c, str) for c in commands):
            return None
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None
    segments = [s.split() for s in _SEGMENT_SPLIT.split(command)]
    segments = [s for s in segments if s]
    while segments and segments[0][0] == "cd":
        segments.pop(0)
    if not segments:
        return None
    for tokens in segments:
        name = tokens[0].rsplit("/", 1)[-1]
        if any(t in _WRITE_TOKENS for t in tokens):
            return None
        in_place = any(t.startswith("-i") for t in tokens[1:])
        if name == "sed":
            ok = len(tokens) > 1 and tokens[1].startswith("-n") and not in_place
        elif name == "awk":
            ok = not in_place
        else:
            ok = name in commands
        if not ok:
            return None
        tokens[0] = name
    return segments


def _is_exploration_shell(command):
    """True when a Bash command only reads/inspects (see omp isExplorationShell)."""
    return _exploration_segments(command) is not None


def _exploration_deny(command, server):
    """Deny text for an exploration-only Bash command, or None. The ctx_* tool is
    ctx_read (cat/head/tail), ctx_search (grep/rg/ag), ctx_tree (ls/tree),
    ctx_glob (find/fd), else ctx_shell; mixed pipelines -> ctx_shell."""
    segments = _exploration_segments(command)
    if segments is None:
        return None
    tools = {_EXPLORATION_TOOL.get(t[0], "ctx_shell") for t in segments}
    tool = tools.pop() if len(tools) == 1 else "ctx_shell"
    return (
        f"DENY - this Bash command only reads files, so use lean-ctx `{tool}` instead. "
        f'lean-ctx MCP (server "{server}") is configured for this project: if `{tool}` is '
        f'not in your tool list yet, load it first with ToolSearch("select:mcp__{server}__{tool}"), '
        "then call it. Native Bash stays available for tests, git, builds and anything that writes."
    )


def _native_tool_policy(payload):
    """Docs-scoped native-call policy. Returns (handled, nudge).

    handled=True means a deny was emitted and the caller must stop. Otherwise
    the call is allowed and the caller continues into the legacy tiers, so an
    armed orchestrator's inline-op threshold deny still applies to Read/Bash/
    Grep/Glob; `nudge` (or None) is printed only if no later tier denies.
    Errors allow with no output."""
    # ATLAS_NATIVE_POLICY=off is set only by the omp hook bridge: omp/index.ts already
    # denies/nudges native Read/Grep/Glob/Bash itself, and a deny here would return from
    # main() before the inline-op threshold below is evaluated. Unset = Claude Code.
    native_off = os.environ.get("ATLAS_NATIVE_POLICY", "on").lower() == "off"
    if payload.get("hook_event_name") != "PreToolUse" or native_off:
        return False, None
    tool = payload.get("tool_name")
    contract = _native_tool_contract()
    if tool not in contract:
        return False, None
    mode, replacement = contract[tool]
    try:
        root = find_root(Path(payload.get("cwd") or os.getcwd()))
        if root is None or not (root / "docs").is_dir():
            return False, None
        if mode == "deny":
            if os.environ.get("ATLAS_TRIPWIRE_HARD", "on").lower() == "off":
                return False, None  # allow; deny tiers are off too
            server = _lean_ctx_server_key(root)
            if shutil.which("lean-ctx") and server:
                selector = "mcp__%s__%s" % (server, replacement)
                _deny(
                    f"DENY - native {tool} is disabled in docs/ projects. lean-ctx MCP "
                    f'(server "{server}") is configured for this project, so the '
                    f"replacement is reachable even from a subagent: if `{replacement}` "
                    f"is not in your tool list yet, load it first with "
                    f'ToolSearch("select:{selector}"), then call `{replacement}` '
                    "(1:1 replacement)."
                )
                return True, None
            # Not plausibly reachable: no lean-ctx binary on PATH, or no lean-ctx
            # MCP server configured for this project (unreadable config counts as
            # not configured - fail open). Denying here would strand the caller,
            # so fall through to the one-time allow-nudge below.
        if tool == "Bash" and os.environ.get("ATLAS_TRIPWIRE_HARD", "on").lower() != "off":
            # A Claude PreToolUse hook cannot see the callable tool set, so
            # reachability is the same plausibility heuristic as Grep/Glob:
            # lean-ctx binary on PATH AND an MCP server configured here.
            server = _lean_ctx_server_key(root) if shutil.which("lean-ctx") else None
            tinput = payload.get("tool_input")
            reason = server and _exploration_deny(
                tinput.get("command") if isinstance(tinput, dict) else None, server
            )
            if reason:
                _deny(reason)
                return True, None
        session = str(payload.get("session_id") or "")
        if not session:
            return False, None
        # Separate exclusive markers avoid shared read-modify-write races.
        import hashlib

        key = hashlib.sha256(session.encode()).hexdigest()
        marker = root / ".atlas" / ".run" / "native_nudges" / f"{key}-{tool}"
        if marker.exists():
            return False, None
        message = {
            "Read": (
                "[atlas] Use lean-ctx `ctx_read` for exploration; native Read is still "
                "fine right before an Edit."
            ),
            "Bash": (
                "[atlas] Use lean-ctx `ctx_shell` / context-mode `ctx_execute` for "
                "anything that produces output over ~20 lines; native Bash remains "
                "available for mutations and short fixed output."
            ),
            "Grep": (
                "[atlas] lean-ctx MCP is not configured for this project (no "
                "`lean-ctx` server in .mcp.json / Claude settings, or the binary is "
                "off PATH), so native Grep is allowed here; prefer `ctx_search` on "
                "projects where lean-ctx MCP is configured."
            ),
            "Glob": (
                "[atlas] lean-ctx MCP is not configured for this project (no "
                "`lean-ctx` server in .mcp.json / Claude settings, or the binary is "
                "off PATH), so native Glob is allowed here; prefer `ctx_glob` on "
                "projects where lean-ctx MCP is configured."
            ),
        }[tool]
        return False, (marker, message)
    except Exception:
        return False, None  # policy failure must never turn into a deny


def _emit_nudge(nudge):
    """Print the native-tool allow-nudge once per session/tool.

    The once-marker is claimed HERE, not in the policy: a nudge that a later
    deny tier replaced must still be shown on that tool's next allowed call."""
    if not nudge:
        return
    marker, message = nudge
    with contextlib.suppress(Exception):  # marker unwritable: show anyway
        marker.parent.mkdir(parents=True, exist_ok=True)
        try:
            with marker.open("x", encoding="utf-8"):
                pass
        except FileExistsError:
            return  # a concurrent call already showed it
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "additionalContext": message,
    }}))


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw)  # may raise -> caught below

    # Nesting deny comes FIRST: before the drift kill-switch and before any DB
    # work. ATLAS_TRIPWIRE=off silences inline-drift coaching, which is a matter
    # of taste; subagent nesting is a structural invariant and is not opt-out.
    # It must also precede any DB call, because a subagent's session_id has no
    # run row and everything downstream of current_run_id() returns early.
    if (
        payload.get("hook_event_name") == "PreToolUse"
        and payload.get("tool_name") in DISPATCH_TOOLS
        and _in_subagent(payload)
    ):
        _deny_nested_dispatch(payload.get("tool_name"))
        return
    handled, nudge = _native_tool_policy(payload)
    if handled:
        return

    if os.environ.get("ATLAS_TRIPWIRE", "on").lower() == "off":
        _emit_nudge(nudge)
        return

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import atlas_db

    # Default missing event to PostToolUse so legacy payloads keep advisory behavior.
    event = payload.get("hook_event_name", "PostToolUse")
    tool = payload.get("tool_name", "")
    tinput = payload.get("tool_input", {}) or {}
    session = payload.get("session_id", "")
    path = tinput.get("file_path") or tinput.get("path") or tinput.get("notebook_path")

    # Verifier-verdict check. Runs outside the orchestration gate on purpose: the
    # very first atlas: dispatch of a session is what FLAGS it as orchestrating,
    # so gating the baseline on that flag would always miss dispatch #1.
    if tool in DISPATCH_TOOLS and _is_verifier(tinput.get("subagent_type")):
        root = find_root(Path(payload.get("cwd") or os.getcwd()))
        if event == "PreToolUse":
            _stash_findings_count(root, session)
        elif _verdict_missing(root, session):
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "PostToolUse",
                            "additionalContext": (
                                "[atlas] verifier verdict not in findings.json - record it "
                                "yourself (do not re-dispatch):\n"
                                f'  python3 "{SCRIPTS_DIR / "atlas_finding.py"}" '
                                "--id <stage> --status "
                                "verified|rejected|needs-evidence --evidence "
                                "'<path or test id>' --reproduction '<command>'"
                            ),
                        }
                    }
                )
            )
            # No early return: the dispatch still needs to reach the DB below.

    conn = None
    try:
        try:
            conn = atlas_db.connect()
            atlas_db.init(conn)
        except Exception:
            _emit_nudge(nudge)  # DB down: the allowed call still gets its nudge
            raise

        if event == "PreToolUse":
            # The deny tier polices the ORCHESTRATOR's own inline drift; a
            # subagent's Read/Edit/Write IS the delegated work, not drift.
            # A subagent's payload can carry the parent's session_id, so
            # is_orchestrating() alone cannot tell them apart -- transcript_path
            # (checked by _in_subagent) is the reliable marker. Nested
            # dispatches are already denied above, before this point.
            if not _in_subagent(payload):
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    _pre_tool_use(conn, atlas_db, tool, session, path, tinput)
                if buf.getvalue():
                    sys.stdout.write(buf.getvalue())  # a deny wins; drop the nudge
                    return
            _emit_nudge(nudge)
            return

        if tool == "Skill":
            # Invoking an orchestration skill flags the run deterministically -
            # nothing else guarantees the model runs `atlas_db.py mark-orchestrating`.
            skill = str(tinput.get("skill", "")).split(":")[-1]
            if skill in ORCH_SKILLS:
                _arm_orchestrating(conn, atlas_db, session, payload.get("cwd"))
            return

        if tool in DISPATCH_TOOLS:
            # Dispatches may arrive after the run is finalized; use the fallback
            # resolver so late Agent/Task PostToolUse events are still logged.
            dispatch_run_id = atlas_db.current_or_last_run_id(conn, session)
            if dispatch_run_id is not None:
                atlas_db.log_dispatch(
                    conn, dispatch_run_id, tinput.get("subagent_type", tool)
                )
            agent_type = str(tinput.get("subagent_type", ""))
            if agent_type.startswith(("atlas:", "atlas-")):
                # Dispatching an atlas squad agent is unambiguous orchestration.
                _arm_orchestrating(conn, atlas_db, session, payload.get("cwd"))
            if str(tinput.get("isolation", "")).strip() == "worktree":
                # An isolated writer leaves a tree behind once it has changes.
                # Recording it here is what lets the completion gate demand
                # close-out without firing on the user's own worktrees.
                atlas_db.mark_used_worktrees(conn, session)
            return

        run_id = atlas_db.current_run_id(conn, session)
        if run_id is None:
            return  # no active run for inline ops; boot hook will create one

        if tool not in INLINE_TOOLS:
            return

        atlas_db.log_event(conn, run_id, tool, "main", 1, path)
        count = atlas_db.inline_ops_since_last_dispatch(conn, run_id)

        edit_to_target = tool in EDIT_TOOLS and not _is_orchestration_path(path)
        if count >= _threshold() or edit_to_target:
            if not atlas_db.is_orchestrating(conn, session):
                return  # WS1: non-orchestration sessions are logged but never nagged
            if edit_to_target:
                msg = "STOP - route this %s of %s to atlas:implementer." % (tool, path)
            else:
                msg = (
                    "STOP - %d inline ops, no dispatch. Route the next step to "
                    "atlas:explorer / atlas:implementer." % count
                )
            out = {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": msg,
                }
            }
            print(json.dumps(out))
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # fail-open: never block a session. But surface the failure on stderr
        # so a silent misfire is observable instead of invisible, matching
        # auto_skill/memory_capture.
        try:
            sys.stderr.write(f"[atlas] dispatch_tripwire fail-open: {exc}\n")
        except Exception:
            pass
    sys.exit(0)
