"""atlas_seats: mutation-hardening tests for every helper of the facade.

Both backend modules are patched; nothing spawns (Popen is mocked or a stub)."""

import contextlib
import io
import json
import os
import shutil as _shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_herdr  # noqa: E402
import atlas_rig  # noqa: E402
import atlas_seats as s  # noqa: E402


class SeatCase(unittest.TestCase):
    def env(self, **kw):
        s._reset_backend_cache()
        self.addCleanup(s._reset_backend_cache)
        p = mock.patch.dict(os.environ, kw)
        p.start()
        self.addCleanup(p.stop)
        if "ATLAS_SEAT_BACKEND" not in kw:
            os.environ.pop("ATLAS_SEAT_BACKEND", None)

    def tmpdir(self):
        d = tempfile.mkdtemp()
        self.addCleanup(_shutil.rmtree, d, True)
        return d


class NodeRule(SeatCase):
    def test_accepts_node_22_and_24_with_npm(self):
        with mock.patch.object(s.shutil, "which", return_value="/usr/bin/npm"):
            for v in ("v22.0.0", "v24.9.1", "22.1.0", "  v22.3.4\n"):
                self.assertIs(s._node_rule(v), True, v)

    def test_rejects_other_majors(self):
        with mock.patch.object(s.shutil, "which", return_value="/usr/bin/npm"):
            for v in (
                "v18.0.0",
                "v20.1.0",
                "v21.0.0",
                "v23.5.0",
                "v25.0.0",
                "v2.0.0",
                "v220.0.0",
            ):
                self.assertIs(s._node_rule(v), False, v)

    def test_needs_npm_even_for_a_good_node(self):
        with mock.patch.object(s.shutil, "which", return_value=None) as w:
            self.assertIs(s._node_rule("v22.0.0"), False)
        w.assert_called_with("npm")

    def test_garbage_version_raises_for_the_caller_to_swallow(self):
        with mock.patch.object(s.shutil, "which", return_value="/usr/bin/npm"):
            with self.assertRaises(ValueError):
                s._node_rule("not-a-version")


class NodeOk(SeatCase):
    def test_runs_node_version_with_timeout_and_applies_rule(self):
        done = mock.Mock(stdout="v22.4.0\n")
        with (
            mock.patch.object(s.subprocess, "run", return_value=done) as run,
            mock.patch.object(s.shutil, "which", return_value="/x/npm"),
        ):
            self.assertIs(s._node_ok(), True)
        self.assertEqual(run.call_args.args[0], ["node", "--version"])
        self.assertEqual(run.call_args.kwargs["timeout"], 5)
        self.assertIs(run.call_args.kwargs["capture_output"], True)
        self.assertIs(run.call_args.kwargs["text"], True)

    def test_wrong_major_is_false(self):
        with (
            mock.patch.object(
                s.subprocess, "run", return_value=mock.Mock(stdout="v20.0.0")
            ),
            mock.patch.object(s.shutil, "which", return_value="/x/npm"),
        ):
            self.assertIs(s._node_ok(), False)

    def test_missing_node_or_garbage_is_false_not_an_exception(self):
        with mock.patch.object(s.subprocess, "run", side_effect=FileNotFoundError):
            self.assertIs(s._node_ok(), False)
        with (
            mock.patch.object(
                s.subprocess, "run", return_value=mock.Mock(stdout="oops")
            ),
            mock.patch.object(s.shutil, "which", return_value="/x/npm"),
        ):
            self.assertIs(s._node_ok(), False)


