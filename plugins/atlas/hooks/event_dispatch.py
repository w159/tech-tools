#!/usr/bin/env python3
"""One process per tool event: run atlas's PreToolUse / PostToolUse Python hooks in-process.

    event_dispatch.py PreToolUse|PostToolUse     (hook payload JSON on stdin)

Every hook used to be its own interpreter (an Edit spawned eight, ~12-19 ms of cold start each, plus
imports). This runner feeds the one stdin payload to each applicable hook's main() in the order
hooks.json used to list them, applies each hook's ORIGINAL matcher internally (BINDINGS is that
table), and merges what they printed into the single JSON document Claude Code reads.

Merge rules (Claude Code hook protocol):
  * PreToolUse permissionDecision: deny beats ask beats allow. The first deny's reason is the
    reason; later denies' reasons and every hook's additionalContext ride along as context.
  * additionalContext from all hooks is concatenated in binding order, blank-line separated.
  * updatedInput (only dispatch_tripwire emits it) is kept unless a deny wins.
  * A hook exiting 2 blocks: the dispatcher exits 2 with those hooks' stderr (stdout dropped, as
    Claude Code ignores JSON on exit 2). Any other exit code is a clean exit 0.
  * One hook's stdout is passed through unchanged; stderr is concatenated.

Fail-open: a raise, SystemExit, bad output or timeout in one hook records a fault row and never
stops the next. Each hook runs under a bounded SIGALRM slice (SLICES) inside an overall BUDGET_S
(stop_tail's approach); platforms without SIGALRM run unbounded.

Not folded in, on purpose (each stays its own hooks.json process):
  fallow_gate        runs `fallow audit` subprocesses for up to ~95 s (300 s timeout) on commit/push
  format_after_edit  async by design: the formatter must not block the edit
Under ATLAS_HARNESS=omp, recall_gate and todo_capture are skipped: omp implements both natively
(contracts/hook-bridge.json notBridged).

Telemetry (scripts/atlas_analytics.py; counters only, nothing recorded when the user has opted out):
  dispatch.<event>.ms.<bucket>   once per dispatch: wall time of the whole hook pass
  hook.<name>.slow               one hook took longer than SLOW_HOOK_MS (1000 ms)
  hook.<name>.fault              one hook raised, exited with a code other than 0 or 2, or ran out of time
  hook.<name>.deny|ask|context   what a hook decided (exit 2 counts as deny)
  skill.<dir> / agent.<role>     an atlas skill or subagent ran (PostToolUse), or a UserPromptSubmit prompt
                                 starts with /atlas:<skill> or /<skill> (record_prompt, called from
                                 prompt_optimizer)
Names only: never a command, path, prompt or tool_input value.
"""

import io
import json
import os
import re
import signal
import sys
import time
from contextlib import redirect_stderr, redirect_stdout

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))
import atlas_env  # noqa: E402

atlas_env.apply_store_env()
import atlas_harness  # noqa: E402

# (hook name, original hooks.json matcher, SIGALRM slice seconds), in the old hooks.json order.
# Module and main() are resolved lazily by name; dispatch_tripwire lives in dispatch_tripwire_core.
BINDINGS = {
    "PreToolUse": (
        ("recall_gate", "*", 8),
        ("bash_advisor", "Bash", 8),
        ("git_guard", "Bash|Write|Agent|Task|mcp__.*", 8),
        ("edit_read_nudge", "Edit|edit|MultiEdit", 8),
        (
            "dispatch_tripwire",
            "Edit|Write|MultiEdit|NotebookEdit|Read|Grep|Glob|Bash|Agent|Task|collaboration\\.spawn_agent",
            14,
        ),
    ),
    "PostToolUse": (
        (
            "todo_capture",
            "TodoWrite|TaskCreate|TaskUpdate|Agent|Task|collaboration\\.spawn_agent|Bash"
            "|mcp__mcp_search__work_state_write|mcp__mcp_search_work_state_write",
            8,
        ),
        ("docs_drift_watch", "Edit|Write|MultiEdit|NotebookEdit", 13),
        ("delegation_prewarn", "Edit|Write|MultiEdit|NotebookEdit", 8),
        ("edit_read_nudge", "Read|read|mcp__.*ctx_read", 8),
        (
            "dispatch_tripwire",
            "Read|Grep|Glob|Edit|Write|Bash|Agent|Task|collaboration\\.spawn_agent|MultiEdit|NotebookEdit|Skill",
            14,
        ),
        (
            "connector_credential_watch",
            "mcp__.*",
            8,
        ),
    ),
}

