#!/usr/bin/env python3
"""Status header / outputStyle contract for SessionStart."""

from __future__ import annotations

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import session_boot  # noqa: E402


class StatusContractLinesTest(unittest.TestCase):
    def test_always_emits_header_loop_dispatch(self):
        blob = "\n".join(session_boot.status_contract_lines(""))
        self.assertIn("STATUS HEADER", blob)
        self.assertIn("ATLAS |", blob)
        self.assertIn("LOOP", blob)
        self.assertIn("DISPATCH colors", blob)
        self.assertIn("research", blob)

    def test_override_warns_on_concise(self):
        blob = "\n".join(session_boot.status_contract_lines("concise"))
        self.assertIn("STYLE OVERRIDE", blob)
        self.assertIn("concise", blob)
        self.assertIn("Atlas Orchestrator", blob)

    def test_matching_style_no_override_line(self):
        blob = "\n".join(session_boot.status_contract_lines("Atlas Orchestrator"))
        self.assertNotIn("STYLE OVERRIDE", blob)


class DoctorOutputStyleTest(unittest.TestCase):
    def test_check_output_style_flags_concise(self):
        import atlas_doctor

        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "settings.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"outputStyle": "concise"}, f)
        ok, detail = atlas_doctor.check_output_style(path)
        self.assertFalse(ok)
        self.assertIn("concise", detail)

    def test_check_output_style_ok_when_atlas(self):
        import atlas_doctor

        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "settings.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"outputStyle": "Atlas Orchestrator"}, f)
        ok, detail = atlas_doctor.check_output_style(path)
        self.assertTrue(ok)


class BootMainStyleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.env = dict(os.environ, ATLAS_DB=self.db)
        self._orig_curator = sys.modules.get("atlas_curator")
        self._orig_memory = sys.modules.get("atlas_memory")
        self._curator = mock.MagicMock()
        self._memory = mock.MagicMock()
        self._memory.load_snapshot.return_value = {}
        sys.modules["atlas_curator"] = self._curator
        sys.modules["atlas_memory"] = self._memory

    def tearDown(self):
        # setUp replaces the real atlas_curator/atlas_memory modules in
        # sys.modules with MagicMocks so session_boot.main() doesn't touch
        # real state; without restoring them here, every later test in the
        # same pytest process that does `import atlas_curator` (e.g.
        # scripts/test_atlas_curator.py) gets the mock instead of the real
        # module, and mock.patch("atlas_curator.shutil.move", ...) silently
        # patches the mock's attribute rather than the real one.
        if self._orig_curator is not None:
            sys.modules["atlas_curator"] = self._orig_curator
        else:
            sys.modules.pop("atlas_curator", None)
        if self._orig_memory is not None:
            sys.modules["atlas_memory"] = self._orig_memory
        else:
            sys.modules.pop("atlas_memory", None)

    def test_boot_includes_contract_and_override_sysmsg(self):
        stdin = io.StringIO(json.dumps({"session_id": "s1", "cwd": self.tmp}))
        stdout = io.StringIO()
        with (
            mock.patch("sys.stdin", stdin),
            mock.patch("sys.stdout", stdout),
            mock.patch.dict(os.environ, self.env, clear=False),
            mock.patch.object(session_boot, "detect_dep", return_value=True),
            mock.patch.object(session_boot, "has_cmd", return_value=True),
            mock.patch.object(
                session_boot, "read_output_style", return_value="concise"
            ),
            mock.patch.object(session_boot, "ensure_dashboard", return_value=None),
        ):
            try:
                session_boot.main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)
        data = json.loads(stdout.getvalue())
        ctx = data["hookSpecificOutput"]["additionalContext"]
        self.assertIn("STATUS HEADER", ctx)
        self.assertIn("LOOP", ctx)
        self.assertIn("STYLE OVERRIDE", ctx)
        self.assertIn("concise", data["systemMessage"])

    def test_omp_ignores_claude_output_style(self):
        stdin = io.StringIO(json.dumps({"session_id": "s1", "cwd": self.tmp}))
        stdout = io.StringIO()
        with (
            mock.patch("sys.stdin", stdin),
            mock.patch("sys.stdout", stdout),
            mock.patch.dict(
                os.environ, dict(self.env, ATLAS_HARNESS="omp"), clear=False
            ),
            mock.patch.object(session_boot, "detect_dep", return_value=True),
            mock.patch.object(session_boot, "has_cmd", return_value=True),
            mock.patch.object(
                session_boot, "read_output_style", return_value="concise"
            ),
            mock.patch.object(session_boot, "ensure_dashboard", return_value=None),
        ):
            try:
                session_boot.main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)
        ctx = json.loads(stdout.getvalue())["hookSpecificOutput"]["additionalContext"]
        self.assertIn("STATUS HEADER", ctx)
        self.assertNotIn("STYLE OVERRIDE", ctx)


if __name__ == "__main__":
    unittest.main()