class NodeOkCached(SeatCase):
    def setUp(self):
        self.home = os.path.join(self.tmpdir(), "h")  # does not exist yet
        self.fake_node = os.path.join(self.tmpdir(), "node")
        with open(self.fake_node, "w") as f:
            f.write("#!/bin/sh\n")
        st = os.stat(os.path.realpath(self.fake_node))
        self.key = [os.path.realpath(self.fake_node), st.st_mtime_ns, st.st_size]
        self.cache = os.path.join(self.home, "node-major-cache.json")

    def patches(self, which_node=True, npm=True, version="v22.1.0\n"):
        def which(name):
            if name == "node":
                return self.fake_node if which_node else None
            return "/x/npm" if npm else None

        return (
            mock.patch.object(s.shutil, "which", side_effect=which),
            mock.patch.object(
                s.subprocess, "run", return_value=mock.Mock(stdout=version)
            ),
        )

    def put_cache(self, obj):
        os.makedirs(self.home, exist_ok=True)
        with open(self.cache, "w") as f:
            f.write(obj if isinstance(obj, str) else json.dumps(obj))

    def test_no_node_is_false_and_runs_nothing(self):
        w, r = self.patches(which_node=False)
        with w, r as run:
            self.assertIs(s._node_ok_cached(self.home), False)
        run.assert_not_called()
        self.assertFalse(os.path.exists(self.cache))

    def test_miss_runs_node_once_and_writes_cache_atomically(self):
        w, r = self.patches()
        with w, r as run:
            self.assertIs(s._node_ok_cached(self.home), True)
        self.assertEqual(run.call_args.args[0], [self.fake_node, "--version"])
        self.assertEqual(run.call_args.kwargs["timeout"], 5)
        with open(self.cache) as f:
            self.assertEqual(json.load(f), {"key": self.key, "version": "v22.1.0"})
        self.assertFalse(os.path.exists(self.cache + ".tmp"))

    def test_hit_uses_cached_version_without_spawning(self):
        self.put_cache({"key": self.key, "version": "v24.0.0"})
        w, r = self.patches(version="v18.0.0")
        with w, r as run:
            self.assertIs(s._node_ok_cached(self.home), True)
        run.assert_not_called()

    def test_hit_with_bad_major_is_false_without_spawning(self):
        self.put_cache({"key": self.key, "version": "v20.0.0"})
        w, r = self.patches(version="v22.0.0")
        with w, r as run:
            self.assertIs(s._node_ok_cached(self.home), False)
        run.assert_not_called()

    def test_stale_key_reruns_and_rewrites(self):
        self.put_cache({"key": ["other", 1, 2], "version": "v22.0.0"})
        w, r = self.patches(version="v18.0.0")
        with w, r as run:
            self.assertIs(s._node_ok_cached(self.home), False)
        run.assert_called_once()
        with open(self.cache) as f:
            self.assertEqual(json.load(f)["version"], "v18.0.0")

    def test_mtime_mismatch_is_a_miss(self):
        self.put_cache(
            {"key": [self.key[0], self.key[1] + 1, self.key[2]], "version": "v22.0.0"}
        )
        w, r = self.patches(version="v24.0.0")
        with w, r as run:
            s._node_ok_cached(self.home)
        run.assert_called_once()

    def test_size_mismatch_is_a_miss(self):
        self.put_cache(
            {"key": [self.key[0], self.key[1], self.key[2] + 1], "version": "v22.0.0"}
        )
        w, r = self.patches(version="v24.0.0")
        with w, r as run:
            s._node_ok_cached(self.home)
        run.assert_called_once()

    def test_unusable_cache_falls_back_to_running_node(self):
        for body in ("{bad", "[1]", {"key": self.key}):
            self.put_cache(body)
            w, r = self.patches()
            with self.subTest(body=body), w, r as run:
                self.assertIs(s._node_ok_cached(self.home), True)
            run.assert_called_once()

    def test_subprocess_failure_is_false_and_never_cached(self):
        w, _ = self.patches()
        with w, mock.patch.object(s.subprocess, "run", side_effect=OSError("boom")):
            self.assertIs(s._node_ok_cached(self.home), False)
        self.assertFalse(os.path.exists(self.cache))

    def test_unwritable_home_still_returns_the_answer(self):
        blocker = os.path.join(self.tmpdir(), "file")
        with open(blocker, "w") as f:
            f.write("x")
        w, r = self.patches()
        with w, r:
            self.assertIs(s._node_ok_cached(os.path.join(blocker, "sub")), True)

    def test_npm_missing_means_false_even_with_node_22(self):
        w, r = self.patches(npm=False)
        with w, r:
            self.assertIs(s._node_ok_cached(self.home), False)


