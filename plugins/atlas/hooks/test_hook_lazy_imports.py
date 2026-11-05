"""Cold hook processes must not pay for modules the common path never uses.

Each check runs in a fresh interpreter (the way hooks.json starts a hook) and reports which modules ended up in
sys.modules, so a regression shows as an import, not as a timing wobble."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HOOKS = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HOOKS, "..", "scripts")

PRELUDE = (
    "import sys, io, json, os\n"
    f"sys.path[:0] = [{HOOKS!r}, {SCRIPTS!r}]\n"
    "def loaded(*names):\n"
    "    return {n: n in sys.modules for n in names}\n"
)


def probe(body, stdin="", env=None):
    """Run `body` (python source that prints one JSON object last) in a fresh interpreter."""
    tmp = tempfile.mkdtemp()
    base = dict(
        os.environ,
        HOME=tmp,
        ATLAS_HOME=os.path.join(tmp, ".atlas"),
        ATLAS_DB=os.path.join(tmp, "atlas.db"),
        ATLAS_UPDATE_CHECK="off",
        ATLAS_HERDR_AUTOSTART="off",
        ATLAS_DASHBOARD="off",
        ATLAS_COLONY="on",
    )
    base.pop("ATLAS_SEAT_BACKEND", None)
    base.update(env or {})
    try:
        p = subprocess.run(
            [sys.executable, "-S", "-c", PRELUDE + body],
            input=stdin,
            capture_output=True,
            text=True,
            env=base,
            cwd=tmp,
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    out = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
    if not out:
        raise AssertionError(f"no JSON from probe: rc={p.returncode} err={p.stderr[-400:]}")
    return json.loads(out[-1])


class LazyImportTest(unittest.TestCase):
    def test_todo_capture_import_does_not_load_the_board_module(self):
        r = probe("import todo_capture\nprint(json.dumps(loaded('atlas_todo')))")
        self.assertFalse(r["atlas_todo"])

    def test_plain_bash_event_never_loads_the_board_module(self):
        payload = json.dumps(
            {"tool_name": "Bash", "tool_input": {"command": "ls"}, "session_id": "s1", "cwd": "."}
        )
        r = probe(
            "import todo_capture\n"
            "sys.stdin = io.StringIO(%r)\n"
            "rc = todo_capture.main()\n"
            "print(json.dumps(dict(rc=rc, **loaded('atlas_todo'))))" % payload
        )
        self.assertEqual(r["rc"], 0)
        self.assertFalse(r["atlas_todo"])

    def test_atlas_dispatch_still_reaches_the_board_module(self):
        payload = json.dumps(
            {
                "tool_name": "Agent",
                "tool_input": {"subagent_type": "atlas:implementer"},
                "session_id": "s1",
                "cwd": ".",
            }
        )
        r = probe(
            "import todo_capture\n"
            "sys.stdin = io.StringIO(%r)\n"
            "todo_capture.main()\n"
            "print(json.dumps(loaded('atlas_todo')))" % payload
        )
        self.assertTrue(r["atlas_todo"])

    def test_dispatcher_bash_post_event_stays_off_the_board_and_network_modules(self):
        payload = json.dumps(
            {
                "hook_event_name": "PostToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": "ls"},
                "tool_response": {"stdout": "x"},
                "session_id": "s1",
                "cwd": ".",
            }
        )
        r = probe(
            "import event_dispatch\n"
            "event_dispatch.run_event('PostToolUse', %r)\n"
            "print(json.dumps(loaded('atlas_todo', 'urllib.request', 'atlas_rig')))" % payload
        )
        self.assertEqual(r, {"atlas_todo": False, "urllib.request": False, "atlas_rig": False})

    def test_rig_module_defers_urllib_until_a_health_probe(self):
        r = probe("import atlas_rig\nprint(json.dumps(loaded('urllib.request')))")
        self.assertFalse(r["urllib.request"])

    def test_session_boot_does_not_load_urllib_when_no_probe_runs(self):
        payload = json.dumps({"hook_event_name": "SessionStart", "source": "startup", "cwd": ".", "session_id": "s1"})
        r = probe(
            "import session_boot_core as core\n"
            "sys.stdin = io.StringIO(%r)\n"
            "sys.stdout = io.StringIO()\n"
            "try:\n"
            "    core.main()\n"
            "except SystemExit:\n"
            "    pass\n"
            "sys.stdout = sys.__stdout__\n"
            "print(json.dumps(loaded('urllib.request', 'atlas_rig')))" % payload
        )
        self.assertTrue(r["atlas_rig"], "the herdr-backend probe should have run")
        self.assertFalse(r["urllib.request"])

    def test_prompt_optimizer_defers_urllib_until_an_ollama_call(self):
        payload = json.dumps(
            {"hook_event_name": "UserPromptSubmit", "prompt": "hello there", "cwd": ".", "session_id": "s1"}
        )
        r = probe(
            "import prompt_optimizer_core as po\n"
            "sys.stdin = io.StringIO(%r)\n"
            "sys.stdout = io.StringIO()\n"
            "try:\n"
            "    po.main()\n"
            "except SystemExit:\n"
            "    pass\n"
            "sys.stdout = sys.__stdout__\n"
            "print(json.dumps(loaded('urllib.request')))" % payload
        )
        self.assertFalse(r["urllib.request"])


if __name__ == "__main__":
    unittest.main()