# Whole-process budget per event; hooks.json gives the dispatcher a little more.
BUDGET_S = {"PreToolUse": 40.0, "PostToolUse": 40.0}

# Hooks bound to a broad matcher stay free on the common path: the hook module is not even
# imported unless the raw payload contains one of these markers (a superset of what the hook
# itself treats as an auth failure; a false positive only costs the hook's own check).
_PREFILTER = {
    "connector_credential_watch": re.compile(
        r"401|403|unauthori|forbidden|expired|invalid|authentication", re.I
    ),
}

OMP_NATIVE = frozenset({"recall_gate", "todo_capture"})
_MODULES = {"dispatch_tripwire": "dispatch_tripwire_core"}
# One hook slower than this is counted as hook.<name>.slow (the schema's "slower than one second").
SLOW_HOOK_MS = 1000
_RANK = {"deny": 3, "ask": 2, "allow": 1}


def outer_matcher(event):
    """The one hooks.json matcher that covers every inner binding (so the dispatcher is not
    spawned for a tool no hook wants). '*' when any inner binding is '*'."""
    ms = [m for _, m, _ in BINDINGS[event]]
    if "*" in ms:
        return "*"
    alts = []
    for m in ms:
        for alt in m.split("|"):
            if alt not in alts:
                alts.append(alt)
    return "|".join(alts)


def matches(matcher, tool):
    """hooks.json matcher semantics (the same fullmatch the omp bridge uses)."""
    if matcher in (None, "", "*"):
        return True
    return re.fullmatch(matcher, tool or "") is not None


def select(event, tool, harness=None):
    """Hook names that run for (event, tool), in order."""
    harness = os.environ.get("ATLAS_HARNESS") if harness is None else harness
    return [
        name
        for name, matcher, _ in BINDINGS.get(event, ())
        if matches(matcher, tool) and not (harness == "omp" and name in OMP_NATIVE)
    ]


_FAULTS = None  # run_event's per-dispatch list of faulted hook names (None outside a dispatch)


class _SliceExpired(BaseException):
    """BaseException so a hook's own `except Exception` cannot swallow it."""


def _on_alarm(signum, frame):
    raise _SliceExpired()


def _resolve(name):
    """The hook's main(). Patched by tests."""
    return __import__(_MODULES.get(name, name)).main


def _fault(name, exc, cwd=None):
    try:
        import atlas_hook_guard

        atlas_hook_guard.fault(name, exc, cwd)
    except Exception:
        pass


def _invoke(name, raw, seconds, cwd=None):
    """Run one hook; returns (exit code, stdout, stderr). Never raises. A raise, a slice timeout or an
    exit code other than 0 and 2 appends `name` to _FAULTS (telemetry hook.<name>.fault)."""
    faults = _FAULTS
    out, err = io.StringIO(), io.StringIO()
    saved_in = sys.stdin
    sys.stdin = io.StringIO(raw)
    bounded = hasattr(signal, "SIGALRM") and seconds > 0
    old = None
    rc = 0
    try:
        if bounded:
            try:
                old = signal.signal(signal.SIGALRM, _on_alarm)
                signal.setitimer(signal.ITIMER_REAL, seconds)
            except (ValueError, OSError):  # not the main thread: run unbounded
                bounded = False
        with redirect_stdout(out), redirect_stderr(err):
            code = _resolve(name)()
        rc = code if isinstance(code, int) else 0
    except SystemExit as exc:
        rc = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1)
    except _SliceExpired:
        _fault(name, TimeoutError("event_dispatch slice expired"), cwd)
        if faults is not None:
            faults.append(name)
        return 0, "", ""  # a half-written document is unusable: fail open
    except Exception as exc:
        _fault(name, exc, cwd)
        if faults is not None:
            faults.append(name)
        return 0, "", err.getvalue()
    finally:
        if bounded:
            try:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, old or signal.SIG_DFL)
            except (ValueError, OSError):
                pass
        sys.stdin = saved_in
    if faults is not None and rc not in (0, 2):
        faults.append(name)
    return rc, out.getvalue(), err.getvalue()


