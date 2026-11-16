"""Dollars only for a crew worker billed per token: a plan login's total_cost_usd is an estimate, not a charge."""

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402
import atlas_crew  # noqa: E402
import atlas_provider  # noqa: E402


def init(src):
    e = {"type": "system", "subtype": "init", "model": "claude-sonnet-5-5"}
    if src is not ...:
        e["apiKeySource"] = src
    return json.dumps(e)


def result(cost):
    return json.dumps(
        {
            "type": "result",
            "total_cost_usd": cost,
            "num_turns": 1,
            "modelUsage": {"m": {"inputTokens": 100, "outputTokens": 10}},
        }
    )


class CrewBilling(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.rundir = Path(self._tmp.name) / "run"
        for d in ("logs", "irc/stop", "exit"):
            (self.rundir / d).mkdir(parents=True)

    def run_logs(self, logs, providers=None):
        for n, text in logs.items():
            (self.rundir / "logs" / f"{n}.log").write_text(text + "\n")
            (self.rundir / "exit" / f"{n}.r0.json").write_text('{"exit": 0, "wall_s": 1}')
        meta = {"run_id": "run", "started": time.time() - 5, "plan": {"workers": [{"name": n} for n in logs], "check": "true"}}
        prov = providers or {}
        with (
            mock.patch.object(atlas_crew.atlas_irc, "history", return_value=[]),
            mock.patch.object(atlas_crew.atlas_irc, "has_done", return_value=True),
            mock.patch.object(atlas_crew, "load_provider", side_effect=lambda r, n: prov.get(n)),
        ):
            out = atlas_crew.summarize(self.rundir, meta, [], 0, "")
        return {w["name"]: w for w in out["workers"]}, out["tokens_workers"]

    def test_plan_init_gives_no_dollars_and_keeps_tokens(self):
        rows, tot = self.run_logs({"a": init("none") + "\n" + result(0.4567896)})
        self.assertEqual((rows["a"]["cost_usd"], rows["a"]["billing"], rows["a"]["tokens"]), (None, "plan", 110))
        self.assertIsNone(tot["cost_usd"])
        self.assertEqual((tot["billing"], tot["total"]), ("plan", 110))
        self.assertIsNone(atlas_provider._summary_cost(tot))

    def test_api_init_keeps_dollars(self):
        rows, tot = self.run_logs({"a": init("ANTHROPIC_API_KEY") + "\n" + result(0.25)})
        self.assertEqual((rows["a"]["cost_usd"], rows["a"]["billing"]), (0.25, "api"))
        self.assertEqual((tot["cost_usd"], tot["billing"], tot["cost_complete"]), (0.25, "api", True))
        self.assertEqual(atlas_provider._summary_cost(tot), 0.25)

    def test_no_init_or_no_source_gives_none(self):
        rows, tot = self.run_logs({"a": result(0.3), "b": init(...) + "\n" + result(0.3), "c": init("") + "\n" + result(0.3)})
        for n in "abc":
            self.assertEqual((rows[n]["cost_usd"], rows[n]["billing"], rows[n]["tokens"]), (None, "plan", 110))
        self.assertIsNone(tot["cost_usd"])

    def test_mixed_run_totals_only_the_billed_worker(self):
        rows, tot = self.run_logs({"a": init("ANTHROPIC_API_KEY") + "\n" + result(0.25), "b": init("none") + "\n" + result(0.9)})
        self.assertEqual(rows["b"]["cost_usd"], None)
        self.assertEqual((tot["cost_usd"], tot["billing"], tot["total"]), (0.25, "mixed", 220))
        # the bench must not show a partial sum as the run's cost
        self.assertIsNone(atlas_provider._summary_cost(tot))

    def test_local_model_unchanged(self):
        rows, tot = self.run_logs({"a": result(0.9)}, {"a": {"provider": "ollama", "model": "qwen3:8b"}})
        self.assertEqual((rows["a"]["cost_usd"], rows["a"]["billing"], rows["a"]["local"]), (0.0, "local", True))
        self.assertEqual((tot["cost_usd"], tot["billing"], tot["tokens_local"]), (0.0, "local", 110))

    def test_bench_table_prints_na_for_a_plan_run(self):
        rows = atlas_provider.aggregate(
            [{"provider": "claude", "model": "m", "run": 1, "phase": "cold", "wall_s": 1, "tokens_in": 1, "tokens_out": 1,
              "tokens_cache_read": 1, "cost_usd": None, "pass": True, "fallback": None}]  # fmt: skip
        )
        table = atlas_provider.render_table(rows)
        self.assertIn("n/a", table)
        self.assertNotIn("0.0000", table)


if __name__ == "__main__":
    unittest.main()
