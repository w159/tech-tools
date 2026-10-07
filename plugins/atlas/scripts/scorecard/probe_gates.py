"""Gate probes: decision correctness over the ~99 allow/deny/bypass cases, dispatch-spec
decoys, worker-report nonsense, credential-watch false positives."""

import json
import os
import time
import uuid
from pathlib import Path

from . import core
from .core import metric, run, skipped
from .probe_hooks import CMD, Sandbox

OVERRIDE_FALLOW = r"""#!/bin/bash
if [ "$1" = "--version" ]; then echo "fallow ${FAKE_FALLOW_VERSION:-2.90.0}"; exit 0; fi
echo "$@" >> "${FAKE_FALLOW_LOG:-/dev/null}"
echo "{\"verdict\": \"${FAKE_VERDICT:-pass}\"}"; exit ${FAKE_RC:-0}
"""
TOOLS = "TOOLS: ToolSearch select:mcp__lean-ctx__ctx_search,serena activate_project"
SPEC = (
    "GOAL: do x\nDELIVERABLE: y\nSUCCESS CRITERIA: z\nOUT OF SCOPE: w\nSTOP CONDITIONS: v\n"
    "REPORT: STATUS, STEPS, FILES_CHANGED, EVIDENCE, DELIVERABLE, NEXT\n" + TOOLS
)
GOOD_REPORT = "STATUS: DONE\nSTEPS: 2/2\nFILES_CHANGED: none\nEVIDENCE:\n1. x -> y\nDELIVERABLE: z\nNEXT: none"


