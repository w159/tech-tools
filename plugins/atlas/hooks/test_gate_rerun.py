"""Tests for hooks/gate_rerun.py and its wiring into the completion gate.

The gate re-runs the session's own last test command at Stop and lets the exit code stand in for the
evidence / findings / verifier / plan / phase / delegation paperwork of (a)(b)(g)(k)(m)(o)."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402
import json  # noqa: E402
import os  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import unittest  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from pathlib import Path  # noqa: E402
from unittest import mock  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_crew_seal  # noqa: E402
import gate_rerun  # noqa: E402
from test_completion_gate import GateOrchestrationTest, _run_gate  # noqa: E402

PASSING = "def test_ok():\n    assert 1 + 1 == 2\n"
FAILING = "def test_bad():\n    assert 1 + 1 == 3\n"


def _write_summary(run, summary, sealed=True):
    """summary.json in `run`: signed by a fresh seal record the way the engine does, or (sealed=False) bare, as a forger writes it."""
    run = Path(run)
    if sealed:
        atlas_crew_seal.create(run, run.name)
    (run / "summary.json").write_text(json.dumps(atlas_crew_seal.sign(run, summary) if sealed else summary))


def _venv_python(root):
    """root/.venv/bin/python: a wrapper around this interpreter, so the tests need no system pytest
    (and exercise the project-local runner rule). Returns the relative command prefix."""
    bindir = Path(root) / ".venv" / "bin"
    bindir.mkdir(parents=True, exist_ok=True)
    wrapper = bindir / "python"
    wrapper.write_text(f'#!/bin/sh\nexec "{sys.executable}" "$@"\n', encoding="utf-8")
    wrapper.chmod(0o755)
    return ".venv/bin/python"


def _iso(epoch=None):
    return datetime.fromtimestamp(epoch or time.time(), timezone.utc).isoformat()


_SEQ = [0]
CREW_SCRIPT = sorted(gate_rerun._crew_scripts())[0]
LAUNCH_OUT = json.dumps({"ok": True, "run": "r1", "workers": ["a"], "next": "atlas_crew.py wait --run r1"})
SUMMARY_OUT = json.dumps({"ok": True, "run": "r1", "check": "pytest", "check_exit": 0, "workers": [{"name": "a"}]})
REFUSAL_OUT = json.dumps({"ok": False, "error": "run 'r1' was never started by the crew engine (no supervisor.pid)"})
CREW_RUN = f"python3 {CREW_SCRIPT} run --plan plan.json --no-tmux --session sess-1"


def _bash_line(cmd, ts=None, sidechain=False, result="ok", is_error=False, output="1 passed"):
    """A Bash tool_use line, plus its tool_result line unless `result` is None (a call that never ran)."""
    _SEQ[0] += 1
    tid = f"toolu_{_SEQ[0]}"
    when = ts or _iso()
    use = json.dumps(
        {
            "type": "assistant",
            "isSidechain": sidechain,
            "timestamp": when,
            "message": {
                "content": [{"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": cmd}}]
            },
        }
    )
    if result is None:
        return use
    res = json.dumps(
        {
            "type": "user",
            "isSidechain": sidechain,
            "timestamp": when,
            "message": {
                "content": [
                    {"type": "tool_result", "tool_use_id": tid, "is_error": is_error, "content": output}
                ]
            },
        }
    )
    return use + "\n" + res


class NormalizeTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "pkg").mkdir()

    def test_accepts_plain_runners(self):
        for cmd in (
            "python3 -m pytest -q",
            "pytest -x tests/test_a.py",
            "uv run pytest -q",
            "npm test",
            "go test ./...",
            "cargo test",
            "make test",
            "python3 -m pytest -q 2>&1 | tail -5",
            "python3 -m pytest -q 2>&1 | tail -n 20",
        ):
            self.assertIsNotNone(gate_rerun.normalize(cmd, self.root), cmd)

    def test_cd_inside_root_sets_cwd(self):
        argv, cwd = gate_rerun.normalize(f"cd {self.root / 'pkg'} && python3 -m pytest -q", self.root)
        self.assertEqual(argv, ["python3", "-m", "pytest", "-q"])
        self.assertEqual(cwd, (self.root / "pkg").resolve())
        argv, cwd = gate_rerun.normalize("cd pkg && pytest", self.root)
        self.assertEqual(cwd, (self.root / "pkg").resolve())

    def test_accepts_project_local_runners(self):
        for cmd in (
            ".venv/bin/python -m pytest -q",
            "./.venv/bin/python3 -m pytest -x tests",
            "venv/bin/python3.12 -m pytest -q 2>&1 | tail -5",
            ".venv/bin/pytest -q",
            f"{self.root}/.venv/bin/python -m pytest -q",
            "cd pkg && ../.venv/bin/python -m pytest -q",
        ):
            norm = gate_rerun.normalize(cmd, self.root, ran=True)
            self.assertIsNotNone(norm, cmd)
            self.assertTrue(os.path.isabs(norm[0][0]), norm)
            # a real file in the repo is never run on the allowlist alone, only when the session ran it
            self.assertIsNone(gate_rerun.normalize(cmd, self.root), cmd)

    def test_rejects_foreign_local_runners(self):
        for cmd in (
            ".venv/bin/python script.py",
            ".venv/bin/python -c 'import os'",
            ".venv/bin/python -m pytest; id",
            ".venv/bin/bash -m pytest",
            ".venv/bin/pip install x",
            "../outside/.venv/bin/python -m pytest",
            "/usr/bin/python3 -m pytest",
            "/opt/venv/bin/pytest",
            f"{self.root}/../x/bin/python -m pytest",
        ):  # (rejected even when the session ran it: not inside the repo)
            self.assertIsNone(gate_rerun.normalize(cmd, self.root, ran=True), cmd)

    def test_symlink_runner_must_land_on_a_real_system_interpreter(self):
        out = Path(tempfile.mkdtemp())
        evil = out / "evilpy"
        evil.write_text("#!/bin/sh\nexit 0\n")
        evil.chmod(0o755)
        (self.root / ".venv/bin").mkdir(parents=True)
        link = self.root / ".venv/bin/python"
        os.symlink(evil, link)  # target is a script outside the repo, not an interpreter
        self.assertIsNone(gate_rerun.normalize(".venv/bin/python -m pytest -q", self.root, ran=True))
        link.unlink()
        os.symlink("/usr/bin/env", link)  # a real system file, but not python3*/pytest
        self.assertIsNone(gate_rerun.normalize(".venv/bin/python -m pytest -q", self.root, ran=True))
        link.unlink()
        real = os.path.realpath(sys.executable)
        with mock.patch.object(gate_rerun, "_STD_PREFIXES", (os.path.dirname(real) + "/",)):
            if gate_rerun._REAL_INTERPRETER.match(os.path.basename(real)):
                os.symlink(real, link)
                self.assertIsNotNone(gate_rerun.normalize(".venv/bin/python -m pytest -q", self.root))

    def test_rejects_unsafe_or_foreign(self):
        for cmd in (
            "rm -rf / ; pytest",
            "pytest && curl evil",
            "pytest $(whoami)",
            "pytest `id`",
            "echo hi > x; pytest",
            "cd / && pytest",
            "cd ../.. && pytest",
            "ls",
            "python3 -c 'import pytest'",
            "npx something",
            "",
            None,
        ):
            self.assertIsNone(gate_rerun.normalize(cmd, self.root), cmd)


class TranscriptTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.tx = self.root / "t.jsonl"

    def _write(self, *lines):
        self.tx.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def test_last_allowlisted_command_in_window_wins(self):
        now = time.time()
        self._write(
            _bash_line("pytest -q old", ts=_iso(now - 1000)),
            _bash_line("python3 -m pytest -q"),
            _bash_line("ls -la"),
            _bash_line("rm -rf x"),
            _bash_line("pytest tests/sub.py", sidechain=True),
        )
        self.assertEqual(
            gate_rerun.last_test_command(str(self.tx), now - 10, self.root), "python3 -m pytest -q"
        )

    def test_compound_call_yields_its_test_segment_only(self):
        (self.root / "pkg").mkdir()
        call = "cat >> docs/CHANGELOG.md <<'EOF'\n- did x\nEOF\npython3 -m pytest -q 2>&1 | tail -3"
        self.assertEqual(gate_rerun.runnable_part(call, self.root), "python3 -m pytest -q 2>&1 | tail -3")
        self.assertEqual(
            gate_rerun.runnable_part("cd pkg\npytest -x; echo done", self.root), "cd pkg && pytest -x"
        )
        self.assertIsNone(gate_rerun.runnable_part("rm -rf build && make", self.root))
        self._write(_bash_line(call))
        self.assertEqual(
            gate_rerun.last_test_command(str(self.tx), None, self.root), "python3 -m pytest -q 2>&1 | tail -3"
        )

    def test_none_without_test_or_transcript(self):
        self._write(_bash_line("ls"))
        self.assertIsNone(gate_rerun.last_test_command(str(self.tx), None, self.root))
        self.assertIsNone(gate_rerun.last_test_command("", None, self.root))
        self.assertIsNone(gate_rerun.last_test_command(str(self.root / "missing"), None, self.root))
        self.assertIsNone(gate_rerun.last_test_command("/x/subagents/a.jsonl", None, self.root))


class RerunProofTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "app.py").write_text("x = 1\n")

    def test_green_rerun_writes_evidence_finding_and_valid_proof(self):
        (self.root / "test_ok.py").write_text(PASSING)
        result = gate_rerun.rerun(f"{sys.executable} -m pytest -q -p no:cacheprovider", self.root)
        # sys.executable is an absolute path outside the project, not an allowlisted runner
        self.assertIsNone(result)
        py = _venv_python(self.root)
        result = gate_rerun.rerun(f"{py} -m pytest -q -p no:cacheprovider", self.root, ran=True)
        self.assertEqual(result["exit"], 0, result["tail"])
        started = time.time() - 60
        proof = gate_rerun.write_proof(self.root, "sess-1", result)
        self.assertTrue((self.root / proof["evidence"]).is_file())
        findings = json.loads((self.root / ".atlas/.run/findings.json").read_text())
        self.assertEqual(findings[-1]["status"], "verified")
        self.assertEqual(findings[-1]["verified_by"], "completion-gate")
        self.assertIsNotNone(gate_rerun.valid_proof(self.root, "sess-1", started, ["app.py"]))
        self.assertIsNone(gate_rerun.valid_proof(self.root, "other", started, ["app.py"]))
        self.assertIsNone(gate_rerun.valid_proof(self.root, "sess-1", time.time() + 60, ["app.py"]))
        # a docs edit after the re-run keeps the proof, a code edit invalidates it
        later = time.time() + 5
        (self.root / "CHANGELOG.md").write_text("x\n")
        os.utime(self.root / "CHANGELOG.md", (later, later))
        self.assertIsNotNone(gate_rerun.valid_proof(self.root, "sess-1", started, ["app.py", "CHANGELOG.md"]))
        os.utime(self.root / "app.py", (later, later))
        self.assertIsNone(gate_rerun.valid_proof(self.root, "sess-1", started, ["app.py"]))
        with mock.patch.dict(os.environ, {"ATLAS_GATE_RERUN": "off"}):
            self.assertIsNone(gate_rerun.valid_proof(self.root, "sess-1", started, []))

    def test_red_rerun_reports_exit_and_tail(self):
        (self.root / "test_bad.py").write_text(FAILING)
        py = _venv_python(self.root)
        result = gate_rerun.rerun(f"{py} -m pytest -q -p no:cacheprovider", self.root, ran=True)
        self.assertNotEqual(result["exit"], 0)
        self.assertFalse(result["inconclusive"])
        self.assertIn("1 failed", result["tail"])

    def test_timeout_is_inconclusive_not_red(self):
        (self.root / "test_slow.py").write_text("import time\n\ndef test_slow():\n    time.sleep(60)\n")
        py = _venv_python(self.root)
        with mock.patch.dict(os.environ, {"ATLAS_GATE_RERUN_TIMEOUT": "5"}):
            result = gate_rerun.rerun(f"{py} -m pytest -q -p no:cacheprovider", self.root, ran=True)
        self.assertEqual(result["exit"], 124)
        self.assertTrue(result["inconclusive"])
        self.assertLess(result["seconds"], 15)

    def test_timeout_is_clamped_under_the_stop_hook_timeout(self):
        hooks = json.loads((Path(__file__).parent / "hooks.json").read_text())
        gate_timeouts = [
            h["timeout"]
            for group in hooks["hooks"]["Stop"]
            for h in group["hooks"]
            if h["command"].endswith('completion_gate.py"')
        ]
        self.assertEqual(len(gate_timeouts), 1)
        with mock.patch.dict(os.environ, {"ATLAS_GATE_RERUN_TIMEOUT": "9999"}):
            self.assertLessEqual(gate_rerun._timeout(), gate_timeouts[0] - 30)
        with mock.patch.dict(os.environ, {"ATLAS_GATE_RERUN_TIMEOUT": "nan"}):
            self.assertEqual(gate_rerun._timeout(), gate_rerun.DEFAULT_TIMEOUT)

    def test_timed_out_command_is_remembered_per_session(self):
        self.assertFalse(gate_rerun.timed_out_before(self.root, "s1", "pytest -q"))
        gate_rerun.note_timed_out(self.root, "s1", "pytest -q")
        self.assertTrue(gate_rerun.timed_out_before(self.root, "s1", "pytest -q"))
        self.assertFalse(gate_rerun.timed_out_before(self.root, "s2", "pytest -q"))
        self.assertFalse(gate_rerun.timed_out_before(self.root, "s1", "pytest -x"))

    def _path_without_pytest(self):
        fake = Path(tempfile.mkdtemp())
        stub = fake / "python3"
        stub.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
        stub.chmod(0o755)
        return str(fake)

    def test_hook_python_without_pytest_falls_back_to_project_venv(self):
        (self.root / "test_ok.py").write_text(PASSING)
        # .venv/bin/python is a symlink to a real interpreter (here a wrapper named python3 that sits in a
        # directory the test declares a standard prefix), as a real venv's is
        tools = Path(tempfile.mkdtemp())
        _venv_python(tools)
        os.rename(tools / ".venv/bin/python", tools / "python3")
        (self.root / ".venv/bin").mkdir(parents=True)
        os.symlink(tools / "python3", self.root / ".venv/bin/python")
        with mock.patch.dict(os.environ, {"PATH": self._path_without_pytest()}), mock.patch.object(
            gate_rerun, "_STD_PREFIXES", (os.path.realpath(tools) + "/",)
        ):
            result = gate_rerun.rerun("python3 -m pytest -q -p no:cacheprovider", self.root)
        self.assertEqual(result["exit"], 0, result["tail"])
        self.assertFalse(result["inconclusive"])
        self.assertTrue(result["argv"][0].endswith(".venv/bin/python"), result["argv"])

    def test_fallback_never_probe_runs_a_file_the_repo_planted(self):
        out = Path(tempfile.mkdtemp())
        planted = self.root / ".venv/bin/python"
        planted.parent.mkdir(parents=True)
        planted.write_text(f'#!/bin/sh\necho ran >> {out}/PWNED\nexit 1\n')
        planted.chmod(0o755)
        with mock.patch.dict(os.environ, {"PATH": self._path_without_pytest()}):
            result = gate_rerun.rerun("python3 -m pytest -q", self.root)
        self.assertTrue(result["inconclusive"])
        self.assertFalse((out / "PWNED").exists())

    def test_in_repo_file_named_pytest_is_not_run_unless_the_session_ran_it(self):
        out = Path(tempfile.mkdtemp())
        tool = self.root / "tools/pytest"
        tool.parent.mkdir()
        tool.write_text(f"#!/bin/sh\necho ran >> {out}/PWNED\nexit 0\n")
        tool.chmod(0o755)
        self.assertIsNone(gate_rerun.rerun("./tools/pytest -q", self.root))
        self.assertFalse((out / "PWNED").exists())

    def test_pytest_usage_error_and_nothing_collected_are_inconclusive(self):
        (self.root / "test_ok.py").write_text(PASSING)
        py = _venv_python(self.root)
        none_selected = gate_rerun.rerun(f"{py} -m pytest -q -p no:cacheprovider -k zzz_nomatch", self.root, ran=True)
        self.assertEqual(none_selected["exit"], 5)
        self.assertTrue(none_selected["inconclusive"])
        bad_flag = gate_rerun.rerun(f"{py} -m pytest -q --no-such-flag", self.root, ran=True)
        self.assertEqual(bad_flag["exit"], 4)
        self.assertTrue(bad_flag["inconclusive"])

    def test_hook_denials_and_tool_errors_are_not_executed(self):
        tx = self.root / "t.jsonl"
        denials = (
            "PreToolUse:Bash hook error: DENY - 6 inline ops since your last dispatch.",
            "<tool_use_error>Blocked: this command is not allowed</tool_use_error>",
            "Permission to use Bash has been denied.",
            "Error: something else broke",
        )
        tx.write_text("\n".join(
            _bash_line(f"pytest -q d{i}", is_error=True, output=text) for i, text in enumerate(denials)
        ) + "\n")
        self.assertEqual(gate_rerun.executed_bash(str(tx), None), [])
        tx.write_text(_bash_line("pytest -q x", is_error=True, output="Exit code 1\n2 failed") + "\n")
        self.assertEqual([c for c, _ in gate_rerun.executed_bash(str(tx), None)], ["pytest -q x"])

    def test_crew_launch_must_invoke_the_engine_itself(self):
        started = time.time() - 60
        green = {"ok": True, "check_exit": 0, "check": "pytest", "run": "r1"}
        for cmd in (
            "echo atlas_crew r1",
            f"echo {CREW_SCRIPT} run r1",
            f"echo 'python3 {CREW_SCRIPT} run r1'",
            f"python3 /tmp/elsewhere/atlas_crew.py run r1",
            f"python3 {CREW_SCRIPT} status --run r1",
            f"cat {CREW_SCRIPT}",
        ):
            tx = self._crew_run(green)
            Path(tx).write_text(_bash_line(cmd, output=LAUNCH_OUT) + "\n")
            self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx), cmd)
        tx = self._crew_run(green)
        Path(tx).write_text(_bash_line(f"python3 {CREW_SCRIPT} run --plan p.json --wait 60", output=SUMMARY_OUT) + "\n")
        self.assertIsNotNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx))
        # a `wait` alone earns nothing, whatever it printed
        Path(tx).write_text(_bash_line(f"python3 {CREW_SCRIPT} wait --run r1 --root .", output=SUMMARY_OUT) + "\n")
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx))

    def test_crew_launch_forms_a_lead_really_types(self):
        script = CREW_SCRIPT
        plugin = os.path.dirname(os.path.dirname(script))
        repo = os.path.dirname(os.path.dirname(plugin))  # .../tech-tools when run from the repo
        rel = os.path.relpath(script, repo)
        with mock.patch.dict(os.environ, {"CLAUDE_PLUGIN_ROOT": plugin}):
            accepted = {
                "absolute": f"python3 {script} run --plan p.json",
                "braced var, quoted": 'python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_crew.py" run --plan p.json',
                "bare var": "python3 $CLAUDE_PLUGIN_ROOT/scripts/atlas_crew.py run --run-id r1",
                "quoted var then path": 'python3 "$CLAUDE_PLUGIN_ROOT"/scripts/atlas_crew.py run',
                "-S": f"python3 -S {script} run",
                "-u": f"python3 -u {script} run --run-id r1",
                "-S -u": f"python3 -S -u {script} run",
                "/usr/bin/python3": f"/usr/bin/python3 {script} run",
                "python3.12": f"python3.12 {script} run",
                "uv run python": f"uv run python {script} run",
                "uv run --quiet python": f"uv run --quiet python {script} run",
                "cd then abs": f"cd /tmp && python3 {script} run",
                "VAR=x prefix": f"ATLAS_X=1 python3 {script} run",
                "two env prefixes": f"A=1 B=2 python3 {script} run",
                "after other commands": f"cd {repo} && echo hi; python3 {script} run --no-tmux",
                "piped": f"python3 {script} run --plan p.json 2>&1 | tail -5",
            }
            for name, cmd in accepted.items():
                self.assertTrue(gate_rerun._invokes_crew(cmd, ""), name)
            # relative path: against the session cwd, or a preceding cd
            self.assertTrue(gate_rerun._invokes_crew(f"python3 {rel} run", repo))
            self.assertTrue(gate_rerun._invokes_crew(f"cd {repo} && python3 {rel} run", "/elsewhere"))
            self.assertTrue(gate_rerun._invokes_crew(f"cd {os.path.dirname(repo)} && cd {os.path.basename(repo)} && python3 {rel} run --run-id r", ""))
            self.assertFalse(gate_rerun._invokes_crew(f"python3 {rel} run", ""), "relative with no cwd")
            self.assertFalse(gate_rerun._invokes_crew(f"python3 {rel} run", "/elsewhere"))
            refused = {
                "other variable": 'python3 "${HOME}/x/atlas_crew.py" run',
                "var expanded to nothing else": 'python3 "$EVIL/scripts/atlas_crew.py" run',
                "command substitution": f"python3 $(echo {script}) run",
                "-m": f"python3 -m {script} run",
                "-c": f"python3 -c {script} run",
                "echo": f"echo python3 {script} run",
                "echo env prefix": f"X=1 echo {script} run",
                "uv no run": f"uv python {script} run",
                "uv non-python": f"uv run cat {script} run",
                "wrong subcommand": f"python3 {script} status",
                "no subcommand": f"python3 {script}",
                "other tree": "python3 /tmp/elsewhere/atlas_crew.py run",
                "not an interpreter": f"bash {script} run",
            }
            for name, cmd in refused.items():
                self.assertFalse(gate_rerun._invokes_crew(cmd, ""), name)
        env = {k: v for k, v in os.environ.items() if k != "CLAUDE_PLUGIN_ROOT"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertFalse(gate_rerun._invokes_crew('python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_crew.py" run', ""))

    def test_transcript_cwd_resolves_a_relative_launch(self):
        started = time.time() - 60
        green = {"ok": True, "check_exit": 0, "check": "pytest", "run": "r1"}
        tx = self._crew_run(green)
        repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(CREW_SCRIPT))))
        rel = os.path.relpath(CREW_SCRIPT, repo)
        lines = _bash_line(f"python3 {rel} run --plan p.json", output=LAUNCH_OUT).splitlines()
        rec = [json.loads(x) for x in lines]
        rec[0]["cwd"] = repo
        Path(tx).write_text("\n".join(json.dumps(r) for r in rec) + "\n")
        self.assertIsNotNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx))
        rec[0]["cwd"] = "/elsewhere"
        Path(tx).write_text("\n".join(json.dumps(r) for r in rec) + "\n")
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx))
        # no cwd in the record: the Stop payload's cwd stands in
        for r in rec:
            r.pop("cwd", None)
        Path(tx).write_text("\n".join(json.dumps(r) for r in rec) + "\n")
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx))
        self.assertIsNotNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx, cwd=repo))

    def test_a_wait_refusal_on_a_forged_dir_credits_neither_green_nor_red(self):
        started = time.time() - 60
        wait = f"python3 {CREW_SCRIPT} wait --run r1 --root ."
        for summary in (
            {"ok": True, "check_exit": 0, "check": "pytest", "run": "r1"},
            {"ok": False, "check_exit": 1, "check": "pytest", "run": "r1"},
        ):
            tx = self._crew_run(summary)
            Path(tx).write_text(
                _bash_line(wait, is_error=True, output="Exit code 1\n" + REFUSAL_OUT) + "\n"
            )
            self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx), summary)
            self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx), summary)

    def test_engine_json_shapes(self):
        ej = gate_rerun._engine_json
        self.assertTrue(ej(SUMMARY_OUT, "r1"))
        self.assertTrue(ej("noise before\n" + LAUNCH_OUT + "\nnoise after", "r1"))
        self.assertTrue(ej("Exit code 1\n" + json.dumps({"run": "r1", "check_exit": 1, "ok": False, "workers": []}), "r1"))
        self.assertFalse(ej(REFUSAL_OUT, "r1"))
        self.assertFalse(ej(SUMMARY_OUT, "other"))
        self.assertFalse(ej(json.dumps({"run": "r1", "check_exit": 0, "workers": [], "error": "x"}), "r1"))
        self.assertFalse(ej(json.dumps({"run": "r1", "check_exit": 0}), "r1"))  # no workers list
        self.assertFalse(ej(json.dumps({"run": "r1", "check_exit": "0", "workers": []}), "r1"))
        self.assertFalse(ej(json.dumps({"ok": True, "run": "r1", "workers": []}), "r1"))  # not a launch object
        self.assertFalse(ej("r1", "r1"))
        self.assertFalse(ej('{"run": "r1", "workers": [', "r1"))

    def test_display_callers_without_a_transcript_use_the_engine_files(self):
        started = time.time() - 60
        green = {"ok": True, "check_exit": 0, "check": "pytest", "run": "r1"}
        self._crew_run(green)
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started))
        shown = gate_rerun.crew_proof(self.root, "sess-1", started, display=True)
        self.assertEqual(shown["crew_run"], "r1")
        self.assertFalse(shown["launch_checked"])
        self._crew_run(green, engine_made=False)  # a hand-made dir still shows nothing
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, display=True))

    def test_evaluate_passes_display_only_through_and_never_trusts_a_stop_payload_without_it(self):
        import completion_gate_core as cg

        seen = []

        def fake(root, session, started, run_paths=(), transcript_path="", display=False, cwd=""):
            seen.append((transcript_path, display))

        (self.root / "app.py").write_text("x = 1\n")
        for extra in ({}, {"display_only": True}):
            data = {"session_id": "s", "cwd": str(self.root), "transcript_path": "", **extra}
            with mock.patch.object(cg.gate_rerun, "crew_proof", fake), mock.patch.object(
                cg, "_run_written_paths", return_value=[str(self.root / "app.py")]
            ):
                cg.evaluate(data, self.root)
        self.assertEqual(seen, [("", False), ("", True)])

    def test_atlas_gates_finds_the_session_transcript(self):
        import atlas_gates

        home = Path(tempfile.mkdtemp())
        (home / ".claude/projects/p1").mkdir(parents=True)
        t = home / ".claude/projects/p1/abc-123.jsonl"
        t.write_text("")
        with mock.patch.dict(os.environ, {"HOME": str(home)}):
            self.assertEqual(atlas_gates._find_transcript("abc-123"), str(t))
            self.assertEqual(atlas_gates._find_transcript("nope"), "")
            self.assertEqual(atlas_gates._find_transcript("../x"), "")

    def test_only_executed_commands_are_returned_from_the_transcript(self):
        tx = self.root / "t.jsonl"
        denied = _bash_line("pytest -q denied", result="x", is_error=True,
                            output="The user doesn't want to proceed with this tool use.")
        tx.write_text("\n".join([
            _bash_line("pytest -q ran"),
            _bash_line("pytest -q never-ran", result=None),
            denied,
        ]) + "\n")
        self.assertEqual(gate_rerun.last_test_command(str(tx), None, self.root), "pytest -q ran")
        failing = _bash_line("pytest -q failing", result="x", is_error=True, output="Exit code 1\n1 failed")
        tx.write_text(failing + "\n")
        self.assertEqual(gate_rerun.last_test_command(str(tx), None, self.root), "pytest -q failing")

    def test_no_interpreter_with_pytest_is_inconclusive(self):
        (self.root / "test_ok.py").write_text(PASSING)
        with mock.patch.dict(os.environ, {"PATH": self._path_without_pytest()}):
            result = gate_rerun.rerun("python3 -m pytest -q -p no:cacheprovider", self.root)
        self.assertTrue(result["inconclusive"])
        self.assertNotEqual(result["exit"], 0)

    def test_findings_dict_shape_is_preserved(self):
        (self.root / ".atlas/.run").mkdir(parents=True)
        (self.root / ".atlas/.run/findings.json").write_text(json.dumps({"findings": [{"id": "x"}], "v": 2}))
        gate_rerun.write_proof(
            self.root, "s", {"command": "pytest", "cwd": str(self.root), "exit": 0, "tail": "", "seconds": 0}
        )
        data = json.loads((self.root / ".atlas/.run/findings.json").read_text())
        self.assertEqual(data["v"], 2)
        self.assertEqual([f["id"] for f in data["findings"]][0], "x")
        self.assertEqual(len(data["findings"]), 2)

    def test_crew_proof_needs_this_session_and_green_check(self):
        started = time.time() - 60
        green = {"ok": True, "check_exit": 0, "check": "pytest", "run": "r1"}
        tx = self._crew_run(green)
        self.assertEqual(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx)["crew_run"], "r1")
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-2", started, (), tx))
        self._crew_run({"ok": False, "check_exit": 1, "check": "pytest"})
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx))

    def test_crew_proof_is_not_credited_for_a_forged_green_summary(self):
        started = time.time() - 60
        green = {"ok": True, "check_exit": 0, "check": "pytest", "run": "r1"}
        for kwargs in ({"launched": False}, {"engine_made": False}):
            tx = self._crew_run(green, **kwargs)
            self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx), kwargs)
        tx = self._crew_run(green)
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started), "no transcript")
        Path(tx).write_text(_bash_line(CREW_RUN, result=None) + "\n")
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx), "launch never ran")

    def _crew_run(self, summary, launched=True, engine_made=True, sealed=True):
        run = self.root / ".atlas/.run/crew/r1"
        run.mkdir(parents=True, exist_ok=True)
        (run / "run.json").write_text(json.dumps({"lead_session": "sess-1", "run_id": "r1"}))
        _write_summary(run, summary, sealed)
        (run / "supervisor.log").unlink(missing_ok=True)
        if engine_made:
            (run / "supervisor.log").write_text("")
        tx = self.root / "crew-t.jsonl"
        tx.write_text(
            (_bash_line(CREW_RUN, output=LAUNCH_OUT) if launched else "")
            + "\n"
        )
        return str(tx)

    def _real_wait_out(self, run_id="r1"):
        """What a real `atlas_crew.py wait` prints over the run dir on disk (the engine, as a subprocess, with this process's ATLAS_HOME)."""
        res = subprocess.run(
            [sys.executable, CREW_SCRIPT, "wait", "--run", run_id, "--root", str(self.root), "--timeout", "1"],
            capture_output=True, text=True, timeout=30,
        )
        return res.returncode, res.stdout

    def _wait_tx(self, out):
        tx = self.root / "crew-wait.jsonl"
        tx.write_text(
            _bash_line(CREW_RUN, output=LAUNCH_OUT) + "\n"
            + _bash_line(f"python3 {CREW_SCRIPT} wait --run r1 --root {self.root}", output=out) + "\n"
        )
        return str(tx)

    def test_a_run_dir_forged_in_full_plus_a_real_wait_grants_no_crew_proof(self):
        started = time.time() - 60
        for ok, check_exit in ((True, 0), (False, 1)):
            summary = {"ok": ok, "check_exit": check_exit, "check": "pytest", "run": "r1", "workers": [{"name": "a"}]}
            self._crew_run(summary, sealed=False)  # run.json, supervisor.log, summary.json hand-written
            (self.root / ".atlas/.run/crew/r1/supervisor.pid").write_text("1")
            code, out = self._real_wait_out()
            self.assertEqual(code, 1, out)
            self.assertIn("error", json.loads(out))
            tx = self._wait_tx(out)
            self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx), ok)
            self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx), ok)
            # even a transcript that shows engine-looking output for the forged run buys nothing
            fake = self._wait_tx(json.dumps(summary))
            self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), fake), ok)
            self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), fake), ok)
            self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, display=True), ok)

    def test_a_sealed_run_still_earns_proof_and_an_edit_after_signing_does_not(self):
        started = time.time() - 60
        red = {"ok": False, "check_exit": 1, "check": "pytest", "run": "r1", "workers": [{"name": "a"}]}
        self._crew_run(red)
        (self.root / ".atlas/.run/crew/r1/supervisor.pid").write_text("1")
        code, out = self._real_wait_out()
        self.assertEqual(code, 1)  # a red summary: exit 1, but a verified one
        self.assertNotIn("error", json.loads(out))
        tx = self._wait_tx(out)
        self.assertEqual(gate_rerun.crew_red(self.root, "sess-1", started, (), tx)["crew_run"], "r1")
        edited = json.loads((self.root / ".atlas/.run/crew/r1/summary.json").read_text())
        edited.update(ok=True, check_exit=0)
        (self.root / ".atlas/.run/crew/r1/summary.json").write_text(json.dumps(edited))
        code, out = self._real_wait_out()
        self.assertEqual(code, 1)
        self.assertIn("error", json.loads(out))
        tx = self._wait_tx(json.dumps(edited))
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), tx))
        self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx))

    def test_a_real_engine_run_still_earns_proof(self):
        started = time.time() - 60
        fake = self.root / "bin" / "claude"
        fake.parent.mkdir()
        fake.write_text(f"#!/bin/sh\necho ok > {self.root}/z.py\necho '{{\"type\":\"result\",\"is_error\":false}}'\n")
        fake.chmod(0o755)
        plan = self.root / "plan.json"
        plan.write_text(json.dumps({"goal": "g", "check": "test -f z.py", "workers": [{"name": "zed", "owns": ["z.py"], "task": "t"}]}))
        env = {**os.environ, "ATLAS_CREW_TMUX": "off", "PATH": f"{fake.parent}{os.pathsep}{os.environ['PATH']}"}
        launch = f"python3 {CREW_SCRIPT} run --plan {plan} --root {self.root} --no-tmux --session sess-1 --run-id r1 --wait 60"
        res = subprocess.run(launch.replace("python3", sys.executable, 1).split(), capture_output=True, text=True, env=env, timeout=120)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        tx = self.root / "crew-live.jsonl"
        tx.write_text(_bash_line(launch, output=res.stdout) + "\n")
        proof = gate_rerun.crew_proof(self.root, "sess-1", started, (), str(tx))
        self.assertEqual(proof["crew_run"], "r1")
        self.assertEqual(proof["exit"], 0)
        # the same run after its summary is edited (red -> green is the forger's move; here green -> still green but altered)
        path = self.root / ".atlas/.run/crew/r1/summary.json"
        edited = json.loads(path.read_text())
        edited["check"] = "true"
        path.write_text(json.dumps(edited))
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), str(tx)))

    def test_a_forged_seal_and_a_real_wait_without_a_launch_earn_no_credit(self):
        started = time.time() - 60
        run = self.root / ".atlas/.run/crew/r1"
        run.mkdir(parents=True)
        (run / "run.json").write_text(json.dumps({"lead_session": "sess-1", "run_id": "r1"}))
        (run / "supervisor.log").write_text("")
        (run / "supervisor.pid").write_text("1")
        forge = (
            f"import sys; sys.path.insert(0, {os.path.dirname(CREW_SCRIPT)!r}); import atlas_crew_seal as s; "
            f"s.create({str(run)!r}, 'r1'); import json; "
            f"open({str(run / 'summary.json')!r}, 'w').write(json.dumps(s.sign({str(run)!r}, "
            "{'ok': True, 'check_exit': 0, 'check': 'pytest', 'run': 'r1', 'workers': [{'name': 'a'}]})))"
        )
        subprocess.run([sys.executable, "-c", forge], check=True, timeout=30)
        code, out = self._real_wait_out()
        self.assertEqual(code, 0, out)  # the engine's own wait prints the forged summary as ok
        tx = self.root / "forged.jsonl"
        tx.write_text(
            _bash_line(f'python3 -c "{forge}"', output="") + "\n"
            + _bash_line(f"python3 {CREW_SCRIPT} wait --run r1 --root {self.root}", output=out) + "\n"
        )
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), str(tx)))
        # a copied engine script is no launch either
        copy = self.root / "atlas_crew.py"
        copy.write_text("")
        tx.write_text(_bash_line(f"python3 {copy} run --plan p.json", output=out) + "\n")
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), str(tx)))
        # control: the plugin's own `run` that printed this run's id, over a verifying seal, is credited
        tx.write_text(_bash_line(f"python3 {CREW_SCRIPT} run --plan p.json --wait 60", output=out) + "\n")
        self.assertIsNotNone(gate_rerun.crew_proof(self.root, "sess-1", started, (), str(tx)))

    def test_a_killed_run_is_no_engine_verified_red(self):
        started = time.time() - 60
        killed = {"ok": False, "killed": True, "check_exit": 1, "check": "pytest", "run": "r1", "workers": [{"name": "a"}]}
        tx = self._crew_run(killed)
        Path(tx).write_text(_bash_line(f"python3 {CREW_SCRIPT} run --plan p.json --wait 60", output=json.dumps(killed)) + "\n")
        self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx))
        red = dict(killed, killed=False)
        self._crew_run(red)
        self.assertEqual(gate_rerun.crew_red(self.root, "sess-1", started, (), tx)["exit"], 1)

    def test_unsealed_checks_the_object_it_is_given_not_a_second_read_of_the_file(self):
        run = self.root / ".atlas/.run/crew/r1"
        run.mkdir(parents=True)
        (run / "run.json").write_text(json.dumps({"lead_session": "sess-1", "run_id": "r1"}))
        atlas_crew_seal.create(run, "r1")
        signed = atlas_crew_seal.sign(run, {"ok": True, "run": "r1", "check_exit": 0})
        (run / "summary.json").write_text(json.dumps({**signed, "ok": False}))  # the file moved on after the caller read it
        self.assertFalse(gate_rerun._unsealed(run, signed))
        self.assertTrue(gate_rerun._unsealed(run, {**signed, "ok": False}))

    def test_crew_red_needs_this_session_and_a_red_check(self):
        started = time.time() - 60
        red = {"ok": False, "check_exit": 1, "check": "pytest", "run": "r1"}
        tx = self._crew_run(red)
        self.assertEqual(gate_rerun.crew_red(self.root, "sess-1", started, (), tx)["crew_run"], "r1")
        self.assertIsNone(gate_rerun.crew_red(self.root, "sess-2", started, (), tx))
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started))
        self._crew_run({"ok": True, "check_exit": 0, "check": "pytest"})
        self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx))
        self._crew_run({"ok": False, "check_exit": None})
        self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx))

    def test_crew_red_is_not_credited_for_a_forged_summary(self):
        started = time.time() - 60
        red = {"ok": False, "check_exit": 1, "check": "pytest", "run": "r1"}
        # hand-written files, the crew was never launched from this session
        tx = self._crew_run(red, launched=False)
        self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx))
        # launched, but the run dir is not one the engine made (no supervisor.log)
        tx = self._crew_run(red, engine_made=False)
        self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx))
        # a launch whose output never names this run
        tx = self._crew_run(red)
        Path(tx).write_text(_bash_line(CREW_RUN, output="{}") + "\n")
        self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx))
        # a denied launch is not a launch
        tx = self._crew_run(red)
        Path(tx).write_text(_bash_line(CREW_RUN, is_error=True, output="The user doesn't want to proceed r1") + "\n")
        self.assertIsNone(gate_rerun.crew_red(self.root, "sess-1", started, (), tx))