class DecideBackend(SeatCase):
    def d(self, rig=False, node=False, empty=False, up=False, inst=False):
        return s.decide_backend(
            lambda: rig, lambda: node, lambda: empty, lambda: up, lambda: inst
        )

    def test_rig_when_binary_or_node(self):
        self.assertEqual(self.d(rig="/bin/rig"), "rig")
        self.assertEqual(self.d(node=True), "rig")

    def test_herdr_wins_over_rig_only_when_no_rigs_and_server_up(self):
        self.assertEqual(self.d(rig=True, empty=True, up=True), "herdr")
        self.assertEqual(self.d(rig=True, empty=True, up=False), "rig")
        self.assertEqual(self.d(rig=True, empty=False, up=True), "rig")
        self.assertEqual(self.d(node=True, empty=True, up=True), "herdr")

    def test_without_rig_herdr_if_installed_or_server_up(self):
        self.assertEqual(self.d(inst=True), "herdr")
        self.assertEqual(self.d(up=True), "herdr")
        self.assertEqual(self.d(), "none")

    def test_empty_rigs_with_server_down_never_returns_herdr_without_rig(self):
        self.assertEqual(self.d(empty=True), "none")

    def test_probe_errors_fall_back_not_raise(self):
        def boom():
            raise RuntimeError("x")

        self.assertEqual(
            s.decide_backend(
                lambda: True, lambda: False, boom, lambda: True, lambda: False
            ),
            "rig",
        )
        self.assertEqual(
            s.decide_backend(
                lambda: True, lambda: False, lambda: True, boom, lambda: False
            ),
            "rig",
        )
        self.assertEqual(
            s.decide_backend(lambda: False, lambda: False, lambda: True, boom, boom),
            "none",
        )
        self.assertEqual(
            s.decide_backend(
                lambda: False, lambda: False, lambda: True, lambda: True, boom
            ),
            "none",
        )

    def test_probes_are_lazy(self):
        calls = []

        def probe(name, val):
            def f():
                calls.append(name)
                return val

            return f

        s.decide_backend(
            probe("bin", True),
            probe("node", True),
            probe("empty", False),
            probe("up", True),
            probe("inst", True),
        )
        self.assertEqual(calls, ["bin", "empty"])  # node, up, installed never ran
        calls.clear()
        s.decide_backend(
            probe("bin", False),
            probe("node", False),
            probe("empty", True),
            probe("up", False),
            probe("inst", True),
        )
        self.assertEqual(calls, ["bin", "node", "inst"])


