"""Hook latency work: outputs stay byte-identical and the expensive modules stay off the fast path.

Pins (1) the PreToolUse Bash verdicts (allow, context, ask, deny) that event_dispatch.py emits and that
fallow_gate.py stays silent for, (2) the fallow_gate prefilter (it may skip only when the full gate would
do nothing, and runs the gate for every command that can create or push a commit), (3) the lazy-regex
modules compiling nothing at import, and (4) session_boot opening the lead channel in-process and
finding the lead pid without `ps`. Import probes run in fresh interpreters (sys.modules is process-wide).
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
SCRIPTS = PLUGIN / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(HERE))

import _test_isolation  # noqa: F401,E402
import atlas_hook_guard  # noqa: E402
import atlas_lazyre  # noqa: E402
import atlas_todo  # noqa: E402
import fallow_gate  # noqa: E402

GIT = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@t",
}


def bash(cmd):
    return json.dumps(
        {
            "tool_name": "Bash",
            "tool_input": {"command": cmd},
            "hook_event_name": "PreToolUse",
        }
    )


def repo(root, extra_branch):
    def g(*a):
        subprocess.run(
            ["git", "-C", str(root), *a],
            check=True,
            capture_output=True,
            env={**os.environ, **GIT},
        )

    g("init", "-q", "-b", "main")
    (Path(root) / "a.txt").write_text("a\n")
    g("add", "a.txt")
    g("commit", "-qm", "i")
    if extra_branch:
        g("checkout", "-qb", "feat")


def run_hook(entry, args, payload, cwd, state):
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(state / "home"),
        "LANG": "C.UTF-8",
        "ATLAS_HOME": str(state / "atlas"),
        "TMPDIR": str(state / "tmp"),
        "CLAUDE_PROJECT_DIR": str(cwd),
        "CLAUDE_PLUGIN_ROOT": str(PLUGIN),
        "ATLAS_UPDATE_CHECK": "off",
        "ATLAS_HERDR_AUTOSTART": "off",
        "ATLAS_DASHBOARD": "off",
    }
    for d in ("home", "atlas", "tmp"):
        (state / d).mkdir(parents=True, exist_ok=True)
    p = json.loads(payload)
    p.update(cwd=str(cwd), session_id="perf-sess")
    c = subprocess.run(
        [sys.executable, str(HERE / entry), *args],
        input=json.dumps(p),
        capture_output=True,
        text=True,
        env=env,
        cwd=str(cwd),
        timeout=60,
    )
    return c.returncode, c.stdout


def probe(code, stdin=""):
    """Run `code` in a fresh interpreter with the plugin dirs on sys.path; return stdout."""
    pre = f"import sys; sys.path[:0] = [{str(SCRIPTS)!r}, {str(HERE)!r}]\n"
    c = subprocess.run(
        [sys.executable, "-S", "-c", pre + code],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert c.returncode == 0, c.stderr
    return c.stdout


class PreToolUseVerdictsPinned(unittest.TestCase):
    """The verdict text and shape for allow, context, ask and deny stay exactly as before."""

    def _both(self, cmd, extra_branch):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            (t / "proj").mkdir()
            repo(t / "proj", extra_branch)
            d = run_hook(
                "event_dispatch.py", ["PreToolUse"], bash(cmd), t / "proj", t / "st"
            )
            f = run_hook("fallow_gate.py", [], bash(cmd), t / "proj", t / "st")
        return d, f

    def test_allow_is_silent(self):
        for extra in (False, True):
            self.assertEqual(self._both("ls", extra), ((0, ""), (0, "")))

    def test_context_payloads(self):
        for cmd, needle in (
            (
                "rm -rf /",
                "catastrophic, near-irreversible pattern (recursive force-delete of a root/home path)",
            ),
            ("env", "(the full environment dump)"),
            ("echo AKIAIOSFODNN7EXAMPLE", "(an AWS access key id)"),
        ):
            (rc, out), (frc, fout) = self._both(cmd, False)
            body = json.loads(out)["hookSpecificOutput"]
            self.assertEqual(rc, 0)
            self.assertEqual(body["hookEventName"], "PreToolUse")
            self.assertNotIn("permissionDecision", body)
            self.assertTrue(
                body["additionalContext"].startswith("[atlas advisor] "), cmd
            )
            self.assertIn(needle, body["additionalContext"])
            self.assertEqual((frc, fout), (0, ""))

    def test_ask_when_main_is_the_only_branch(self):
        (rc, out), _ = self._both("git commit -m x", False)
        self.assertEqual(
            json.loads(out),
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": "atlas git policy: this would commit on main (default branch). Approve only if you asked for it.",
                }
            },
        )

    def test_deny_when_another_branch_exists(self):
        (rc, out), _ = self._both("git push origin main", True)
        body = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(body["permissionDecision"], "deny")
        self.assertTrue(
            body["permissionDecisionReason"].startswith(
                "atlas git policy: refusing to push to main (default branch). Other branches in use: feat."
            )
        )


class FallowPrefilter(unittest.TestCase):
    SKIP = [
        "ls",
        "echo hi",
        "rm -rf /",
        "env",
        "npm test",
        "cat a.py | head",
        "python3 -c 'print(1)'",
        "pytest -q",
    ]
    RUN = [
        "git commit -m x",
        "git push origin main",
        "git merge feat",
        "git rebase -i HEAD~2",
        "git cherry-pick abc",
        "git am p.patch",
        "git -c a=b commit -m x",
        "bash -c 'git commit -m x'",
        'sh -c "git merge x"',
        "/usr/bin/git commit -m x",
        "cd x && git push",
    ]

    def test_skips_only_commands_without_git(self):
        for cmd in self.SKIP:
            self.assertTrue(fallow_gate._prefilter_skips(bash(cmd)), cmd)

    def test_runs_the_gate_for_every_commit_or_push_capable_command(self):
        for cmd in self.RUN:
            self.assertFalse(fallow_gate._prefilter_skips(bash(cmd)), cmd)

    def test_escaped_git_is_decoded_before_the_test(self):
        raw = '{"tool_name":"Bash","tool_input":{"command":"\\u0067it commit -m x"}}'
        self.assertFalse(fallow_gate._prefilter_skips(raw))

    def test_unsure_means_run_the_gate(self):
        for raw in (
            None,
            "{not json",
            "[]",
            '"str"',
            '{"tool_input": "x"}',
            '{"tool_input": {"command": 5}}',
            '{"tool_name": 7}',
            '{"cwd": ["x"]}',
            '{"tool_input": {"command": "ls"}} trailing',
        ):
            self.assertFalse(fallow_gate._prefilter_skips(raw), raw)

    def test_well_formed_payloads_with_no_command_are_skipped(self):
        for raw in (
            "",
            "   \n",
            "{}",
            '{"tool_name":"Bash"}',
            '{"tool_input":{}}',
            '{"tool_input":null}',
        ):
            self.assertTrue(fallow_gate._prefilter_skips(raw), raw)

    def test_string_field_list_mirrors_the_hook_guard(self):
        self.assertEqual(
            tuple(fallow_gate._PAYLOAD_STR_FIELDS), tuple(atlas_hook_guard._STR_FIELDS)
        )

    def test_skipped_payloads_are_ones_the_full_gate_ignores(self):
        for cmd in self.SKIP:
            out = io.StringIO()
            with (
                mock.patch.object(sys, "stdin", io.StringIO(bash(cmd))),
                mock.patch.object(sys, "stdout", out),
            ):
                try:
                    fallow_gate.main()
                except SystemExit as e:
                    self.assertIn(e.code, (0, None))
            self.assertEqual(out.getvalue(), "", cmd)

    def test_fast_path_imports_neither_json_nor_the_guard_modules(self):
        script = str(HERE / "fallow_gate.py")
        code = (
            "import io, runpy, sys\n"
            "sys.stdin = io.StringIO(%r)\n"
            "try:\n    runpy.run_path(%r, run_name='__main__')\nexcept SystemExit:\n    pass\n"
            "print(sorted(m for m in ('json', 're', 'atlas_env', 'atlas_hook_guard', 'atlas_db') if m in sys.modules))\n"
        ) % (bash("ls"), script)
        got = eval(probe(code).strip().splitlines()[-1])
        self.assertEqual(
            [
                m
                for m in got
                if m in ("json", "atlas_env", "atlas_hook_guard", "atlas_db")
            ],
            [],
        )

    def test_commit_payload_still_reaches_the_gate_modules(self):
        script = str(HERE / "fallow_gate.py")
        code = (
            "import io, runpy, sys, os\n"
            "os.environ['ATLAS_HOME'] = %r\n"
            "sys.stdin = io.StringIO(%r)\n"
            "try:\n    runpy.run_path(%r, run_name='__main__')\nexcept SystemExit:\n    pass\n"
            "print('atlas_hook_guard' in sys.modules)\n"
        )
        with tempfile.TemporaryDirectory() as t:
            out = probe(code % (t, bash("git commit -m x"), script))
        self.assertEqual(out.strip().splitlines()[-1], "True")


class LazyRegexModules(unittest.TestCase):
    def test_lre_behaves_like_a_compiled_pattern(self):
        rx = atlas_lazyre.lre(r"a(b+)c", 0)
        self.assertIsNone(rx._rx)
        self.assertEqual(rx.search("xabbcx").group(1), "bb")
        self.assertIsNotNone(rx._rx)
        self.assertEqual(rx.pattern, "a(b+)c")
        self.assertEqual(rx.sub("-", "abc abbc"), "- -")
        self.assertEqual([m.group(0) for m in rx.finditer("abc abbc")], ["abc", "abbc"])
        self.assertTrue(atlas_lazyre.lre("X", 2).match("x"))

    def test_hook_modules_compile_nothing_at_import(self):
        mods = [
            "dispatch_tripwire_core",
            "completion_gate_core",
            "bash_advisor",
            "git_guard",
            "recall_gate",
            "worker_inbox",
            "atlas_db",
            "atlas_git",
        ]
        code = (
            "import re\n"
            "for m in %r:\n"
            "    mod = __import__(m)\n"
            "    eager = sorted(k for k, v in vars(mod).items() if isinstance(v, re.Pattern))\n"
            "    print(m, eager)\n"
        ) % (mods,)
        for line in probe(code).strip().splitlines():
            name, rest = line.split(" ", 1)
            self.assertEqual(eval(rest), [], f"{name} holds eagerly compiled module-level regexes")

    def test_completion_gate_and_tripwire_cores_do_not_import_heavy_modules(self):
        code = (
            "import sys\n"
            "import dispatch_tripwire_core\n"
            "print(sorted(m for m in ('atlas_analytics','atlas_memory','session_ingest','atlas_harness') if m in sys.modules))\n"
        )
        self.assertEqual(probe(code).strip(), "[]")


class SessionBootProbes(unittest.TestCase):
    def test_proc_lead_pid_matches_the_ps_walk(self):
        got = atlas_todo._proc_lead_pid()
        if got is atlas_todo._NO_PROC:
            self.skipTest("no /proc here")
        with mock.patch.object(
            atlas_todo, "_proc_lead_pid", return_value=atlas_todo._NO_PROC
        ):
            self.assertEqual(atlas_todo._lead_pid(), got)
        self.assertEqual(atlas_todo._lead_pid(), got)

    def test_lead_pid_falls_back_to_ps_when_proc_is_unreadable(self):
        calls = []

        def fake():
            calls.append("ps")
            return subprocess.CompletedProcess([], 0, stdout="  1  0 init\n", stderr="")

        with mock.patch.object(atlas_todo, "_proc_lead_pid", return_value=atlas_todo._NO_PROC):
            self.assertIsNone(atlas_todo._lead_pid(fake))
        self.assertEqual(calls, ["ps"])

    def test_open_lead_channel_once_opens_in_process_without_a_child(self):
        import session_boot_core
        import worker_inbox

        with tempfile.TemporaryDirectory() as t:
            with (
                mock.patch.dict(os.environ, {"ATLAS_CHANNELS": "on"}),
                mock.patch.object(worker_inbox, "is_worker_env", return_value=False),
                mock.patch.object(atlas_todo, "find_root", return_value=t),
                mock.patch.object(atlas_todo, "lead_channel_allowed", return_value=True),
                mock.patch.object(atlas_todo, "open_lead_channel") as opened,
                mock.patch("subprocess.run") as sp,
                mock.patch("subprocess.Popen") as po,
            ):
                session_boot_core.open_lead_channel_once({"session_id": "perf-sess", "cwd": t})
        opened.assert_called_once()
        self.assertEqual(opened.call_args.args[:3], (t, atlas_todo.lead_name("perf-sess"), ()))
        self.assertFalse(sp.called or po.called)


if __name__ == "__main__":
    unittest.main()