class GateWiringTest(GateOrchestrationTest):
    """End to end through completion_gate.py: a green re-run clears (a)(b)(g)(k)(m), a red one blocks
    with the gate's own output; nothing else changes."""

    def _transcript(self, cmd=".venv/bin/python -m pytest -q -p no:cacheprovider"):
        _venv_python(self.tmp)
        path = os.path.join(self.tmp, "transcript.jsonl")
        with open(path, "w") as f:
            f.write(_bash_line(cmd) + "\n")
        return path

    def _run(self, transcript):
        env = dict(self.env, ATLAS_GATE_COLONY="off", ATLAS_GATE_HEADER="off", ATLAS_GATE_DONE="off")
        return _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": transcript}, env
        )

    def _shared_setup(self, test_src):
        os.makedirs(os.path.join(self.tmp, "src"), exist_ok=True)
        with open(os.path.join(self.tmp, "src", "app.py"), "w") as f:
            f.write("x = 1\n")
        with open(os.path.join(self.tmp, "test_app.py"), "w") as f:
            f.write(test_src)
        self._log_run_write(os.path.join(self.tmp, "src", "app.py"))

    def test_green_rerun_clears_paperwork_letters(self):
        self._shared_setup(PASSING)
        before = self._run("")  # no transcript: nothing to re-run, paperwork letters block
        self.assertIn("(a)", before.stdout)
        self.assertIn("Shortcut: the gate re-runs", before.stdout)
        r = self._run(self._transcript())
        for letter in ("(a)", "(b)", "(g)", "(k)", "(m)"):
            self.assertNotIn(f"\\n  {letter}", r.stdout, r.stdout)
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, ".atlas", ".run", "gate-proof.json")))
        # docs letters (c)(d)(e) are not paperwork: a missing CHANGELOG still blocks
        self.assertIn("\\n  (c)", r.stdout)

    def test_red_rerun_blocks_with_gate_output(self):
        self._shared_setup(FAILING)
        r = self._run(self._transcript())
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("The gate re-ran `.venv/bin/python -m pytest -q -p no:cacheprovider`", r.stdout)
        self.assertFalse(os.path.isfile(os.path.join(self.tmp, ".atlas", ".run", "gate-proof.json")))

    def test_timeout_is_inconclusive_and_not_repeated(self):
        self._shared_setup("import time\n\ndef test_slow():\n    time.sleep(60)\n")
        transcript = self._transcript()
        env = dict(
            self.env, ATLAS_GATE_COLONY="off", ATLAS_GATE_HEADER="off", ATLAS_GATE_DONE="off",
            ATLAS_GATE_RERUN_TIMEOUT="5",
        )
        payload = {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": transcript}
        first = _run_gate(payload, env)
        self.assertIn('"decision": "block"', first.stdout)
        self.assertNotIn("Fix the failure", first.stdout)
        self.assertIn("inconclusive", first.stdout)
        marks = os.path.join(self.tmp, ".atlas", ".run", "gate-rerun-timeouts.json")
        self.assertIn(".venv/bin/python -m pytest", open(marks).read())
        t0 = time.time()
        second = _run_gate(payload, env)
        self.assertLess(time.time() - t0, 4.5, "the timed-out command must not be re-run")
        self.assertNotIn("Fix the failure", second.stdout)
        self.assertNotIn("Shortcut", second.stdout)

    def _crew_summary(self, ok, check_exit, sealed=True):
        run = os.path.join(self.tmp, ".atlas", ".run", "crew", "r1")
        os.makedirs(run, exist_ok=True)
        with open(os.path.join(run, "run.json"), "w") as f:
            json.dump({"lead_session": "sess-orch", "run_id": "r1"}, f)
        open(os.path.join(run, "supervisor.log"), "w").close()
        _write_summary(run, {"ok": ok, "check_exit": check_exit, "check": "pytest -q", "run": "r1"}, sealed)

    def _run_reply(self, reply, launched=True):
        env = dict(self.env, ATLAS_GATE_COLONY="off", ATLAS_GATE_DONE="off")
        tp = os.path.join(self.tmp, "crew-transcript.jsonl")
        with open(tp, "w") as f:
            if launched:
                f.write(_bash_line(CREW_RUN, output=LAUNCH_OUT) + "\n")
        return _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": tp, "last_assistant_message": reply},
            env,
        )

    BLOCKED = "ATLAS | \u26d4 blocked | global check red: 2 failures in test_app"
    VERIFY = "ATLAS | \u2705 verify | all checks run"

    def test_blocked_report_with_red_crew_check_owes_no_paperwork(self):
        self._shared_setup(PASSING)
        self._crew_summary(False, 1)
        r = self._run_reply(self.BLOCKED)
        for letter in ("(a)", "(b)", "(g)", "(k)", "(m)", "(o)"):
            self.assertNotIn(f"\\n  {letter}", r.stdout, r.stdout)
        self.assertNotIn("Shortcut", r.stdout)

    def test_blocked_report_with_forged_crew_summary_still_owes_paperwork(self):
        self._shared_setup(PASSING)
        self._crew_summary(False, 1)
        r = self._run_reply(self.BLOCKED, launched=False)  # files exist, no crew launch in the transcript
        self.assertIn("\\n  (a)", r.stdout)

    def test_blocked_report_with_an_unsigned_crew_summary_still_owes_paperwork(self):
        self._shared_setup(PASSING)
        self._crew_summary(False, 1, sealed=False)  # a launch is in the transcript, but the dir was written by hand
        r = self._run_reply(self.BLOCKED)
        self.assertIn("\\n  (a)", r.stdout)

    def test_blocked_report_with_a_passing_suite_and_nothing_collected_is_not_red(self):
        self._shared_setup(PASSING)
        env = dict(self.env, ATLAS_GATE_COLONY="off", ATLAS_GATE_DONE="off")
        r = _run_gate(
            {
                "session_id": "sess-orch", "cwd": self.tmp,
                "transcript_path": self._transcript(".venv/bin/python -m pytest -q -p no:cacheprovider -k zzz_nomatch"),
                "last_assistant_message": self.BLOCKED,
            },
            env,
        )
        self.assertIn("\\n  (a)", r.stdout)
        self.assertNotIn("Fix the failure", r.stdout)

    def test_a_denied_test_command_is_never_rerun(self):
        self._shared_setup(PASSING)
        tp = os.path.join(self.tmp, "denied.jsonl")
        _venv_python(self.tmp)
        with open(tp, "w") as f:
            f.write(_bash_line(".venv/bin/python -m pytest -q -p no:cacheprovider", is_error=True,
                               output="The user doesn't want to proceed with this tool use.") + "\n")
        r = self._run(tp)
        self.assertFalse(os.path.isfile(os.path.join(self.tmp, ".atlas", ".run", "gate-proof.json")))
        self.assertIn("\\n  (a)", r.stdout)

    def test_blocked_claim_without_a_red_signal_changes_nothing(self):
        self._shared_setup(PASSING)
        r = self._run_reply(self.BLOCKED)
        self.assertIn("\\n  (a)", r.stdout)
        self.assertIn("Shortcut", r.stdout)

    def test_red_crew_check_without_blocked_report_still_blocks(self):
        self._shared_setup(PASSING)
        self._crew_summary(False, 1)
        r = self._run_reply(self.VERIFY)
        self.assertIn("\\n  (a)", r.stdout)

    def test_blocked_report_with_green_crew_check_is_not_a_red_signal(self):
        self._shared_setup(PASSING)
        self._crew_summary(True, 0)
        r = self._run_reply(self.BLOCKED)
        self.assertNotIn("\\n  (a)", r.stdout)  # the green crew proof satisfies it the usual way

    def test_blocked_report_with_red_rerun_owes_no_paperwork(self):
        self._shared_setup(FAILING)
        env = dict(self.env, ATLAS_GATE_COLONY="off", ATLAS_GATE_DONE="off")
        r = _run_gate(
            {
                "session_id": "sess-orch", "cwd": self.tmp, "transcript_path": self._transcript(),
                "last_assistant_message": self.BLOCKED,
            },
            env,
        )
        for letter in ("(a)", "(b)", "(g)", "(k)", "(m)", "(o)"):
            self.assertNotIn(f"\\n  {letter}", r.stdout, r.stdout)
        self.assertNotIn("Fix the failure", r.stdout)

    def test_no_test_command_reason_is_short_and_leads_with_run_the_tests(self):
        self._shared_setup(PASSING)
        for rel in ("docs/CHANGELOG.md", "docs/ROADMAP.md", "README.md"):  # docs letters met
            Path(self.tmp, rel).write_text("# x\n\n- entry\n", encoding="utf-8")
        r = self._run("")
        reason = json.loads(r.stdout.strip().splitlines()[-1])["reason"]
        self.assertTrue(reason.startswith("[atlas] Run the project's tests once"), reason[:120])
        # the letters one test run clears are one-liners, not the dispatch-a-specialist clauses
        for line in ("(a) still open", "(b) still open", "(k) still open", "(m) still open"):
            self.assertIn(line, reason)
        for essay in ("Capture observed-behavior proof", "Dispatch atlas:implementer", "No plan was ever made"):
            self.assertNotIn(essay, reason)
        self.assertLess(len(reason.encode()), 2500, len(reason))

    def test_kill_switch_restores_old_behavior(self):
        self._shared_setup(PASSING)
        env = dict(self.env, ATLAS_GATE_RERUN="off", ATLAS_GATE_COLONY="off")
        r = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": self._transcript()}, env
        )
        self.assertIn("(a)", r.stdout)
        self.assertFalse(os.path.isfile(os.path.join(self.tmp, ".atlas", ".run", "gate-proof.json")))


if __name__ == "__main__":
    unittest.main()