class BackendCache(SeatCase):
    def test_env_values_are_trimmed_and_case_insensitive(self):
        self.env(ATLAS_SEAT_BACKEND="  HERDR ")
        self.assertEqual(s.backend(), "herdr")
        self.env(ATLAS_SEAT_BACKEND="Off")
        self.assertEqual(s.backend(), "none")

    def test_unknown_env_value_falls_through_to_detection(self):
        self.env(ATLAS_SEAT_BACKEND="bogus")
        with mock.patch.object(s, "_detect_backend", return_value="rig") as d:
            self.assertEqual(s.backend(), "rig")
        d.assert_called_once()

    def test_forced_backend_is_never_cached(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        s.backend()
        self.assertEqual(s._backend_cache, (0.0, None))

    def test_ttl_boundary(self):
        self.env()
        clock = [100.0]
        with (
            mock.patch.object(s.time, "monotonic", side_effect=lambda: clock[0]),
            mock.patch.object(
                s, "_detect_backend", side_effect=["rig", "herdr", "none"]
            ) as d,
        ):
            self.assertEqual(s.backend(), "rig")
            clock[0] = 100.0 + s._BACKEND_TTL_S - 0.1
            self.assertEqual(s.backend(), "rig")  # still fresh
            self.assertEqual(d.call_count, 1)
            clock[0] = 100.0 + s._BACKEND_TTL_S
            self.assertEqual(s.backend(), "herdr")  # expired exactly at the TTL
            self.assertEqual(d.call_count, 2)
            self.assertEqual(s._backend_cache[1], "herdr")

    def test_ttl_is_thirty_seconds(self):
        self.assertEqual(s._BACKEND_TTL_S, 30.0)

    def test_none_result_is_cached_too(self):
        self.env()
        with mock.patch.object(s, "_detect_backend", return_value="none") as d:
            s.backend()
            s.backend()
        self.assertEqual(d.call_count, 1)

    def test_reset_clears_cache(self):
        s._backend_cache = (5.0, "rig")
        s._reset_backend_cache()
        self.assertEqual(s._backend_cache, (0.0, None))


class DetectBackend(SeatCase):
    def test_forced_values(self):
        for raw, want in (("rig", "rig"), ("HERDR", "herdr"), (" off ", "none")):
            self.env(ATLAS_SEAT_BACKEND=raw)
            self.assertEqual(s._detect_backend(), want)

    def test_auto_detection_wires_the_right_probes(self):
        self.env()
        with (
            mock.patch.object(atlas_rig, "_bin", return_value=None),
            mock.patch.object(atlas_rig, "_rigs", return_value=["r"]),
            mock.patch.object(s, "_node_ok", return_value=True),
            mock.patch.object(atlas_herdr, "status", return_value={}),
        ):
            self.assertEqual(s._detect_backend(), "rig")  # node ok alone is enough
        with (
            mock.patch.object(atlas_rig, "_bin", return_value="/rig"),
            mock.patch.object(atlas_rig, "_rigs", return_value=[]),
            mock.patch.object(
                atlas_herdr,
                "status",
                return_value={"herdr_server": False, "installed": True},
            ),
        ):
            self.assertEqual(
                s._detect_backend(), "rig"
            )  # rigs empty but herdr server down
        with (
            mock.patch.object(atlas_rig, "_bin", return_value="/rig"),
            mock.patch.object(atlas_rig, "_rigs", return_value=[]),
            mock.patch.object(
                atlas_herdr, "status", return_value={"herdr_server": True}
            ),
        ):
            self.assertEqual(s._detect_backend(), "herdr")
        with (
            mock.patch.object(atlas_rig, "_bin", return_value=None),
            mock.patch.object(s, "_node_ok", return_value=False),
            mock.patch.object(atlas_herdr, "status", return_value={"installed": True}),
        ):
            self.assertEqual(s._detect_backend(), "herdr")
        with (
            mock.patch.object(atlas_rig, "_bin", return_value=None),
            mock.patch.object(s, "_node_ok", return_value=False),
            mock.patch.object(
                atlas_herdr, "status", return_value={"herdr_server": True}
            ),
        ):
            self.assertEqual(s._detect_backend(), "herdr")


class NullBackend(SeatCase):
    def test_status_exact(self):
        self.assertEqual(
            s._NullBackend.status(),
            {
                "ok": False,
                "running": False,
                "state": "no_backend",
                "reason": "no seat backend",
            },
        )

    def test_empty_answers(self):
        n = s._NullBackend()
        self.assertEqual(n.list_panes(), [])
        self.assertEqual(n.list_panes("run-1"), [])
        self.assertIs(n.pane_live("p"), False)
        self.assertEqual(
            n.agents(),
            {
                "reachable": False,
                "reason": "no seat backend",
                "workspaces": [],
                "agents": [],
            },
        )

    def test_other_calls_return_a_fresh_failure_dict_each_time(self):
        n = s._NullBackend()
        for name in (
            "ensure",
            "ensure_server",
            "create_pane",
            "close_pane",
            "send_prompt",
            "close_run",
        ):
            first = getattr(n, name)("a", 1, k=2)
            self.assertEqual(first, {"ok": False, "reason": "no seat backend"}, name)
            first["mut"] = True
            self.assertEqual(
                getattr(n, name)(), {"ok": False, "reason": "no seat backend"}, name
            )
        self.assertEqual(s._NO_BACKEND, {"ok": False, "reason": "no seat backend"})


class ModAndDelegate(SeatCase):
    def test_mod_picks_module_by_backend(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        self.assertIs(s._mod(), atlas_rig)
        os.environ["ATLAS_SEAT_BACKEND"] = "herdr"
        self.assertIs(s._mod(), atlas_herdr)
        os.environ["ATLAS_SEAT_BACKEND"] = "off"
        self.assertIsInstance(s._mod(), s._NullBackend)

    def test_every_name_delegates_with_args_and_kwargs(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        for name in s._NAMES:
            if name == "status":
                continue  # the public status() wraps it; covered below
            with (
                self.subTest(name),
                mock.patch.object(atlas_rig, name, return_value="R-" + name) as m,
            ):
                self.assertEqual(getattr(s, name)("a", 2, k=3), "R-" + name)
            m.assert_called_once_with("a", 2, k=3)

    def test_names_list_is_the_eight_delegated_calls(self):
        self.assertEqual(
            s._NAMES,
            (
                "status",
                "ensure",
                "ensure_server",
                "list_panes",
                "create_pane",
                "close_pane",
                "pane_live",
                "send_prompt",
            ),
        )

    def test_null_backend_delegation_returns_no_backend_answers(self):
        self.env(ATLAS_SEAT_BACKEND="off")
        self.assertEqual(s.ensure(), {"ok": False, "reason": "no seat backend"})
        self.assertEqual(s.list_panes(), [])


class Sources(SeatCase):
    def test_forced_rig_or_herdr_gives_that_single_module(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        self.assertEqual(s._sources(), [atlas_rig])
        os.environ["ATLAS_SEAT_BACKEND"] = "herdr"
        self.assertEqual(s._sources(), [atlas_herdr])

    def test_forced_off_gives_nothing(self):
        self.env(ATLAS_SEAT_BACKEND="off")
        self.assertEqual(s._sources(), [])

    def test_unforced_is_rig_plus_herdr_only_when_its_server_is_up(self):
        self.env()
        with mock.patch.object(
            atlas_herdr, "status", return_value={"herdr_server": True}
        ):
            self.assertEqual(s._sources(), [atlas_rig, atlas_herdr])
        with mock.patch.object(
            atlas_herdr, "status", return_value={"herdr_server": False}
        ):
            self.assertEqual(s._sources(), [atlas_rig])
        with mock.patch.object(atlas_herdr, "status", side_effect=RuntimeError("x")):
            self.assertEqual(s._sources(), [atlas_rig])

    def test_forced_helper(self):
        for v, want in (
            ("rig", True),
            ("herdr", True),
            ("off", True),
            (" RIG", True),
            ("", False),
            ("auto", False),
        ):
            with mock.patch.dict(os.environ, {"ATLAS_SEAT_BACKEND": v}):
                self.assertIs(s._forced(), want, v)
        with mock.patch.dict(os.environ):
            os.environ.pop("ATLAS_SEAT_BACKEND", None)
            self.assertIs(s._forced(), False)


class AgentsUnion(SeatCase):
    def src(self, **kw):
        return mock.Mock(agents=mock.Mock(return_value=kw))

    def test_no_sources_keeps_default_reason(self):
        with mock.patch.object(s, "_sources", return_value=[]):
            self.assertEqual(
                s.agents(),
                {
                    "reachable": False,
                    "reason": "no seat backend",
                    "workspaces": [],
                    "agents": [],
                },
            )

    def test_unreachable_sources_join_reasons_and_are_skipped(self):
        a = self.src(reachable=False, reason="A down", agents=[{"pane_id": "x"}])
        b = self.src(reachable=False, reason="B down")
        with mock.patch.object(s, "_sources", return_value=[a, b]):
            r = s.agents()
        self.assertEqual(
            r,
            {
                "reachable": False,
                "reason": "A down; B down",
                "workspaces": [],
                "agents": [],
            },
        )

    def test_unreachable_source_does_not_stop_later_reachable_ones(self):
        a = self.src(reachable=False, reason="A down")
        b = self.src(
            reachable=True,
            agents=[{"pane_id": "p1"}],
            workspaces=[{"workspace_id": "w1"}],
        )
        with mock.patch.object(s, "_sources", return_value=[a, b]):
            r = s.agents()
        self.assertIs(r["reachable"], True)
        self.assertIsNone(r["reason"])
        self.assertEqual(r["agents"], [{"pane_id": "p1"}])
        self.assertEqual(r["workspaces"], [{"workspace_id": "w1"}])

    def test_missing_reason_is_stringified(self):
        a = self.src(reachable=False)
        with mock.patch.object(s, "_sources", return_value=[a]):
            self.assertEqual(s.agents()["reason"], "None")

    def test_dedupe_is_per_kind_and_keeps_first_row(self):
        a = self.src(
            reachable=True,
            agents=[{"pane_id": "same", "v": 1}],
            workspaces=[{"workspace_id": "same", "v": 1}],
        )
        b = self.src(
            reachable=True,
            agents=[{"pane_id": "same", "v": 2}],
            workspaces=[{"workspace_id": "same", "v": 2}],
        )
        with mock.patch.object(s, "_sources", return_value=[a, b]):
            r = s.agents()
        self.assertEqual(r["agents"], [{"pane_id": "same", "v": 1}])
        self.assertEqual(r["workspaces"], [{"workspace_id": "same", "v": 1}])

    def test_reachable_source_without_row_keys_is_fine(self):
        a = self.src(reachable=True)
        with mock.patch.object(s, "_sources", return_value=[a]):
            r = s.agents()
        self.assertEqual((r["reachable"], r["agents"], r["workspaces"]), (True, [], []))


class CloseRun(SeatCase):
    def src(self, res):
        return mock.Mock(close_run=mock.Mock(return_value=res))

    def test_no_sources(self):
        with mock.patch.object(s, "_sources", return_value=[]):
            self.assertEqual(
                s.close_run("r"), {"ok": False, "reason": "no seat backend"}
            )

    def test_all_failed_returns_first_failure(self):
        a, b = (
            self.src({"ok": False, "reason": "first"}),
            self.src({"ok": False, "reason": "second"}),
        )
        with mock.patch.object(s, "_sources", return_value=[a, b]):
            self.assertEqual(s.close_run("r"), {"ok": False, "reason": "first"})
        a.close_run.assert_called_once_with("r")
        b.close_run.assert_called_once_with("r")

    def test_merges_only_successful_sources(self):
        a = self.src({"ok": True, "closed": ["c1"], "panes": ["p1"]})
        b = self.src({"ok": False, "closed": ["bad"], "panes": ["bad"]})
        c = self.src({"ok": True, "closed": ["c2"]})
        with mock.patch.object(s, "_sources", return_value=[a, b, c]):
            self.assertEqual(
                s.close_run("r"), {"ok": True, "closed": ["c1", "c2"], "panes": ["p1"]}
            )


class StatusAndCapture(SeatCase):
    def test_none_backend_status_carries_null_status_plus_backend_fields(self):
        self.env(ATLAS_SEAT_BACKEND="off")
        self.assertEqual(
            s.status(),
            {
                "ok": False,
                "running": False,
                "state": "no_backend",
                "reason": "no seat backend",
                "backend": "none",
                "web_ui": False,
            },
        )

    def test_rig_without_tmux_reason_text(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        with (
            mock.patch.object(atlas_rig, "status", return_value={"ok": True, "n": 1}),
            mock.patch.object(s.shutil, "which", return_value=None) as w,
        ):
            out = s.status()
        w.assert_called_with("tmux")
        self.assertEqual(
            out,
            {
                "ok": False,
                "n": 1,
                "reason": "tmux is not installed (rig seats run in tmux)",
                "backend": "rig",
                "web_ui": False,
            },
        )

    def test_herdr_status_ignores_tmux_check(self):
        self.env(ATLAS_SEAT_BACKEND="herdr")
        with (
            mock.patch.object(atlas_herdr, "status", return_value={"ok": True}),
            mock.patch.object(s.shutil, "which", return_value=None),
        ):
            self.assertEqual(
                s.status(), {"ok": True, "backend": "herdr", "web_ui": True}
            )

    def test_capture_rig_defaults_to_40_lines(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        with mock.patch.object(atlas_rig, "capture", return_value={"ok": True}) as c:
            s.capture("p")
        c.assert_called_once_with("p", 40)

    def test_capture_herdr_defaults_and_timeout(self):
        self.env(ATLAS_SEAT_BACKEND="herdr")
        with mock.patch.object(
            atlas_herdr, "rpc", return_value={"read": {"text": "t"}}
        ) as r:
            s.capture("p")
        self.assertEqual(r.call_args.args[1]["lines"], 40)
        self.assertEqual(r.call_args.kwargs, {"timeout": 2.0})

    def test_capture_herdr_odd_payloads_become_empty_text(self):
        self.env(ATLAS_SEAT_BACKEND="herdr")
        for payload in ({"read": "str"}, {"read": {"text": 5}}, {"read": {}}, {}):
            with (
                self.subTest(payload),
                mock.patch.object(atlas_herdr, "rpc", return_value=payload),
            ):
                self.assertEqual(
                    s.capture("p"), {"ok": True, "pane_id": "p", "text": ""}
                )

    def test_capture_unsupported_for_none(self):
        self.env(ATLAS_SEAT_BACKEND="off")
        self.assertEqual(s.capture("p"), {"ok": False, "error": "not_supported"})


class HerdrPassthroughs(SeatCase):
    def test_lazy_exception_attributes(self):
        self.assertIs(s.PromptRefused, atlas_herdr.PromptRefused)
        self.assertIs(s.SockError, atlas_herdr.HerdrSockError)

    def test_unknown_attribute_raises_attribute_error(self):
        with self.assertRaises(AttributeError):
            s.no_such_thing  # noqa: B018
        self.assertFalse(hasattr(s, "promptrefused"))

    def test_rpc_forwards_with_default_timeout(self):
        with mock.patch.object(atlas_herdr, "rpc", return_value={"r": 1}) as r:
            self.assertEqual(s.rpc("m", {"a": 1}), {"r": 1})
            s.rpc("m2")
            s.rpc("m3", None, timeout=9.0)
        self.assertEqual(r.call_args_list[0], mock.call("m", {"a": 1}, timeout=0.5))
        self.assertEqual(r.call_args_list[1], mock.call("m2", None, timeout=0.5))
        self.assertEqual(r.call_args_list[2], mock.call("m3", None, timeout=9.0))

    def test_web_url_refreshes_then_returns_second_tuple_item(self):
        order = []

        def where():
            order.append("where")
            return ("a", "http://ui", None)

        with (
            mock.patch.object(
                atlas_herdr, "_refresh_url", side_effect=lambda: order.append("refresh")
            ),
            mock.patch.object(atlas_herdr, "_where", side_effect=where),
        ):
            self.assertEqual(s.web_url(), "http://ui")
        self.assertEqual(order, ["refresh", "where"])

    def test_reset_status_cache_drops_herdr_cache(self):
        with mock.patch.object(atlas_herdr, "_status_cache", (1.0, {"x": 1})):
            s.reset_status_cache()
            self.assertIsNone(atlas_herdr._status_cache)


class FlagOff(SeatCase):
    def test_flag_values(self):
        for v in ("0", "off", "false", "no", "OFF", "False", "NO"):
            with mock.patch.dict(os.environ, {"X_FLAG": v}):
                self.assertIs(s._flag_off("X_FLAG"), True, v)
        for v in ("1", "on", "true", "yes", "", "anything"):
            with mock.patch.dict(os.environ, {"X_FLAG": v}):
                self.assertIs(s._flag_off("X_FLAG"), False, v)

    def test_unset_means_on(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("X_FLAG_UNSET", None)
            self.assertIs(s._flag_off("X_FLAG_UNSET"), False)


class EnsureBackgroundMore(SeatCase):
    def setUp(self):
        self.home = self.tmpdir()
        self.env(ATLAS_HOME=self.home, ATLAS_SEAT_BACKEND="rig")
        for k in ("ATLAS_COLONY", "ATLAS_HERDR_AUTOSTART"):
            os.environ.pop(k, None)
        self.state = Path(self.home) / "seat-ensure-state.json"

    def write_state(self, state, age):
        self.state.write_text(json.dumps({"state": state, "at": time.time() - age}))

    def test_constants(self):
        self.assertEqual((s.ENSURE_BACKOFF_S, s.ENSURE_PENDING_S), (1800, 240))

    def test_spawn_command_shape_env_and_state_marker(self):
        with mock.patch("subprocess.Popen") as popen:
            self.assertEqual(s.ensure_background(), "started")
        st = json.loads(self.state.read_text())
        self.assertEqual(st["state"], "starting")
        self.assertAlmostEqual(st["at"], time.time(), delta=5)
        argv = popen.call_args.args[0]
        self.assertEqual(argv[:2], ["sh", "-c"])
        self.assertEqual(argv[3], sys.executable)
        self.assertEqual(argv[4], os.path.abspath(s.__file__))
        self.assertEqual(argv[5], os.path.join(self.home, "seat-status-cache.json"))
        self.assertEqual(argv[6], os.path.join(self.home, "seat-ensure.log"))
        self.assertEqual(argv[7], str(self.state))
        kw = popen.call_args.kwargs
        self.assertIs(kw["stdin"], s.subprocess.DEVNULL)
        self.assertIs(kw["stdout"], s.subprocess.DEVNULL)
        self.assertIs(kw["stderr"], s.subprocess.DEVNULL)
        self.assertIs(kw["start_new_session"], True)
        self.assertEqual(kw["env"]["ATLAS_HOME"], self.home)

    def test_failed_inside_window_backs_off_and_outside_retries(self):
        self.write_state("failed", s.ENSURE_BACKOFF_S - 5)
        with mock.patch("subprocess.Popen") as popen:
            self.assertEqual(s.ensure_background(), "backoff")
        popen.assert_not_called()
        self.write_state("failed", s.ENSURE_BACKOFF_S + 5)
        with mock.patch("subprocess.Popen"):
            self.assertEqual(s.ensure_background(), "started")

    def test_starting_inside_window_is_pending_outside_restarts(self):
        self.write_state("starting", s.ENSURE_PENDING_S - 5)
        with mock.patch("subprocess.Popen") as popen:
            self.assertEqual(s.ensure_background(), "pending")
        popen.assert_not_called()
        self.write_state("starting", s.ENSURE_PENDING_S + 5)
        with mock.patch("subprocess.Popen") as popen:
            self.assertEqual(s.ensure_background(), "started")
        popen.assert_called_once()

    def test_failed_state_uses_backoff_window_not_pending_window(self):
        self.write_state("failed", 300)  # past PENDING, inside BACKOFF
        with mock.patch("subprocess.Popen"):
            self.assertEqual(s.ensure_background(), "backoff")
        self.write_state("starting", 300)  # stale: past PENDING
        with mock.patch("subprocess.Popen"):
            self.assertEqual(s.ensure_background(), "started")

    def test_marker_from_the_future_is_ignored(self):
        self.write_state("failed", -100)
        with mock.patch("subprocess.Popen"):
            self.assertEqual(s.ensure_background(), "started")
        self.write_state("starting", -100)
        with mock.patch("subprocess.Popen"):
            self.assertEqual(s.ensure_background(), "started")

    def test_corrupt_marker_is_ignored(self):
        for body in ("{bad", "[1]", json.dumps({"state": "failed", "at": "soon"})):
            self.state.write_text(body)
            with self.subTest(body), mock.patch("subprocess.Popen"):
                self.assertEqual(s.ensure_background(), "started")

    def test_marker_without_at_counts_as_epoch_old(self):
        self.state.write_text(json.dumps({"state": "failed"}))
        with mock.patch("subprocess.Popen"):
            self.assertEqual(s.ensure_background(), "started")

    def test_unknown_state_value_does_not_block(self):
        self.write_state("done", 1)
        with mock.patch("subprocess.Popen"):
            self.assertEqual(s.ensure_background(), "started")

    def test_popen_failure_returns_error_and_removes_marker(self):
        with mock.patch("subprocess.Popen", side_effect=OSError("no sh")):
            self.assertEqual(s.ensure_background(), "error")
        self.assertFalse(self.state.exists())

    def test_creates_missing_home(self):
        nested = os.path.join(self.home, "a", "b")
        os.environ["ATLAS_HOME"] = nested
        with mock.patch("subprocess.Popen"):
            self.assertEqual(s.ensure_background(), "started")
        self.assertTrue(os.path.isfile(os.path.join(nested, "seat-ensure-state.json")))

    def test_home_defaults_to_dot_atlas_under_user_home(self):
        os.environ.pop("ATLAS_HOME", None)
        fake_home = self.tmpdir()
        with (
            mock.patch("subprocess.Popen"),
            mock.patch.object(s.os.path, "expanduser", return_value=fake_home),
        ):
            self.assertEqual(s.ensure_background(), "started")
        self.assertTrue(
            os.path.isfile(os.path.join(fake_home, ".atlas", "seat-ensure-state.json"))
        )

    def test_backend_none_vs_herdr_literals(self):
        for be, want in (("off", "none"), ("herdr", "herdr")):
            os.environ["ATLAS_SEAT_BACKEND"] = be
            with mock.patch("subprocess.Popen") as popen:
                self.assertEqual(s.ensure_background(), want)
            popen.assert_not_called()


class MainCli(SeatCase):
    def run_main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = s.main(argv)
        return rc, out.getvalue(), err.getvalue()

    def test_help_prints_usage_and_choices(self):
        for flag in ("-h", "--help"):
            rc, out, _ = self.run_main(["atlas_seats.py", flag])
            self.assertEqual(rc, 0)
            self.assertIn("usage: atlas_seats.py", out)
            for c in ("agents", "backend", "ensure", "list-panes", "status"):
                self.assertIn(c, out)

    def test_wrong_arity_or_unknown_command_is_usage_error(self):
        for argv in (["x"], ["x", "bogus"], ["x", "status", "extra"], []):
            rc, out, err = self.run_main(argv)
            self.assertEqual(rc, 2, argv)
            self.assertEqual(out, "")
            self.assertEqual(
                err, "usage: atlas_seats.py backend|status|ensure|list-panes|agents\n"
            )

    def test_help_with_extra_args_is_not_help(self):
        rc, _, err = self.run_main(["x", "--help", "more"])
        self.assertEqual(rc, 2)
        self.assertIn("usage:", err)

    def test_backend_command_prints_json_and_exits_zero(self):
        self.env(ATLAS_SEAT_BACKEND="herdr")
        rc, out, _ = self.run_main(["x", "backend"])
        self.assertEqual(rc, 0)
        self.assertEqual(out, json.dumps({"backend": "herdr"}, indent=2) + "\n")

    def test_status_exit_code_follows_ok(self):
        self.env(ATLAS_SEAT_BACKEND="off")
        rc, out, _ = self.run_main(["x", "status"])
        self.assertEqual(rc, 1)
        self.assertEqual(json.loads(out)["backend"], "none")
        self.env(ATLAS_SEAT_BACKEND="herdr")
        with mock.patch.object(atlas_herdr, "status", return_value={"ok": True}):
            rc, out, _ = self.run_main(["x", "status"])
        self.assertEqual(rc, 0)
        self.assertEqual(
            json.loads(out), {"ok": True, "backend": "herdr", "web_ui": True}
        )

    def test_dict_without_ok_key_counts_as_success(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        with mock.patch.object(atlas_rig, "ensure", return_value={"url": "u"}):
            rc, out, _ = self.run_main(["x", "ensure"])
        self.assertEqual((rc, json.loads(out)), (0, {"url": "u"}))

    def test_list_panes_list_result_is_always_zero(self):
        self.env(ATLAS_SEAT_BACKEND="off")
        rc, out, _ = self.run_main(["x", "list-panes"])
        self.assertEqual((rc, json.loads(out)), (0, []))

    def test_agents_command_has_no_ok_key_so_exits_zero(self):
        self.env(ATLAS_SEAT_BACKEND="off")
        rc, out, _ = self.run_main(["x", "agents"])
        self.assertEqual(rc, 0)
        self.assertIs(json.loads(out)["reachable"], False)

    def test_ensure_command_failure_exits_one(self):
        self.env(ATLAS_SEAT_BACKEND="off")
        rc, out, _ = self.run_main(["x", "ensure"])
        self.assertEqual(rc, 1)
        self.assertEqual(json.loads(out), {"ok": False, "reason": "no seat backend"})


if __name__ == "__main__":
    unittest.main()
