#!/usr/bin/env python3
"""Dashboard self-heal exec must terminate when sibling installs cannot serve either."""

from __future__ import annotations

import _test_isolation  # noqa: F401
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import atlas_dashboard as d


def _install(plugin: Path, ver: str) -> Path:
    scripts = plugin / ver / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "atlas_dashboard.py").write_text("# fake install\n")
    (scripts.parent / ".claude-plugin").mkdir()
    (scripts.parent / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": "atlas", "version": ver}))
    return scripts / "atlas_dashboard.py"  # no dashboard_ui: this install cannot serve


class SelfHealLoopTests(unittest.TestCase):
    def test_two_uiless_siblings_do_not_exec_each_other_forever(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.dict(os.environ):
            os.environ.pop("ATLAS_DASH_HEAL_SEEN", None)
            plugin = Path(t) / "cache" / "mkt" / "atlas"
            cur = _install(plugin, "1.9.0")
            _install(plugin, "1.10.0")
            execs = []
            with mock.patch.object(d, "_EXEC", lambda exe, argv: execs.append(argv[1])), mock.patch.object(d, "_HTTPD", None):
                for _ in range(8):
                    tgt = d._self_heal_target([cur.parent.parent], {os.path.realpath(cur)})
                    if tgt is None:
                        break
                    d._self_heal_exec(tgt)
                    cur = Path(execs[-1])
            self.assertLess(len(execs), 8, f"exec ping-pong: {execs}")


if __name__ == "__main__":
    unittest.main()
