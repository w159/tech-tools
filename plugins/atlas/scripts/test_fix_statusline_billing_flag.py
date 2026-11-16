"""The statusline publishes how the session is billed (`billing: plan|api`) in
statusline-rows.json, so the mod shows a dollar figure only for a per-token bill."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_statusline as sl  # noqa: E402


def payload(proj, rate_limits):
    d = {
        "model": {"display_name": "Claude Opus 5.5", "id": "claude-opus-5-5-20260101"},
        "workspace": {"current_dir": proj},
        "cost": {"total_cost_usd": 10.26, "total_duration_ms": 134000},
        "context_window": {
            "context_window_size": 1_000_000,
            "total_input_tokens": 300000,
            "total_output_tokens": 91700,
            "current_usage": {"input_tokens": 3, "output_tokens": 10},
        },
    }
    if rate_limits:
        d["rate_limits"] = {"five_hour": {"used_percentage": 62, "resets_at": 0}}
    return d


class BillingFlag(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        env = mock.patch.dict(
            os.environ, {"ATLAS_STATUSLINE_CONFIG": os.path.join(self.tmp, "none.json")}
        )
        env.start()
        self.addCleanup(env.stop)
        w = mock.patch("shutil.which", return_value=None)
        w.start()
        self.addCleanup(w.stop)
        self.proj = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.proj, ".atlas", ".run"))
        self.path = os.path.join(self.proj, ".atlas", ".run", "statusline-rows.json")

    def published(self, rate_limits):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            data = json.dumps(payload(self.proj, rate_limits))
            self.assertEqual(sl.main(["--width", "120", "--home", self.tmp], io.StringIO(data)), 0)
        with open(self.path) as f:
            return json.load(f)

    def test_rate_limits_mean_plan(self):
        doc = self.published(True)
        self.assertEqual(doc["billing"], "plan")
        for key in ("ts", "rows", "fullRows"):
            self.assertIn(key, doc)

    def test_no_rate_limits_mean_api(self):
        doc = self.published(False)
        self.assertEqual(doc["billing"], "api")
        for key in ("ts", "rows", "fullRows"):
            self.assertIn(key, doc)

    def test_write_rows_without_billing_keeps_old_shape(self):
        sl.write_rows(self.proj, 2, 5)
        with open(self.path) as f:
            doc = json.load(f)
        self.assertEqual(set(doc), {"ts", "rows", "fullRows"})


if __name__ == "__main__":
    unittest.main()