class Gates:
    """Drives the gate hooks in a sandbox and records (gate, case, expect, got)."""

    def __init__(self, ctx):
        self.sb = Sandbox(ctx, "gates")
        self.ctx = ctx
        self.results = []
        self.proj = str(self.sb.proj) if self.sb.proj else None

    # -- plumbing ---------------------------------------------------------------
    def rec(self, gate, name, expect, r, note=""):
        d = core.hook_decision(r["out"])
        ok = d == expect or (expect == "allow" and d == "context")
        self.results.append(
            {
                "gate": gate,
                "case": name,
                "expect": expect,
                "got": d,
                "ok": ok,
                "rc": r["rc"],
                "faults": r["new_faults"],
                "note": note,
            }
        )

    def sql(self, code):
        full = (
            f"import sys; sys.path.insert(0, {str(self.ctx.scripts)!r})\nimport atlas_db\n"
            "c = atlas_db.connect(); atlas_db.init(c)\n"
            f"pid = atlas_db.register_project(c, {self.proj!r})\n"
            + code
            + "c.commit()\n"
        )
        r = run([self.ctx.py, "-c", full], env=self.sb.env, cwd=self.proj)
        if r["rc"] != 0:
            raise RuntimeError("db seed failed: " + r["err"][-300:])

    def orchestrating(self, s, n_inline=0, orchestrating=True):
        code = f"rid = atlas_db.start_run(c, pid, {s!r}, 'task')\n"
        if orchestrating:
            code += f"atlas_db.mark_orchestrating(c, {s!r}, {self.proj!r})\n"
        code += f"for i in range({n_inline}): atlas_db.log_event(c, rid, 'Bash', 'main', 1, None)\n"
        self.sql(code)

    def mkrun(self, s, orchestrating=True, edit=True, dispatch=False):
        code = f"rid = atlas_db.start_run(c, pid, {s!r}, 'task')\n"
        if orchestrating:
            code += f"atlas_db.mark_orchestrating(c, {s!r}, {self.proj!r})\n"
        if edit:
            code += f"atlas_db.log_event(c, rid, 'Edit', 'main', 1, {self.proj + '/src/app.py'!r})\n"
        if dispatch:
            code += "atlas_db.log_dispatch(c, rid, 'atlas:implementer')\n"
        self.sql(code)

    def pre(self, s, tool, ti, **k):
        return dict(
            session_id=s,
            cwd=k.pop("cwd", self.proj),
            hook_event_name="PreToolUse",
            tool_name=tool,
            tool_input=ti,
            transcript_path=k.pop("transcript_path", self.sb.tp),
            **k,
        )

    def hook(self, script, payload, extra=None, cwd=None):
        return self.sb.run(script, payload, extra, cwd=cwd)

    # -- gates ------------------------------------------------------------------
    def recall_gate(self):
        G, sid = "recall_gate", self.sb.sid
        rg = lambda p, extra=None, cwd=None: self.hook("recall_gate.py", p, extra, cwd)  # noqa: E731
        try:
            mand = json.loads((self.ctx.root / "contracts/mandates.json").read_text())[
                "recallGateCases"
            ]
        except Exception:
            mand = {"satisfy": [], "block": [], "exempt": []}
        for c in mand.get("satisfy", []):
            self.rec(
                G,
                "contract-satisfy:" + c["name"] + ":" + c["input"].get("path", "")[:30],
                "allow",
                rg(self.pre(sid(), c["name"], c["input"])),
            )
        for c in mand.get("block", []):
            s = sid()
            self.rec(
                G,
                "contract-block(1st):" + c["name"],
                "deny",
                rg(self.pre(s, c["name"], c["input"])),
            )
            self.rec(
                G,
                "contract-block(2nd, same session):" + c["name"],
                "deny",
                rg(self.pre(s, c["name"], c["input"])),
                "mandates.json: denied on every attempt",
            )
        for c in mand.get("exempt", []):
            self.rec(
                G,
                "contract-exempt:" + c["name"],
                "allow",
                rg(self.pre(sid(), c["name"], c["input"])),
            )
        s = sid()
        rg(self.pre(s, "mcp__plugin_claude-mem_mcp-search__search", {"query": "x"}))
        self.rec(
            G,
            "allow-after-recall: Bash",
            "allow",
            rg(self.pre(s, "Bash", {"command": "ls"})),
        )
        self.rec(
            G,
            "allow-subagent-transcript",
            "allow",
            rg(
                self.pre(
                    sid(),
                    "Bash",
                    {"command": "ls"},
                    transcript_path="/h/.claude/projects/p/s/subagents/agent-1.jsonl",
                )
            ),
        )
        self.rec(
            G,
            "allow-kill-switch ATLAS_MANDATES=off",
            "allow",
            rg(self.pre(sid(), "Bash", {"command": "ls"}), {"ATLAS_MANDATES": "off"}),
        )
        self.rec(
            G,
            "allow-no-session_id",
            "allow",
            rg(
                {"tool_name": "Bash", "tool_input": {"command": "ls"}, "cwd": self.proj}
            ),
        )
        nomem = self.ctx.sub("gates") / "nomem"
        nomem.mkdir(exist_ok=True)
        self.rec(
            G,
            "allow-mem-server-not-mounted",
            "allow",
            rg(
                self.pre(sid(), "Bash", {"command": "ls"}, cwd=str(nomem)),
                cwd=str(nomem),
            ),
        )
        self.rec(
            G,
            "allow-ATLAS_GATES=off",
            "allow",
            rg(self.pre(sid(), "Bash", {"command": "ls"}), {"ATLAS_GATES": "off"}),
        )
        for tool, ti in (
            ("MultiEdit", {"file_path": "x"}),
            ("Agent", {"prompt": "x"}),
            ("Skill", {"skill": "x"}),
        ):
            self.rec(G, f"deny-{tool} first", "deny", rg(self.pre(sid(), tool, ti)))
        self.rec(
            G,
            "BYPASS? non-claude-mem tool with mcp-search in the name",
            "deny",
            rg(self.pre(sid(), "mcp__evil_mcp-search__x", {})),
        )
        self.rec(
            G,
            "BYPASS? non-search claude-mem tool satisfies the gate",
            "deny",
            rg(
                self.pre(
                    sid(),
                    "Write",
                    {
                        "path": "xd://mcp__claude_mem_mcp_search_get_observations",
                        "content": "{}",
                    },
                )
            ),
        )

    def worker_report_gate(self):
        G, sid = "worker_report_gate", self.sb.sid
        wg = lambda p, extra=None: self.hook("worker_report_gate.py", p, extra)  # noqa: E731

        def sub(msg, **k):
            return dict(
                session_id=sid(),
                hook_event_name="SubagentStop",
                agent_type=k.pop("agent_type", "atlas:implementer"),
                agent_id=k.pop("agent_id", "ag" + uuid.uuid4().hex[:6]),
                last_assistant_message=msg,
                cwd=self.proj,
                **k,
            )

        self.rec(G, "allow-valid-report", "allow", wg(sub(GOOD_REPORT)))
        self.rec(
            G,
            "allow-non-atlas-agent",
            "allow",
            wg(sub("blah", agent_type="general-purpose")),
        )
        self.rec(
            G, "allow-stop_hook_active", "allow", wg(sub("blah", stop_hook_active=True))
        )
        self.rec(G, "allow-empty-message", "allow", wg(sub("")))
        self.rec(
            G,
            "allow-kill-switch ATLAS_GATE_REPORT=off",
            "allow",
            wg(sub("blah"), {"ATLAS_GATE_REPORT": "off"}),
        )
        self.rec(
            G,
            "allow-lowercase-status",
            "allow",
            wg(sub(GOOD_REPORT.replace("STATUS: DONE", "status: done"))),
        )
        aid = "dup" + uuid.uuid4().hex[:5]
        self.rec(
            G,
            "deny-prose-only",
            "block",
            wg(sub("All done, nothing to report.", agent_id=aid)),
        )
        self.rec(
            G,
            "allow-second-malformed-same-agent",
            "allow",
            wg(sub("still prose", agent_id=aid)),
        )
        self.rec(
            G,
            "deny-preamble-before-container",
            "block",
            wg(sub("Here is my report:\n" + GOOD_REPORT)),
        )
        self.rec(
            G,
            "deny-missing-NEXT-label",
            "block",
            wg(sub(GOOD_REPORT.replace("NEXT: none", ""))),
        )
        self.rec(
            G,
            "deny-missing-EVIDENCE",
            "block",
            wg(
                sub(
                    "STATUS: DONE\nSTEPS: 1/1\nFILES_CHANGED: none\nDELIVERABLE: x\nNEXT: none"
                )
            ),
        )
        self.rec(
            G,
            "deny-bad-status-value",
            "block",
            wg(sub(GOOD_REPORT.replace("STATUS: DONE", "STATUS: OK"))),
        )
        self.rec(
            G,
            "deny-container-in-code-fence",
            "block",
            wg(sub("```\n" + GOOD_REPORT + "\n```")),
        )
        self.rec(
            G,
            "allow-no-hook_event_name",
            "allow",
            wg(
                {
                    "agent_type": "atlas:x",
                    "agent_id": "q",
                    "last_assistant_message": "prose",
                }
            ),
        )
        self.rec(
            G,
            "deny-atlas-dash-agent_type",
            "block",
            wg(sub("prose", agent_type="atlas-implementer")),
        )
        miss = {
            "hook_event_name": "SubagentStop",
            "agent_type": "atlas:x",
            "last_assistant_message": "prose",
        }
        self.rec(G, "agent_id missing: first agent", "block", wg(miss))
        self.rec(
            G,
            "agent_id missing: second agent also blocked",
            "block",
            wg(dict(miss, agent_type="atlas:y", last_assistant_message="prose2")),
        )

    def fallow_gate(self):
        G, sid = "fallow_gate", self.sb.sid
        shimdir = self.ctx.sub("gates") / "shim"
        shimdir.mkdir(exist_ok=True)
        shim = shimdir / "fallow"
        shim.write_text(OVERRIDE_FALLOW)
        shim.chmod(0o755)
        path = f"{shimdir}{os.pathsep}{self.sb.env['PATH']}"

        def fg(cmd, v="pass", extra=None, tool="Bash"):
            return self.hook(
                "fallow_gate.py",
                dict(
                    session_id=sid(),
                    cwd=self.proj,
                    hook_event_name="PreToolUse",
                    tool_name=tool,
                    tool_input={"command": cmd},
                ),
                dict({"PATH": path, "FAKE_VERDICT": v}, **(extra or {})),
            )

        cases = [
            ("deny: git commit + fail", "deny", "git commit -m x", "fail", None),
            ("deny: git push + fail", "deny", "git push origin main", "fail", None),
            (
                "deny: chained cd && git commit + fail",
                "deny",
                "cd src && git commit -am x",
                "fail",
                None,
            ),
            (
                "deny: git commit --amend + fail",
                "deny",
                "git commit --amend --no-edit",
                "fail",
                None,
            ),
            (
                "deny: version below floor",
                "deny",
                "git commit -m x",
                "pass",
                {"FAKE_FALLOW_VERSION": "2.80.0"},
            ),
            ("allow: git commit + pass", "allow", "git commit -m x", "pass", None),
            ("allow: git commit + warn", "allow", "git commit -m x", "warn", None),
            ("allow: git status + fail", "allow", "git status", "fail", None),
            (
                "allow: git commit-tree + fail",
                "allow",
                "git commit-tree abc",
                "fail",
                None,
            ),
            (
                "allow: runtime error rc=2 fail-open",
                "allow",
                "git commit -m x",
                "pass",
                {"FAKE_RC": "2"},
            ),
            (
                "allow: ATLAS_FALLOW=off",
                "allow",
                "git commit -m x",
                "fail",
                {"ATLAS_FALLOW": "off"},
            ),
            ("BYPASS? git -C . commit", "deny", "git -C . commit -m x", "fail", None),
            (
                "BYPASS? git -c k=v commit",
                "deny",
                "git -c user.name=x commit -m x",
                "fail",
                None,
            ),
            (
                "BYPASS? sh -c 'git commit'",
                "deny",
                "sh -c 'git commit -m x'",
                "fail",
                None,
            ),
            ("BYPASS? bash -c git push", "deny", 'bash -c "git push"', "fail", None),
            (
                "BYPASS? env-prefixed git commit",
                "deny",
                "GIT_AUTHOR_NAME=x git commit -m x",
                "fail",
                None,
            ),
            ("FALSE+? echo git commit", "allow", "echo git commit", "fail", None),
            (
                "FALSE+? grep 'git push' docs",
                "allow",
                "grep -rn 'git push' docs",
                "fail",
                None,
            ),
            (
                "FALSE+? grep git push (unquoted)",
                "allow",
                "git log --oneline | grep git push",
                "fail",
                None,
            ),
        ]
        for name, expect, cmd, v, extra in cases:
            self.rec(G, name, expect, fg(cmd, v, extra))
        self.rec(
            G,
            "allow: non-Bash tool",
            "allow",
            fg("git commit -m x", "fail", tool="Write"),
        )
        log = self.ctx.sub("gates") / "fallow.log"
        log.unlink(missing_ok=True)
        fg("git commit -m x", "pass", {"FAKE_FALLOW_LOG": str(log)})
        self.results.append(
            {
                "gate": G,
                "case": "audit invoked on a gated commit",
                "expect": "-",
                "got": "ran" if log.exists() and log.read_text().strip() else "NOT RUN",
                "ok": log.exists() and bool(log.read_text().strip()),
                "rc": 0,
                "faults": 0,
                "note": "",
            }
        )

    def dispatch_tripwire(self):
        G, sid = "dispatch_tripwire", self.sb.sid
        tw = lambda p, extra=None: self.hook("dispatch_tripwire.py", p, extra)  # noqa: E731
        sub_tp = "/h/projects/p/s/subagents/a.jsonl"

        def disp(s, prompt, name="W1", agent="atlas:implementer", **k):
            ti = dict(
                subagent_type=agent, prompt=prompt, **({"name": name} if name else {})
            )
            return dict(
                session_id=s,
                cwd=self.proj,
                hook_event_name="PreToolUse",
                tool_name="Agent",
                tool_input=ti,
                transcript_path=self.sb.tp,
                **k,
            )

        def edit(s, path, **k):
            return dict(
                session_id=s,
                cwd=self.proj,
                hook_event_name="PreToolUse",
                tool_name="Edit",
                tool_input={"file_path": path, "old_string": "a", "new_string": "b"},
                transcript_path=self.sb.tp,
                **k,
            )

        p = self.proj
        s = sid()
        self.orchestrating(s)
        self.rec(
            G, "allow: valid atlas:implementer dispatch", "allow", tw(disp(s, SPEC))
        )
        self.rec(
            G,
            "allow: Edit docs/ in orchestrating session",
            "allow",
            tw(edit(s, p + "/docs/CHANGELOG.md")),
        )
        self.rec(
            G,
            "allow: Edit .atlas/ in orchestrating session",
            "allow",
            tw(edit(s, p + "/.atlas/evidence/x.md")),
        )
        s2 = sid()
        self.orchestrating(s2, orchestrating=False)
        self.rec(
            G,
            "allow: Edit src/ in NON-orchestrating session",
            "allow",
            tw(edit(s2, p + "/src/app.py")),
        )
        self.rec(
            G,
            "allow: Edit src/ from subagent transcript",
            "allow",
            tw(dict(edit(s, p + "/src/app.py"), transcript_path=sub_tp)),
        )
        self.rec(
            G,
            "allow: HARD=off Edit src/",
            "allow",
            tw(edit(s, p + "/src/app.py"), {"ATLAS_TRIPWIRE_HARD": "off"}),
        )
        self.rec(
            G,
            "allow: non-atlas agent w/o spec",
            "allow",
            tw(disp(s, "just do it", agent="general-purpose")),
        )
        self.rec(
            G,
            "allow: Read src",
            "allow",
            tw(
                dict(
                    edit(s, p + "/src/app.py"),
                    tool_name="Read",
                    tool_input={"file_path": p + "/src/app.py"},
                )
            ),
        )
        self.rec(
            G,
            "deny: Edit src/ in orchestrating session",
            "deny",
            tw(edit(s, p + "/src/app.py")),
        )
        self.rec(
            G,
            "deny: Write src/ in orchestrating session",
            "deny",
            tw(
                dict(
                    edit(s, p + "/src/new.py"),
                    tool_name="Write",
                    tool_input={"file_path": p + "/src/new.py", "content": "x"},
                )
            ),
        )
        self.rec(G, "deny: dispatch without name", "deny", tw(disp(s, SPEC, name=None)))
        self.rec(
            G,
            "deny: dispatch missing spec blocks",
            "deny",
            tw(disp(s, "GOAL: x\n" + TOOLS)),
        )
        self.rec(
            G,
            "deny: dispatch missing TOOLS",
            "deny",
            tw(disp(s, SPEC.replace(TOOLS, ""))),
        )
        self.rec(
            G, "deny: two GOAL blocks", "deny", tw(disp(s, SPEC + "\nGOAL: second"))
        )
        self.rec(
            G,
            "deny: nested dispatch from subagent",
            "deny",
            tw(dict(disp(s, SPEC), transcript_path=sub_tp)),
        )
        self.rec(
            G,
            "deny: model override",
            "deny",
            tw(
                dict(
                    disp(s, SPEC),
                    tool_input=dict(
                        subagent_type="atlas:implementer",
                        prompt=SPEC,
                        name="W",
                        model="haiku",
                    ),
                )
            ),
        )
        self.rec(
            G, "deny: runner w/o STEPS", "deny", tw(disp(s, SPEC, agent="atlas:runner"))
        )
        self.rec(
            G,
            "BYPASS? Bash redirect write inline",
            "deny",
            tw(
                dict(
                    edit(s, ""),
                    tool_name="Bash",
                    tool_input={"command": "echo x > src/app.py"},
                )
            ),
        )
        self.rec(
            G,
            "BYPASS? MultiEdit src/",
            "deny",
            tw(
                dict(
                    edit(s, p + "/src/app.py"),
                    tool_name="MultiEdit",
                    tool_input={"file_path": p + "/src/app.py", "edits": []},
                )
            ),
        )
        self.rec(
            G,
            "BYPASS? prose 'goal:' substitutes GOAL block",
            "deny",
            tw(disp(s, SPEC.replace("GOAL: do x", "the goal: do x"))),
        )
        self.rec(
            G,
            "BYPASS? 'not serena' decoy passes TOOLS",
            "deny",
            tw(
                disp(
                    s,
                    SPEC.replace(
                        TOOLS, "ToolSearch nothing; never use serena or lean-ctx"
                    ),
                )
            ),
        )
        s3 = sid()
        self.orchestrating(s3, n_inline=6)
        self.rec(
            G,
            "deny: 7th inline Bash op w/o dispatch",
            "deny",
            tw(
                dict(
                    edit(s3, ""), tool_name="Bash", tool_input={"command": "make build"}
                )
            ),
        )
        s4 = sid()
        self.orchestrating(s4, n_inline=5)
        self.rec(
            G,
            "allow: 6th inline Bash op",
            "allow",
            tw(
                dict(
                    edit(s4, ""), tool_name="Bash", tool_input={"command": "make build"}
                )
            ),
        )
        corrupt = self.ctx.sub("gates") / "corrupt.db"
        corrupt.write_bytes(os.urandom(4096))
        self.rec(
            G,
            "FAIL-OPEN? corrupt DB + Edit src/ orchestrating",
            "allow",
            tw(edit(s, p + "/src/app.py"), {"ATLAS_DB": str(corrupt)}),
        )

    def completion_gate(self):
        G, sid = "completion_gate", self.sb.sid
        cg = lambda p, extra=None, cwd=None: self.hook(
            "completion_gate.py", p, extra, cwd
        )  # noqa: E731

        def stop(s, **k):
            return dict(
                session_id=s,
                cwd=self.proj,
                hook_event_name="Stop",
                transcript_path=self.sb.tp,
                stop_hook_active=k.pop("sha", False),
                last_assistant_message=k.pop("msg", "ATLAS | s done | all good"),
                **k,
            )

        sA = sid()
        self.mkrun(sA)
        self.rec(
            G,
            "deny: orchestrating run shipped code, no evidence",
            "block",
            cg(stop(sA)),
        )
        self.rec(
            G, "allow: stop_hook_active (block-once)", "allow", cg(stop(sA, sha=True))
        )
        self.rec(
            G, "allow: ATLAS_GATE=off", "allow", cg(stop(sA), {"ATLAS_GATE": "off"})
        )
        nomem = self.ctx.sub("gates") / "nomem"
        self.rec(G, "allow: no-docs project", "allow", cg(stop(sid()), cwd=str(nomem)))
        sB = sid()
        self.mkrun(sB, orchestrating=False)
        self.rec(
            G, "deny: NON-orchestrating inline edit, no dispatch", "block", cg(stop(sB))
        )
        sB2 = sid()
        self.mkrun(sB2, orchestrating=False, edit=False)
        self.rec(G, "allow: non-orchestrating run, no edits", "allow", cg(stop(sB2)))
        sB3 = sid()
        self.mkrun(sB3, orchestrating=False, edit=True, dispatch=True)
        self.rec(G, "allow: non-orchestrating edit + dispatch", "allow", cg(stop(sB3)))
        sC = sid()
        self.mkrun(sC)
        self.rec(
            G,
            "allow: in-flight subagent in background_tasks",
            "allow",
            cg(
                stop(
                    sC,
                    background_tasks=[
                        {"type": "subagent", "status": "running", "id": "a"}
                    ],
                )
            ),
        )
        self.rec(
            G,
            "block: in-flight shell task must NOT suppress",
            "block",
            cg(
                stop(
                    sC,
                    background_tasks=[
                        {"type": "shell", "status": "running", "id": "a"}
                    ],
                )
            ),
        )
        sE = sid()
        self.mkrun(sE, edit=False)
        self.rec(
            G,
            "deny: orchestrating no-code run, no ATLAS header",
            "block",
            cg(stop(sE, msg="all done, nothing else")),
        )
        sE2 = sid()
        self.mkrun(sE2, edit=False)
        self.rec(G, "allow: header present", "allow", cg(stop(sE2)))
        sD = sid()
        self.mkrun(sD)
        time.sleep(1.1)
        p = Path(self.proj)
        (p / ".atlas/evidence/2026-10-06-ev.md").write_text("evidence\n")
        (p / ".atlas/.run/findings.json").write_text(
            json.dumps(
                [
                    {
                        "id": "s1",
                        "status": "verified",
                        "evidence": "pytest",
                        "reproduction": "pytest",
                        "verified_at": time.strftime(
                            "%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()
                        ),
                    }
                ]
            )
        )
        with open(p / "docs/CHANGELOG.md", "a") as f:
            f.write("- 2026-10-06 shipped x\n")
        self.rec(G, "allow: evidence+findings+changelog present", "allow", cg(stop(sD)))


