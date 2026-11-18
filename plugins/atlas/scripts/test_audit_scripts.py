#!/usr/bin/env python3
"""Regression tests for the 2026-11-17 atlas audit fixes in atlas_mux.py and atlas_crew.py."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import _test_isolation  # noqa: F401,E402
import atlas_crew
import atlas_mux


class SeatModelTests(unittest.TestCase):
    def test_audit_high_explorers_get_matrix_model(self):
        team = atlas_mux.build_team("audit", "high", None, "t")
        explorers = [m for m in team["members"] if m["role"] == "explorer"]
        self.assertTrue(explorers)
        for m in explorers:
            self.assertEqual(m["model"], "sonnet")
            self.assertEqual(atlas_mux.seat_model(m, "claude"), "sonnet")
            self.assertIsNone(atlas_mux.seat_model(m, "omp"))
            self.assertIsNone(atlas_mux.seat_model(m, "codex"))


class StopPidfileTests(unittest.TestCase):
    def test_unreadable_argv_sends_no_signal(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.pid"
            p.write_text("999999\n")
            with mock.patch.object(atlas_crew, "_pid_from", return_value=999999), \
                    mock.patch.object(atlas_crew, "_pid_alive", return_value=True), \
                    mock.patch.object(atlas_crew, "_read_argv", side_effect=OSError("gone")), \
                    mock.patch.object(os, "killpg") as killpg, \
                    mock.patch.object(os, "kill") as kill:
                self.assertIsNone(atlas_crew._stop_pidfile(p, "run1", wait_s=0))
            killpg.assert_not_called()
            kill.assert_not_called()


if __name__ == "__main__":
    unittest.main()