def _docs(text):
    """JSON objects in a hook's stdout, plus any non-JSON remainder."""
    dec, i, n = json.JSONDecoder(), 0, len(text)
    docs, stray = [], ""
    while i < n:
        if text[i].isspace():
            i += 1
            continue
        try:
            obj, j = dec.raw_decode(text, i)
        except ValueError:
            stray = text[i:].strip()
            break
        if isinstance(obj, dict):
            docs.append(obj)
        i = j
    return docs, stray


def merge(event, results):
    """results: [(name, rc, stdout, stderr)] in binding order -> (exit code, stdout, stderr)."""
    blockers = [r for r in results if r[1] == 2]
    if blockers:
        msg = "\n".join(r[3].strip() for r in blockers if r[3].strip())
        return 2, "", msg + "\n" if msg else ""
    stderr = "".join(
        r[3] if r[3].endswith("\n") or not r[3] else r[3] + "\n" for r in results
    )
    docs = []
    for name, _, stdout, _ in results:
        found, stray = _docs(stdout)
        docs.extend(found)
        if stray:  # plain-text stdout is not part of the one JSON document
            stderr += "[atlas] %s printed non-JSON output, ignored: %s\n" % (
                name,
                stray[:200],
            )
    if not docs:
        return 0, "", stderr
    if len(docs) == 1:
        return 0, json.dumps(docs[0]) + "\n", stderr

    top, extra, contexts, decisions, sysmsgs = {}, {}, [], [], []
    updated = None
    for doc in docs:
        for key, val in doc.items():
            if key == "hookSpecificOutput":
                continue
            if key == "systemMessage" and isinstance(val, str) and val:
                sysmsgs.append(val)
            elif key == "decision":
                if val == "block" or "decision" not in top:
                    top["decision"] = val
                    if "reason" in doc:
                        top["reason"] = doc["reason"]
            elif key != "reason":
                top.setdefault(key, val)
        spec = doc.get("hookSpecificOutput")
        if not isinstance(spec, dict):
            continue
        ctx = spec.get("additionalContext")
        if isinstance(ctx, str) and ctx.strip():
            contexts.append(ctx)
        if spec.get("permissionDecision"):
            decisions.append(
                (spec["permissionDecision"], spec.get("permissionDecisionReason") or "")
            )
        if isinstance(spec.get("updatedInput"), dict):
            updated = spec["updatedInput"]
        for key, val in spec.items():
            if key not in (
                "hookEventName",
                "additionalContext",
                "permissionDecision",
                "permissionDecisionReason",
                "updatedInput",
            ):
                extra.setdefault(key, val)

    out_spec = {"hookEventName": event}
    out_spec.update(extra)
    if decisions:
        best = max(_RANK.get(d, 0) for d, _ in decisions)
        chosen = next((d, r) for d, r in decisions if _RANK.get(d, 0) == best)
        out_spec["permissionDecision"] = chosen[0]
        if chosen[1]:
            out_spec["permissionDecisionReason"] = chosen[1]
        if chosen[0] == "deny":
            skipped = [r for d, r in decisions if d == "deny" and r and r != chosen[1]]
            contexts = ["[also blocked] " + r for r in skipped] + contexts
            updated = None
    if updated is not None:
        out_spec["updatedInput"] = updated
    if contexts:
        out_spec["additionalContext"] = "\n\n".join(contexts)
    doc = dict(top)
    if sysmsgs:
        doc["systemMessage"] = "\n\n".join(sysmsgs)
    if len(out_spec) > 1:
        doc["hookSpecificOutput"] = out_spec
    return 0, (json.dumps(doc) + "\n" if doc else ""), stderr