def probe_gate_correctness(ctx):
    cmd = CMD + "gate_correctness"
    names = ["gate_probes_correct", "gate_probes_mismatch"]
    g = Gates(ctx)
    if not g.proj:
        return [
            skipped(n, "no non-temp sandbox dir", "cases", group="gates") for n in names
        ]
    for fn in (
        g.recall_gate,
        g.worker_report_gate,
        g.fallow_gate,
        g.dispatch_tripwire,
        g.completion_gate,
    ):
        fn()
    res = g.results
    bad = [r for r in res if not r["ok"]]
    out = [
        metric("gate_probes_total", len(res), "cases", "info", cmd=cmd, group="gates"),
        metric(
            "gate_probes_correct",
            len(res) - len(bad),
            "cases",
            "higher",
            cmd=cmd,
            group="gates",
        ),
        metric(
            "gate_probes_mismatch",
            len(bad),
            "cases",
            "lower",
            cmd=cmd,
            group="gates",
            detail=[
                f"{r['gate']}: {r['case']} expect={r['expect']} got={r['got']}"
                for r in bad
            ],
        ),
    ]
    for gate in dict.fromkeys(r["gate"] for r in res):
        out.append(
            metric(
                f"gate_mismatch_{gate}",
                sum(1 for r in bad if r["gate"] == gate),
                "cases",
                "lower",
                cmd=cmd,
                group="gates",
            )
        )
    out.append(
        metric(
            "gate_probe_faults",
            sum(r["faults"] for r in res),
            "faults",
            "info",
            cmd=cmd,
            group="gates",
        )
    )
    return out


