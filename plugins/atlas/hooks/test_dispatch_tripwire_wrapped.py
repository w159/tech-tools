import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os as _o

_o.environ.setdefault("ATLAS_CHANNELS", "off")
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import dispatch_tripwire_core as core  # noqa: E402

EXEMPT = [
    "for i in 1 2 3; do gh run watch 123 --exit-status && break; sleep 20; done",
    "sleep 15; gh run list --limit 3",
    "F=plugins/atlas/scripts/atlas_finding.py && python3 $F add --id x",
    "PATH=/opt/x/bin:$PATH timeout 590 python3 plugins/atlas/scripts/atlas_test.py run",
    "cat > .atlas/.run/briefs/a.md <<'EOF'\nGOAL: x && rm -rf y; $(z)\nEOF",
]
PLAIN = [
    "gh run list --limit 3",
    "python3 plugins/atlas/scripts/atlas_finding.py add --id x",
    "timeout 590 python3 plugins/atlas/scripts/atlas_test.py run",
    "git status",
]
NOT_EXEMPT = [
    "sleep 5; rm -rf build",
    "gh run list; python3 build.py",
    "cat > plugins/atlas/x.py <<'EOF'\nx = 1\nEOF",
    "cat > .atlas/.run/briefs/a.md <<'EOF'\nx\nEOF\nrm -rf build",
    "cat > .atlas/.run/briefs/../../../x.py <<'EOF'\nx\nEOF",
    "cat > .atlas/.run/briefs/a.md <<EOF\n$(rm -rf x)\nEOF",
    "for i in 1 2; do python3 build.py; done",
    "F=build.py; python3 $F",
]


def _exempt(command, tool="Bash"):
    t = {"command": command}
    return (
        core._is_bookkeeping_call(tool, t)
        or core._is_integration_call(tool, t)
        or core._is_read_only_call(tool, t)
        or bool(core._team_mux_verb(tool, t))
    )


class WrappedPredicateTest(unittest.TestCase):
    def test_wrapped_forms_are_exempt(self):
        for c in EXEMPT:
            with self.subTest(c=c):
                self.assertTrue(
                    core._is_integration_call("Bash", {"command": c}), c
                )

    def test_bookkeeping_wrapped_form(self):
        c = EXEMPT[2]
        self.assertTrue(core._is_bookkeeping_call("Bash", {"command": c}))

    def test_plain_forms_still_pass(self):
        for c in PLAIN:
            with self.subTest(c=c):
                self.assertTrue(_exempt(c), c)

    def test_mixed_compounds_stay_counted(self):
        for c in NOT_EXEMPT:
            with self.subTest(c=c):
                self.assertFalse(_exempt(c), c)


class WrappedGateTest(unittest.TestCase):
    """Through _pre_tool_use, the entry point the hook calls."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        self.db = atlas_db
        self.conn = atlas_db.connect(os.path.join(self.tmp, "atlas.db"))
        atlas_db.init(self.conn)
        pid = atlas_db.register_project(self.conn, "/repo/x")
        self.run_id = atlas_db.start_run(self.conn, pid, "sess-w")
        atlas_db.mark_orchestrating(self.conn, "sess-w")
        for _ in range(7):  # past DENY_THRESHOLD
            atlas_db.log_event(self.conn, self.run_id, "Bash", "main", 1, None)
        env = {
            "ATLAS_TRIPWIRE_HARD": "on",
            "ATLAS_TEAM_GATE": "on",
            "ATLAS_WORKER_NAME": "",
            "ATLAS_INLINE_SIMPLE": "off",
        }
        p = patch.dict(os.environ, env)
        p.start()
        self.addCleanup(p.stop)

    def _gate(self, tool, tinput, path=None):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            core._pre_tool_use(
                self.conn, self.db, tool, "sess-w", path, tinput, root=None, cwd=self.tmp
            )
        return buf.getvalue()

    def test_exempt_forms_not_denied(self):
        for c in EXEMPT:
            with self.subTest(c=c):
                self.assertEqual(self._gate("Bash", {"command": c}), "")

    def test_non_exempt_compounds_denied(self):
        for c in NOT_EXEMPT[:3]:
            with self.subTest(c=c):
                self.assertIn("deny", self._gate("Bash", {"command": c}))


class RouteTextTest(unittest.TestCase):
    def setUp(self):
        WrappedGateTest.setUp(self)

    _gate = WrappedGateTest._gate

    def _texts(self):
        return [
            self._gate("Bash", {"command": "touch a.txt"}),
            self._gate("Edit", {"file_path": "src/app.py"}, "src/app.py"),
        ]

    def test_team_gate_names_spawn_team(self):
        with patch("shutil.which", return_value="/usr/bin/tmux"):
            texts = self._texts()
        for t in texts:
            self.assertIn("deny", t)
            self.assertIn("spawn-team", t)
            self.assertNotIn("atlas:implementer", t)

    def test_no_team_gate_keeps_in_process_route(self):
        with patch.dict(os.environ, {"ATLAS_TEAM_GATE": "off"}):
            texts = self._texts()
        for t in texts:
            self.assertIn("atlas:implementer", t)
            self.assertNotIn("spawn-team", t)


if __name__ == "__main__":
    unittest.main()