def _analytics_keys(event, payload, results):
    """Anonymous counter keys for one tool event: which hooks denied/asked/added context, which
    atlas skill or agent ran. Names only: never a command, path, prompt or tool_input value."""
    keys = []
    for name, rc, out, _ in results:
        if rc == 2:
            keys.append("hook.%s.deny" % name)
            continue
        if not out:
            continue
        docs, _stray = _docs(out)
        for doc in docs:
            spec = doc.get("hookSpecificOutput")
            if not isinstance(spec, dict):
                continue
            decision = spec.get("permissionDecision")
            if decision in ("deny", "ask"):
                keys.append("hook.%s.%s" % (name, decision))
            ctx = spec.get("additionalContext")
            if isinstance(ctx, str) and ctx.strip():
                keys.append("hook.%s.context" % name)
    if event == "PostToolUse":
        tool = payload.get("tool_name")
        ti = payload.get("tool_input")
        ti = ti if isinstance(ti, dict) else {}
        if tool == "Skill":
            skill = ti.get("skill")
            if isinstance(skill, str) and skill.startswith("atlas:") and len(skill) > 6:
                keys.append("skill." + skill[len("atlas:") :])
        elif tool in ("Agent", "Task"):
            role = ti.get("subagent_type")
            if isinstance(role, str) and role.startswith("atlas:") and len(role) > 6:
                keys.append("agent." + role[len("atlas:") :])
    return keys


def _bucket(ms):
    return "lt50" if ms < 50 else "50to200" if ms < 200 else "200to1000" if ms < 1000 else "ge1000"


def _record_analytics(event, payload, results, elapsed_ms=None, slow=(), faults=()):
    """Feed atlas_analytics (a cheap no-op until the user opts in). Fail-open: a missing or broken
    analytics module never changes hook output. Decisions, skills and agents go through the validating
    atlas_analytics.record(); the keys built here from BINDINGS names and bucket constants are appended
    by atlas_analytics_hot, a stdlib-only writer (importing the full client costs milliseconds this hook
    cannot spend: the dispatcher adds under 2 ms p50)."""
    try:
        keys = _analytics_keys(event, payload, results)
        trusted = ["hook.%s.slow" % n for n in slow] + ["hook.%s.fault" % n for n in faults]
        if elapsed_ms is not None:
            trusted.append("dispatch.%s.ms.%s" % (event, _bucket(elapsed_ms)))
        if not keys and not trusted:
            return
        if trusted:
            import atlas_analytics_hot

            atlas_analytics_hot.record(trusted)
        if keys:
            import atlas_analytics

            for key in keys:
                atlas_analytics.record(key)
    except Exception:  # noqa: BLE001 -- including ImportError and a record() that raises
        pass


_SLASH_SKILL = re.compile(r"/(?:atlas:)?(atlas-[a-z0-9-]{1,60})(?=\s|$)")


def prompt_skill_key(prompt):
    """skill.<dir> when `prompt` starts with /atlas:<skill> or /<skill> naming a shipped atlas skill
    (a directory under skills/), else None. Nothing after the command is read. A directory that is not a
    real skill is dropped later: atlas_analytics validates every stored key against its skill list."""
    if not isinstance(prompt, str):
        return None
    m = _SLASH_SKILL.match(prompt.lstrip()[:100])
    if m is None:
        return None
    skill = m.group(1)
    if not os.path.isdir(os.path.join(_HERE, "..", "skills", skill)):
        return None
    return "skill." + skill


def record_prompt(payload):
    """UserPromptSubmit telemetry, called by prompt_optimizer: skill.<dir> for a leading atlas slash
    command. A prompt that does not start with '/' costs one string test. Never raises."""
    try:
        prompt = payload.get("prompt") if isinstance(payload, dict) else None
        if not isinstance(prompt, str) or not prompt.lstrip().startswith("/"):
            return
        key = prompt_skill_key(prompt)
        if key is None:
            return
        import atlas_analytics_hot

        atlas_analytics_hot.record([key])
    except Exception:  # noqa: BLE001 -- telemetry never changes a prompt
        pass