# -- dispatch spec decoys / worker report nonsense ---------------------------------
def probe_dispatch_spec(ctx):
    cmd = CMD + "dispatch_spec"
    names = ["dispatch_spec_decoy_denied", "dispatch_spec_empty_denied"]
    g = Gates(ctx)
    if not g.proj:
        return [
            skipped(n, "no non-temp sandbox dir", "cases", "higher", cmd, "gates")
            for n in names
        ]
    s = g.sb.sid()
    g.orchestrating(s)

    def verdict(prompt):
        r = g.hook(
            "dispatch_tripwire.py",
            dict(
                session_id=s,
                cwd=g.proj,
                hook_event_name="PreToolUse",
                tool_name="Agent",
                tool_input=dict(
                    subagent_type="atlas:implementer", prompt=prompt, name="W1"
                ),
                transcript_path=g.sb.tp,
            ),
        )
        return core.hook_decision(r["out"])

    labels = [
        "GOAL",
        "DELIVERABLE",
        "SUCCESS CRITERIA",
        "OUT OF SCOPE",
        "STOP CONDITIONS",
        "REPORT",
    ]
    decoys = {
        "keywords-in-prose": "fix it. (goal: deliverable: success criteria: out of scope: stop conditions: report:)\n"
        + TOOLS,
        "prose-goal-label": SPEC.replace("GOAL: do x", "the goal: do x"),
        "negated-tools": SPEC.replace(
            TOOLS, "ToolSearch nothing; never use serena or lean-ctx"
        ),
        "subgoal-substring": "SUBGOAL: a\n"
        + "\n".join(f"{x}:" for x in labels[1:])
        + "\n"
        + TOOLS,
        "tools-words-in-prose": SPEC.replace(
            TOOLS, "I considered ToolSearch and serena earlier but did not use them."
        ),
    }
    empty = {
        f"empty-{lab.lower().replace(' ', '-')}": SPEC.replace(
            f"{lab}: ", f"{lab}:", 1
        ).replace(
            f"{lab}:" + SPEC.split(f"{lab}:", 1)[1].split("\n", 1)[0], f"{lab}:", 1
        )
        for lab in labels[:5]
    }
    empty["all-labels-empty"] = "\n".join(f"{x}:" for x in labels) + "\n" + TOOLS
    denied_d = {k: verdict(v) == "deny" for k, v in decoys.items()}
    denied_e = {k: verdict(v) == "deny" for k, v in empty.items()}
    return [
        metric(
            "dispatch_spec_decoy_total",
            len(denied_d),
            "cases",
            "info",
            cmd=cmd,
            group="gates",
        ),
        metric(
            "dispatch_spec_decoy_denied",
            sum(denied_d.values()),
            "cases",
            "higher",
            cmd=cmd,
            group="gates",
            detail=[k for k, v in denied_d.items() if not v],
        ),
        metric(
            "dispatch_spec_empty_total",
            len(denied_e),
            "cases",
            "info",
            cmd=cmd,
            group="gates",
        ),
        metric(
            "dispatch_spec_empty_denied",
            sum(denied_e.values()),
            "cases",
            "higher",
            cmd=cmd,
            group="gates",
            detail=[k for k, v in denied_e.items() if not v],
        ),
    ]


