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

# (hook name, original hooks.json matcher, SIGALRM slice seconds), in the old hooks.json order.
# Module and main() are resolved lazily by name; dispatch_tripwire lives in dispatch_tripwire_core.
BINDINGS = {
    "PreToolUse": (
        ("recall_gate", "*", 8),
        ("bash_advisor", "Bash", 8),
        ("edit_read_nudge", "Edit|edit|MultiEdit", 8),
        (
            "dispatch_tripwire",
            "Edit|Write|MultiEdit|NotebookEdit|Read|Grep|Glob|Bash|Agent|Task",
            14,
        ),
    ),
    "PostToolUse": (
        ("todo_capture", "TodoWrite|Agent|Task|Bash", 8),
        ("docs_drift_watch", "Edit|Write|MultiEdit|NotebookEdit", 13),
        ("delegation_prewarn", "Edit|Write|MultiEdit|NotebookEdit", 8),
        ("edit_read_nudge", "Read|read|mcp__.*ctx_read", 8),
        (
            "dispatch_tripwire",
            "Read|Grep|Glob|Edit|Write|Bash|Agent|Task|MultiEdit|NotebookEdit|Skill",
            14,
        ),
        (
            "connector_credential_watch",
            "mcp__plugin_armada_.*|mcp__falcon-mcp__.*|mcp__cipp.*|mcp__connectwise.*"
            "|mcp__plaid__.*|mcp__gcloud__.*",
            8,
        ),
    ),
}

# Whole-process budget per event; hooks.json gives the dispatcher a little more.
BUDGET_S = {"PreToolUse": 30.0, "PostToolUse": 40.0}

OMP_NATIVE = frozenset({"recall_gate", "todo_capture"})
_MODULES = {"dispatch_tripwire": "dispatch_tripwire_core"}
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
    """Run one hook; returns (exit code, stdout, stderr). Never raises."""
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
        return 0, "", ""  # a half-written document is unusable: fail open
    except Exception as exc:
        _fault(name, exc, cwd)
        return 0, "", err.getvalue()
    finally:
        if bounded:
            try:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, old or signal.SIG_DFL)
            except (ValueError, OSError):
                pass
        sys.stdin = saved_in
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


def run_event(event, raw, harness=None):
    """Run every applicable hook for one event payload; returns (exit code, stdout, stderr)."""
    try:
        payload = json.loads(raw, strict=False) if raw.strip() else {}
    except ValueError:
        payload = {}
    payload = payload if isinstance(payload, dict) else {}
    tool = payload.get("tool_name")
    tool = tool if isinstance(tool, str) else ""
    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else None
    slices = {name: s for name, _, s in BINDINGS.get(event, ())}
    started = time.monotonic()
    budget = BUDGET_S.get(event, 30.0)
    results = []
    wanted = select(event, tool, harness)
    for name, _, seconds in BINDINGS.get(event, ()):
        if name not in wanted:
            continue
        left = budget - (time.monotonic() - started) - 0.5
        if left <= 0:
            _fault(name, TimeoutError("event_dispatch budget spent"), cwd)
            continue
        rc, out, err = _invoke(name, raw, min(slices[name], left), cwd)
        results.append((name, rc, out, err))
    return merge(event, results)


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