def _codex_safe(event, payload, merged):
    """Under Codex a PreToolUse "ask" is a hook error: rewrite the merged document so it denies.
    Other harnesses and any parse failure pass through unchanged."""
    code, out, err = merged
    if event != "PreToolUse" or not out or atlas_harness.detect_harness(payload) != "codex":
        return merged
    try:
        doc = atlas_harness.codex_safe_output(json.loads(out), "codex")
    except ValueError:
        return merged
    return code, json.dumps(doc) + "\n", err


def _strip_updated_input(merged):
    """A hook's updatedInput is in the Claude shape; Codex needs its own (a patch text, not a
    file_path), so it is dropped when the tool payload was translated."""
    code, out, err = merged
    if not out:
        return merged
    try:
        doc = json.loads(out)
        spec = doc.get("hookSpecificOutput")
        if not isinstance(spec, dict) or "updatedInput" not in spec:
            return merged
        spec.pop("updatedInput")
    except (ValueError, AttributeError):
        return merged
    return code, json.dumps(doc) + "\n", err


def run_event(event, raw, harness=None):
    """Run every applicable hook for one event payload; returns (exit code, stdout, stderr).
    Codex apply_patch / spawn_agent / update_plan payloads are rewritten to the Claude shape first
    (atlas_harness.expand_tool_payloads); a multi-file patch runs the hooks once per file."""
    try:
        payload = json.loads(raw, strict=False) if raw.strip() else {}
    except ValueError:
        payload = {}
    payload = payload if isinstance(payload, dict) else {}
    variants = atlas_harness.expand_tool_payloads(payload)
    translated = any(atlas_harness.was_translated(v) for v in variants)
    started = time.monotonic()
    budget = BUDGET_S.get(event, 30.0)
    results = []
    global _FAULTS
    faults, slow = [], []
    _FAULTS = faults
    for variant in variants:
        vraw = json.dumps(variant) if atlas_harness.was_translated(variant) else raw
        tool = variant.get("tool_name")
        tool = tool if isinstance(tool, str) else ""
        cwd = variant.get("cwd") if isinstance(variant.get("cwd"), str) else None
        slices = {name: s for name, _, s in BINDINGS.get(event, ())}
        wanted = select(event, tool, harness)
        for name, _, seconds in BINDINGS.get(event, ()):
            if name not in wanted:
                continue
            left = budget - (time.monotonic() - started) - 0.5
            if left <= 0:
                _fault(name, TimeoutError("event_dispatch budget spent"), cwd)
                faults.append(name)
                continue
            gate = _PREFILTER.get(name)
            if gate is not None and not gate.search(vraw):
                continue
            t0 = time.monotonic()
            rc, out, err = _invoke(name, vraw, min(slices[name], left), cwd)
            if (time.monotonic() - t0) * 1000.0 > SLOW_HOOK_MS:
                slow.append(name)
            results.append((name, rc, out, err))
    _FAULTS = None
    merged = _codex_safe(event, payload, merge(event, results))
    if translated:
        merged = _strip_updated_input(merged)
    _record_analytics(event, variants[0], results, (time.monotonic() - started) * 1000.0, slow, faults)
    return merged


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        raw = sys.stdin.read()
    except Exception:
        raw = ""
    event = argv[0] if argv else ""
    if event not in BINDINGS:
        try:
            event = json.loads(raw, strict=False).get("hook_event_name", "")
        except Exception:
            event = ""
    if event not in BINDINGS:
        return 0
    try:
        code, out, err = run_event(event, raw)
    except Exception as exc:  # the dispatcher itself must never block a tool call
        _fault("event_dispatch", exc)
        return 0
    if err:
        sys.stderr.write(err)
    if out:
        sys.stdout.write(out)
    return code


if __name__ == "__main__":
    sys.exit(main())