def probe_report_gate(ctx):
    cmd = CMD + "report_gate"
    names = ["worker_report_nonsense_accepted", "worker_report_valid_blocked"]
    g = Gates(ctx)
    if not g.proj:
        return [skipped(n, "no sandbox dir", "cases", group="gates") for n in names]

    def blocked(msg):
        r = g.hook(
            "worker_report_gate.py",
            dict(
                session_id=g.sb.sid(),
                hook_event_name="SubagentStop",
                agent_type="atlas:implementer",
                agent_id="a" + uuid.uuid4().hex[:8],
                last_assistant_message=msg,
                cwd=g.proj,
            ),
        )
        return core.hook_decision(r["out"]) == "block"

    hdr = "STATUS: DONE\n"
    nonsense = {
        "steps-banana": hdr
        + "STEPS: banana\nFILES_CHANGED: x\nEVIDENCE:\nDELIVERABLE:\nNEXT:",
        "steps-9-of-3-empty-evidence": hdr
        + "STEPS: 9/3\nFILES_CHANGED: x\nEVIDENCE:\nDELIVERABLE: done\nNEXT: none",
        "done-empty-evidence": hdr
        + "STEPS: 1/1\nFILES_CHANGED: none\nEVIDENCE:\nDELIVERABLE: everything\nNEXT: none",
        "empty-deliverable": hdr
        + "STEPS: 1/1\nFILES_CHANGED: none\nEVIDENCE:\n1. x\nDELIVERABLE:\nNEXT: none",
        "fabricated-files": hdr
        + "STEPS: 9/9\nFILES_CHANGED: src/never_touched.py\nEVIDENCE:\nDELIVERABLE: everything fixed\nNEXT: none",
        "done-with-failing-evidence": hdr
        + "STEPS: 3/3\nFILES_CHANGED: none\nEVIDENCE:\n1. pytest -> 5 failed, 2 passed\nDELIVERABLE: fixed\nNEXT: none",
    }
    accepted = {k: not blocked(v) for k, v in nonsense.items()}
    return [
        metric(
            "worker_report_nonsense_total",
            len(accepted),
            "cases",
            "info",
            cmd=cmd,
            group="gates",
        ),
        metric(
            "worker_report_nonsense_accepted",
            sum(accepted.values()),
            "cases",
            "lower",
            cmd=cmd,
            group="gates",
            detail=[k for k, v in accepted.items() if v],
        ),
        metric(
            "worker_report_valid_blocked",
            int(blocked(GOOD_REPORT)),
            "cases",
            "lower",
            cmd=cmd,
            group="gates",
        ),
    ]


def probe_credwatch(ctx):
    """connector_credential_watch: false 'stale credential' orders on successful data."""
    cmd = CMD + "credwatch"
    sb = Sandbox(ctx, "credwatch")
    txt = lambda t, err=False: {
        "content": [{"type": "text", "text": t}],
        **({"isError": True} if err else {}),
    }  # noqa: E731
    must_silent = [
        (
            "blumira-finding-text",
            "mcp__plugin_atlas_blumira__blumira_findings_list",
            txt(
                json.dumps(
                    {
                        "data": [
                            {
                                "name": "Unauthorized login attempt from 1.2.3.4",
                                "priority": 2,
                            }
                        ]
                    }
                )
            ),
        ),
        (
            "vanta-count-403",
            "mcp__plugin_atlas_vanta__vanta_tests_list",
            txt(json.dumps({"totalCount": 403, "results": []})),
        ),
        (
            "falcon-forbidden-text",
            "mcp__plugin_atlas_falcon__falcon_search_detections",
            txt("Forbidden process execution blocked by policy"),
        ),
        (
            "ninja-id-401",
            "mcp__plugin_atlas_ninjaone__ninjaone_devices_get",
            txt('{"id": 401, "name":"pc"}'),
        ),
        ("clean", "mcp__plugin_atlas_auvik__auvik_status", txt('{"ok":true}')),
    ]
    must_warn = [
        (
            "real-401",
            "mcp__plugin_atlas_connectwise__cw_search_tickets",
            txt("HTTP 401 Unauthorized: Invalid Token", True),
        )
    ]

    def warns(tool, resp):
        r = sb.run(
            "connector_credential_watch.py",
            {
                "tool_name": tool,
                "session_id": sb.sid(),
                "tool_response": resp,
                "hook_event_name": "PostToolUse",
            },
        )
        return bool(r["out"].strip())

    fp = [n for n, t, r in must_silent if warns(t, r)]
    tp = [n for n, t, r in must_warn if warns(t, r)]
    return [
        metric(
            "credwatch_false_positives",
            len(fp),
            "cases",
            "lower",
            cmd=cmd,
            group="gates",
            detail=fp,
        ),
        metric(
            "credwatch_true_positives",
            len(tp),
            "cases",
            "higher",
            cmd=cmd,
            group="gates",
        ),
        metric(
            "credwatch_cases",
            len(must_silent) + len(must_warn),
            "cases",
            "info",
            cmd=cmd,
            group="gates",
        ),
    ]


PROBES = [
    (
        "gate_correctness",
        probe_gate_correctness,
        ["gate_probes_correct", "gate_probes_mismatch"],
        False,
    ),
    (
        "dispatch_spec",
        probe_dispatch_spec,
        ["dispatch_spec_decoy_denied", "dispatch_spec_empty_denied"],
        False,
    ),
    (
        "report_gate",
        probe_report_gate,
        ["worker_report_nonsense_accepted", "worker_report_valid_blocked"],
        False,
    ),
    ("credwatch", probe_credwatch, ["credwatch_false_positives"], False),
]
