"""Extra atlas_rig tests: pure helpers, argument contracts and result shapes. `_rig`/`_healthz` are patched."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402
import atlas_rig as r  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        r._ps_cache.clear()
        self.addCleanup(r._ps_cache.clear)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = mock.patch.dict(os.environ, {"ATLAS_HOME": self.tmp.name})
        p.start()
        self.addCleanup(p.stop)


class PortTests(Base):
    def test_port_default_env_and_garbage(self):
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_RIG_PORT"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(r._port(), r.DEFAULT_PORT)
            self.assertEqual(r._url(), f"http://127.0.0.1:{r.DEFAULT_PORT}")
        with mock.patch.dict(os.environ, {"ATLAS_RIG_PORT": "9123"}):
            self.assertEqual(r._port(), 9123)
            self.assertEqual(r._url(), "http://127.0.0.1:9123")
            self.assertEqual(r._env()["OPENRIG_PORT"], "9123")
            self.assertEqual(r._env()["OPENRIG_URL"], "http://127.0.0.1:9123")
        with mock.patch.dict(os.environ, {"ATLAS_RIG_PORT": "nope"}):
            self.assertEqual(r._port(), r.DEFAULT_PORT)


class BinTests(Base):
    def test_private_prefix_binary_wins_over_path(self):
        exe = Path(self.tmp.name) / "openrig" / "npm" / "node_modules" / ".bin" / "rig"
        exe.parent.mkdir(parents=True)
        exe.write_text("#!/bin/sh\n")
        with mock.patch.object(r.shutil, "which", return_value="/usr/bin/rig"):
            self.assertEqual(r._bin(), str(exe))

    def test_falls_back_to_path_then_none(self):
        with mock.patch.object(r.shutil, "which", return_value="/usr/bin/rig"):
            self.assertEqual(r._bin(), "/usr/bin/rig")
        with mock.patch.object(r.shutil, "which", return_value=None):
            self.assertIsNone(r._bin())

    def test_env_sets_home_and_no_kernel(self):
        e = r._env()
        self.assertEqual(e["OPENRIG_HOME"], str(Path(self.tmp.name) / "openrig" / "home"))
        self.assertEqual(e["OPENRIG_NO_KERNEL"], "1")


class RigRunTests(Base):
    def _script(self, body):
        exe = Path(self.tmp.name) / "fakerig"
        exe.write_text("#!/bin/sh\n" + body)
        exe.chmod(0o755)
        return str(exe)

    def test_missing_binary_is_127(self):
        with mock.patch.object(r, "_bin", return_value=None):
            self.assertEqual(r._rig(["ps"]), (127, None, "rig_missing"))

    def test_json_stdout_parsed_and_rc_passed(self):
        exe = self._script('echo \'{"a": [1, 2]}\'\nexit 0\n')
        with mock.patch.object(r, "_bin", return_value=exe):
            self.assertEqual(r._rig(["x"]), (0, {"a": [1, 2]}, ""))

    def test_non_json_and_empty_stdout_give_none_and_stderr_tail(self):
        exe = self._script("echo notjson\necho oops >&2\nexit 3\n")
        with mock.patch.object(r, "_bin", return_value=exe):
            rc, data, err = r._rig(["x"])
        self.assertEqual((rc, data), (3, None))
        self.assertEqual(err.strip(), "oops")
        exe = self._script("exit 0\n")
        with mock.patch.object(r, "_bin", return_value=exe):
            self.assertEqual(r._rig(["x"]), (0, None, ""))

    def test_stderr_is_truncated_to_last_300_chars(self):
        exe = self._script("i=0; while [ $i -lt 500 ]; do printf a >&2; i=$((i+1)); done; printf Z >&2\nexit 1\n")
        with mock.patch.object(r, "_bin", return_value=exe):
            _, _, err = r._rig(["x"])
        self.assertEqual(len(err), 300)
        self.assertTrue(err.endswith("Z"))

    def test_args_and_env_reach_the_binary(self):
        exe = self._script('printf \'{"argv": "%s", "home": "%s"}\' "$*" "$OPENRIG_HOME"\n')
        with mock.patch.object(r, "_bin", return_value=exe):
            _, data, _ = r._rig(["ps", "--json"])
        self.assertEqual(data["argv"], "ps --json")
        self.assertEqual(data["home"], str(r._rig_home()))

    def test_oserror_on_spawn_is_127(self):
        with mock.patch.object(r, "_bin", return_value="/fake/rig"), mock.patch.object(
            r.subprocess, "Popen", side_effect=OSError("nope")
        ):
            self.assertEqual(r._rig(["x"]), (127, None, "nope"))


class HealthzTests(Base):
    def _urlopen(self, payload):
        resp = mock.MagicMock()
        resp.__enter__.return_value.read.return_value = payload
        return resp

    def test_ok_payload_returned_and_url_and_timeout(self):
        import urllib.request

        with mock.patch.object(
            urllib.request, "urlopen", return_value=self._urlopen(b'{"status": "ok", "pid": 4}')
        ) as u:
            self.assertEqual(r._healthz(), {"status": "ok", "pid": 4})
        self.assertEqual(u.call_args[0][0], f"{r._url()}/healthz")
        self.assertEqual(u.call_args[1]["timeout"], 2)

    def test_bad_status_non_dict_garbage_and_errors_are_none(self):
        import urllib.request

        for payload in (b'{"status": "bad"}', b"[1]", b"not json", b'{"pid": 1}'):
            with mock.patch.object(urllib.request, "urlopen", return_value=self._urlopen(payload)):
                self.assertIsNone(r._healthz(), payload)
        with mock.patch.object(urllib.request, "urlopen", side_effect=OSError("refused")):
            self.assertIsNone(r._healthz())


class HelperTests(Base):
    def test_safe_replaces_unsafe_chars_and_defaults(self):
        self.assertEqual(r._safe("a b/c:d"), "a-b-c-d")
        self.assertEqual(r._safe("ok_1.2-x"), "ok_1.2-x")
        self.assertEqual(r._safe(""), "work")
        self.assertEqual(r._safe(12), "12")

    def test_ok_err_shapes(self):
        self.assertEqual(r._ok(a=1), {"ok": True, "a": 1})
        self.assertEqual(r._err("why", p=2), {"ok": False, "reason": "why", "p": 2})

    def test_member_strips_rig_prefix(self):
        self.assertEqual(r._member({"logicalId": "w.alpha"}), "alpha")
        self.assertEqual(r._member({"logicalId": "w.a.b"}), "a.b")
        self.assertEqual(r._member({"logicalId": "solo"}), "solo")
        self.assertEqual(r._member({}), "")

    def test_member_spec_exact(self):
        self.assertEqual(
            r._member_spec({"id": "m1", "cwd": "/w"}),
            {
                "id": "m1",
                "label": "m1",
                "agent_ref": "builtin:terminal",
                "profile": "none",
                "runtime": "terminal",
                "cwd": "/w",
            },
        )

    def test_spec_is_json_scalar_yaml_with_every_member(self):
        s = r._spec("run 1", [{"id": "a", "cwd": "/x y"}, {"id": "b", "cwd": "/z"}])
        lines = s.splitlines()
        self.assertEqual(lines[0], 'version: "0.2"')
        self.assertEqual(lines[1], 'name: "run 1"')
        self.assertIn("  - id: w", lines)
        self.assertIn('        cwd: "/x y"', lines)
        self.assertIn('        cwd: "/z"', lines)
        self.assertEqual(sum(1 for l in lines if l.startswith("      - id:")), 2)
        self.assertEqual(sum(1 for l in lines if "runtime: terminal" in l), 2)
        self.assertTrue(s.endswith("\n"))

    def test_nodes_filters_non_dicts_and_failure(self):
        with mock.patch.object(r, "_rig", return_value=(0, [{"a": 1}, "x", None], "")) as p:
            self.assertEqual(r._nodes("run1"), [{"a": 1}])
        self.assertEqual(p.call_args[0][0], ["ps", "--nodes", "--rig", "run1", "--json"])
        r._ps_cache.clear()
        with mock.patch.object(r, "_rig", return_value=(1, [{"a": 1}], "")):
            self.assertEqual(r._nodes("run1"), [])
        r._ps_cache.clear()
        with mock.patch.object(r, "_rig", return_value=(0, {"a": 1}, "")):
            self.assertEqual(r._nodes("run1"), [])

    def test_rigs_names_only_and_none_on_failure(self):
        data = [{"name": "r1"}, {"name": ""}, {"x": 1}, "junk", {"name": 5}]
        with mock.patch.object(r, "_rig", return_value=(0, data, "")):
            self.assertEqual(r._rigs(), ["r1", "5"])
        r._ps_cache.clear()
        with mock.patch.object(r, "_rig", return_value=(1, data, "")):
            self.assertIsNone(r._rigs())
        r._ps_cache.clear()
        with mock.patch.object(r, "_rig", return_value=(0, None, "")):
            self.assertIsNone(r._rigs())

    def test_ps_uses_probe_timeout_and_ttl_expiry(self):
        with mock.patch.object(r, "_rig", return_value=(0, [], "")) as p, mock.patch.object(
            r.time, "monotonic", side_effect=[100.0, 101.0, 100.0 + r._PS_TTL_S, 200.0, 200.0 + r._PS_TTL_S - 0.5]
        ):
            r._ps(["ps"])  # miss, stamps 100.0
            r._ps(["ps"])  # hit at 101.0
            self.assertEqual(p.call_count, 1)
            r._ps(["ps"])  # age == TTL counts as expired
            self.assertEqual(p.call_count, 2)
            r._ps(["ps"])  # fresh again at 200.0, hit just under TTL
            self.assertEqual(p.call_count, 2)
        self.assertEqual(p.call_args[1]["timeout"], r._PROBE_TIMEOUT_S)


class StatusEnsureTests(Base):
    def test_status_fields_when_healthy(self):
        with mock.patch.object(r, "_healthz", return_value={"status": "ok", "pid": 7, "semver": "1.2.3"}), mock.patch.object(
            r, "_bin", return_value="/x/rig"
        ):
            s = r.status()
        self.assertEqual(s["pid"], 7)
        self.assertEqual(s["rig_version"], "1.2.3")
        self.assertTrue(s["running"] and s["installed"])
        self.assertNotIn("reason", s)
        self.assertEqual(s["url"], r._url())
        self.assertEqual(s["rig_home"], str(r._rig_home()))

    def test_status_reasons(self):
        with mock.patch.object(r, "_healthz", return_value=None):
            with mock.patch.object(r, "_bin", return_value="/x/rig"):
                s = r.status()
                self.assertEqual((s["state"], s["reason"], s["running"]), ("server_down", "connection_refused", False))
            with mock.patch.object(r, "_bin", return_value=None):
                s = r.status()
                self.assertEqual((s["reason"], s["installed"]), ("rig_missing", False))
        with mock.patch.object(r, "_healthz", return_value={"status": "ok"}), mock.patch.object(r, "_bin", return_value=None):
            self.assertEqual(r.status()["reason"], "rig_missing")

    def test_ensure_merges_status_without_overriding_server_keys(self):
        with mock.patch.object(r, "ensure_server", return_value={"ok": True, "action": "already_up", "url": "U", "state": "S"}), mock.patch.object(
            r, "status", return_value={"state": "other", "pid": 9, "url": "X"}
        ):
            out = r.ensure()
        self.assertEqual(out["state"], "S")
        self.assertEqual(out["url"], "U")
        self.assertEqual(out["pid"], 9)

    def test_ensure_server_already_up_runs_nothing(self):
        with mock.patch.object(r, "_healthz", return_value={"status": "ok"}), mock.patch.object(r, "_rig") as rg:
            out = r.ensure_server()
        self.assertEqual(out, {"ok": True, "action": "already_up", "url": r._url()})
        rg.assert_not_called()

    def test_ensure_server_starts_daemon_with_port_args(self):
        health = iter([None, None, {"status": "ok"}])
        with mock.patch.object(r, "_healthz", side_effect=lambda: next(health)), mock.patch.object(
            r, "_bin", return_value="/x/rig"
        ), mock.patch.object(r, "_rig", return_value=(0, None, "")) as rg, mock.patch.object(
            r, "_quarantine_vendored_skills"
        ) as q, mock.patch.object(r.time, "sleep"):
            out = r.ensure_server(wait=5)
        self.assertEqual(out["action"], "started")
        args, timeout = rg.call_args[0]
        self.assertEqual(args, ["daemon", "start", "--no-kernel", "--host", "127.0.0.1", "--port", str(r._port())])
        self.assertEqual(timeout, 60)
        self.assertEqual(q.call_count, 2)

    def test_ensure_server_installs_when_binary_missing_and_propagates_failure(self):
        with mock.patch.object(r, "_healthz", return_value=None), mock.patch.object(r, "_bin", return_value=None), mock.patch.object(
            r, "install", return_value={"ok": False, "action": "unsupported_node", "reason": "x"}
        ), mock.patch.object(r, "_rig") as rg:
            out = r.ensure_server(wait=0)
        self.assertEqual(out["action"], "unsupported_node")
        rg.assert_not_called()

    def test_ensure_server_does_not_install_when_binary_present(self):
        with mock.patch.object(r, "_healthz", return_value=None), mock.patch.object(r, "_bin", return_value="/x/rig"), mock.patch.object(
            r, "install"
        ) as ins, mock.patch.object(r, "_rig", return_value=(5, None, "tail")), mock.patch.object(r, "_quarantine_vendored_skills"):
            out = r.ensure_server(wait=0)
        ins.assert_not_called()
        self.assertFalse(out["ok"])
        self.assertIn("rc=5", out["reason"])
        self.assertIn("tail", out["reason"])


class InstallTests(Base):
    def test_present_short_circuits(self):
        with mock.patch.object(r, "_bin", return_value="/x/rig"):
            self.assertEqual(r.install(), {"ok": True, "action": "present"})

    def test_unsupported_node_versions(self):
        def run(major):
            return mock.Mock(returncode=0, stdout=f"v{major}.1.0\n")

        for major in (20, 23, 25):
            with mock.patch.object(r, "_bin", return_value=None), mock.patch.object(r.shutil, "which", return_value="/usr/bin/npm"), mock.patch.object(
                r.subprocess, "run", return_value=run(major)
            ):
                out = r.install()
            self.assertEqual(out["action"], "unsupported_node", major)
            self.assertIn(f"node major {major}", out["reason"])

    def test_supported_majors_install_with_pinned_version(self):
        for major in (22, 24):
            calls = []

            def run(cmd, **kw):
                calls.append(cmd)
                return mock.Mock(returncode=0, stdout=f"v{major}.3.1\n")

            with mock.patch.object(r, "_bin", return_value=None), mock.patch.object(r.shutil, "which", return_value="/usr/bin/npm"), mock.patch.object(
                r.subprocess, "run", side_effect=run
            ):
                out = r.install(log_path=str(Path(self.tmp.name) / "l" / "i.log"))
            self.assertEqual(out, {"ok": True, "action": "installed"})
            npm = calls[1]
            self.assertEqual(npm[:2], ["/usr/bin/npm", "install"])
            self.assertIn(f"@openrig/cli@{r.RIG_VERSION}", npm)
            self.assertEqual(npm[npm.index("--prefix") + 1], str(Path(self.tmp.name) / "openrig" / "npm"))

    def test_npm_missing_and_node_failure(self):
        with mock.patch.object(r, "_bin", return_value=None), mock.patch.object(r.shutil, "which", return_value=None), mock.patch.object(
            r.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="v22.0.0")
        ):
            out = r.install()
        self.assertEqual(out["action"], "unsupported_node")
        self.assertIn("npm missing", out["reason"])
        with mock.patch.object(r, "_bin", return_value=None), mock.patch.object(r.shutil, "which", return_value="/usr/bin/npm"), mock.patch.object(
            r.subprocess, "run", return_value=mock.Mock(returncode=1, stdout="")
        ):
            out = r.install()
        self.assertIn("node major missing", out["reason"])

    def test_npm_failure_reports_exit_code_and_default_log(self):
        seq = [mock.Mock(returncode=0, stdout="v22.1.0"), mock.Mock(returncode=7, stdout="")]
        with mock.patch.object(r, "_bin", return_value=None), mock.patch.object(r.shutil, "which", return_value="/usr/bin/npm"), mock.patch.object(
            r.subprocess, "run", side_effect=seq
        ):
            out = r.install()
        self.assertFalse(out["ok"])
        self.assertEqual(out["action"], "error")
        self.assertIn("npm exit 7", out["reason"])
        self.assertTrue((Path(self.tmp.name) / "openrig" / "install.log").exists())

    def test_never_raises(self):
        with mock.patch.object(r, "_bin", return_value=None), mock.patch.object(r.shutil, "which", side_effect=RuntimeError("bang")):
            out = r.install()
        self.assertEqual(out["action"], "error")
        self.assertIn("RuntimeError: bang", out["reason"])


class SeatMoreTests(Base):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(r, "_bin", return_value="/fake/rig")
        p.start()
        self.addCleanup(p.stop)

    def _node(self, name, run="run1", **kw):
        return {"logicalId": f"w.{name}", "canonicalSessionName": f"w-{name}@{run}", "cwd": f"/{name}", **kw}

    def test_list_panes_shape_and_skips_nodes_without_session(self):
        nodes = [self._node("a"), {"logicalId": "w.b", "canonicalSessionName": ""}, {"logicalId": "w.c"}]
        with mock.patch.object(r, "_rig", return_value=(0, nodes, "")) as rg:
            out = r.list_panes("run 1")
        self.assertEqual(
            out,
            [{"pane_id": "w-a@run1", "workspace_id": "run-1", "workspace": "run-1", "tab_id": None, "label": "a", "cwd": "/a"}],
        )
        self.assertEqual(rg.call_args[0][0][3], "run-1")

    def test_list_panes_all_rigs_when_no_run(self):
        def fake(args, timeout=10):
            if args == ["ps", "--json"]:
                return 0, [{"name": "r1"}, {"name": "r2"}], ""
            return 0, [self._node("a", run=args[3])], ""

        with mock.patch.object(r, "_rig", side_effect=fake):
            out = r.list_panes()
        self.assertEqual(sorted(p["workspace_id"] for p in out), ["r1", "r2"])

    def test_list_panes_never_raises(self):
        with mock.patch.object(r, "_nodes", side_effect=RuntimeError("x")):
            self.assertEqual(r.list_panes("run1"), [])

    def test_create_pane_first_uses_up_then_sends_command(self):
        calls = []

        def fake(args, timeout=10):
            calls.append((args, timeout))
            return 0, ([] if args[0] == "ps" else {"ok": True}), ""

        with mock.patch.object(r, "_rig", side_effect=fake):
            out = r.create_pane("my worker", "echo hi", cwd="/w", run="run 1", env={"A": "b"}, focus=True)
        self.assertEqual(
            out,
            {"ok": True, "pane_id": "w-my-worker@run-1", "workspace_id": "run-1", "tab_id": None, "name": "my worker", "run": "run 1"},
        )
        up = next(c for c in calls if c[0][0] == "up")
        spec = Path(up[0][1])
        self.assertEqual(spec, r._rig_home() / "specs" / "run-1.yaml")
        self.assertEqual(up[0][2:], ["--yes", "--json"])
        self.assertEqual(up[1], 60)
        text = spec.read_text()
        self.assertIn('- id: "my-worker"', text)
        self.assertIn('cwd: "/w"', text)
        send = calls[-1][0]
        self.assertEqual(send, ["send", "w-my-worker@run-1", "echo hi", "--raw", "--json"])

    def test_create_pane_second_member_uses_add_with_fragment_and_keeps_peers(self):
        calls = []

        def fake(args, timeout=10):
            calls.append((args, timeout))
            if args[0] == "ps":
                return 0, [self._node("a", cwd="")] if False else [{**self._node("a"), "cwd": ""}], ""
            return 0, {"ok": True}, ""

        with mock.patch.object(r, "_rig", side_effect=fake):
            out = r.create_pane("b", "cmd", cwd="/fallback", run="run1")
        self.assertTrue(out["ok"], out)
        self.assertFalse(any(c[0][0] == "up" for c in calls))
        add = next(c for c in calls if c[0][0] == "add")
        self.assertEqual(add[0][1:3], ["run1", "w"])
        self.assertEqual(add[0][-1], "--json")
        self.assertEqual(add[1], 60)
        frag = Path(add[0][3])
        self.assertEqual(frag.name, "run1.b.member.json")
        self.assertEqual(json.loads(frag.read_text()), r._member_spec({"id": "b", "cwd": "/fallback"}))
        spec = (r._rig_home() / "specs" / "run1.yaml").read_text()
        self.assertIn('- id: "a"', spec)
        self.assertEqual(spec.count('cwd: "/fallback"'), 2)  # peer with empty cwd inherits the new cwd

    def test_create_pane_name_taken(self):
        with mock.patch.object(r, "_rig", return_value=(0, [self._node("a")], "")):
            out = r.create_pane("a", "c", cwd="/w", run="run1")
        self.assertFalse(out["ok"])
        self.assertIn("name_taken: a already runs in run1", out["reason"])

    def test_create_pane_up_failure_prefers_error_field_then_tail(self):
        def fake(args, timeout=10):
            if args[0] == "ps":
                return 0, [], ""
            return 2, {"error": "bad spec"}, "tail"

        with mock.patch.object(r, "_rig", side_effect=fake):
            out = r.create_pane("a", "c", cwd="/w", run="run1")
        self.assertFalse(out["ok"])
        self.assertEqual(out["reason"], "rig up/add failed (rc=2): bad spec")

        def fake2(args, timeout=10):
            if args[0] == "ps":
                return 0, [], ""
            return 2, None, "tail"

        with mock.patch.object(r, "_rig", side_effect=fake2):
            out = r.create_pane("a", "c", cwd="/w", run="run1")
        self.assertEqual(out["reason"], "rig up/add failed (rc=2): tail")

    def test_create_pane_send_failure_keeps_pane_id(self):
        def fake(args, timeout=10):
            if args[0] == "send":
                return 4, None, "nosend"
            return 0, ([] if args[0] == "ps" else {}), ""

        with mock.patch.object(r, "_rig", side_effect=fake):
            out = r.create_pane("a", "c", cwd="/w", run="run1")
        self.assertEqual(out["ok"], False)
        self.assertEqual(out["pane_id"], "w-a@run1")
        self.assertEqual(out["reason"], "rig send failed (rc=4): nosend")

    def test_close_pane_unknown_pane(self):
        with mock.patch.object(r, "_rig", return_value=(0, [self._node("a")], "")):
            self.assertEqual(r.close_pane("w-zzz@run1"), {"ok": False, "reason": "no such colony pane"})

    def test_close_pane_removes_member_fragment_file(self):
        frag = r._rig_home() / "specs" / "run1.a.member.json"
        frag.parent.mkdir(parents=True)
        frag.write_text("{}")

        def fake(args, timeout=10):
            return 0, ([self._node("a")] if args[0] == "ps" else {}), ""

        with mock.patch.object(r, "_rig", side_effect=fake):
            self.assertEqual(r.close_pane("w-a@run1"), {"ok": True, "pane_id": "w-a@run1"})
        self.assertFalse(frag.exists())

    def test_close_pane_remove_timeout_is_30(self):
        seen = {}

        def fake(args, timeout=10):
            if args[0] == "remove":
                seen["t"] = timeout
            return 0, ([self._node("a")] if args[0] == "ps" else {}), ""

        with mock.patch.object(r, "_rig", side_effect=fake):
            r.close_pane("w-a@run1")
        self.assertEqual(seen["t"], 30)

    def test_close_run_lists_panes_and_uses_down_with_timeout(self):
        calls = []

        def fake(args, timeout=10):
            calls.append((args, timeout))
            return 0, ([self._node("a"), self._node("b")] if args[0] == "ps" else {}), ""

        with mock.patch.object(r, "_rig", side_effect=fake):
            out = r.close_run("run 1")
        self.assertEqual(out, {"ok": True, "closed": ["a", "b"], "panes": ["w-a@run1", "w-b@run1"]})
        self.assertIn((["down", "run-1", "--delete", "--json"], 60), calls)

    def test_close_run_failure_with_tmux_server_up_does_not_retry(self):
        n = {"down": 0}

        def fake(args, timeout=10):
            if args[0] == "down":
                n["down"] += 1
                return 9, None, "stuck"
            return 0, [], ""

        with mock.patch.object(r, "_rig", side_effect=fake), mock.patch.object(r.subprocess, "run", return_value=mock.Mock(returncode=0)) as run:
            out = r.close_run("run1")
        self.assertEqual(out, {"ok": False, "reason": "rig down failed (rc=9): stuck"})
        self.assertEqual(n["down"], 1)
        self.assertEqual(run.call_count, 1)  # only the has-session probe

    def test_close_run_retries_with_keepalive_session_when_no_tmux_server(self):
        n = {"down": 0}

        def fake(args, timeout=10):
            if args[0] == "down":
                n["down"] += 1
                return (9, None, "no tmux") if n["down"] == 1 else (0, {}, "")
            return 0, [], ""

        runs = []

        def run(cmd, **kw):
            runs.append((cmd, kw))
            return mock.Mock(returncode=1 if cmd[1] == "has-session" else 0)

        with mock.patch.object(r, "_rig", side_effect=fake), mock.patch.object(r.subprocess, "run", side_effect=run):
            out = r.close_run("run1")
        self.assertTrue(out["ok"], out)
        self.assertEqual(n["down"], 2)
        cmds = [c[0] for c in runs]
        self.assertEqual(cmds[1][:5], ["tmux", "new-session", "-d", "-s", "atlas-rigdown-keepalive"])
        self.assertEqual(cmds[2], ["tmux", "kill-session", "-t", "atlas-rigdown-keepalive"])

    def test_close_run_second_down_uses_60s_timeout(self):
        timeouts = []

        def fake(args, timeout=10):
            if args[0] == "down":
                timeouts.append(timeout)
                return 9, None, "x"
            return 0, [], ""

        with mock.patch.object(r, "_rig", side_effect=fake), mock.patch.object(r.subprocess, "run", return_value=mock.Mock(returncode=1)):
            r.close_run("run1")
        self.assertEqual(timeouts, [60, 60])

    def test_pane_live(self):
        with mock.patch.object(r, "_rig", return_value=(0, [self._node("a")], "")) as rg:
            self.assertTrue(r.pane_live("w-a@run1"))
            self.assertFalse(r.pane_live("w-b@run1"))
        self.assertEqual(rg.call_args[0][0][3], "run1")  # rig parsed from the part after '@'
        with mock.patch.object(r, "list_panes", side_effect=RuntimeError("x")):
            self.assertFalse(r.pane_live("w-a@run1"))

    def test_send_prompt_contract(self):
        with mock.patch.object(r, "_rig", return_value=(0, {"sent": 1}, "")) as rg:
            out = r.send_prompt("w-a@run1", "hello")
        self.assertEqual(out, {"ok": True, "pane_id": "w-a@run1", "result": {"sent": 1}})
        self.assertEqual(rg.call_args[0][0], ["send", "w-a@run1", "hello", "--raw", "--json"])
        for bad in ("", "  \n", None, 5):
            with mock.patch.object(r, "_rig") as rg:
                self.assertEqual(r.send_prompt("p", bad), {"ok": False, "reason": "text is required"})
            rg.assert_not_called()
        with mock.patch.object(r, "_rig", return_value=(3, None, "bad")):
            self.assertEqual(r.send_prompt("p", "x"), {"ok": False, "reason": "rig send failed (rc=3): bad"})

    def test_exceptions_become_err_dicts(self):
        boom = mock.patch.object(r, "_rig", side_effect=RuntimeError("kaboom"))
        with boom:
            self.assertEqual(r.send_prompt("p", "x"), {"ok": False, "reason": "RuntimeError: kaboom"})
            self.assertEqual(r.capture("p"), {"ok": False, "error": "RuntimeError: kaboom"})
            self.assertEqual(r.create_pane("n", "c", cwd="/w", run="run1")["reason"], "RuntimeError: kaboom")
        with mock.patch.object(r, "list_panes", side_effect=RuntimeError("kaboom")):
            self.assertEqual(r.close_pane("w-a@run1"), {"ok": False, "reason": "RuntimeError: kaboom"})
            self.assertEqual(r.close_run("run1"), {"ok": False, "reason": "RuntimeError: kaboom"})

    def test_capture_shapes(self):
        with mock.patch.object(r, "_rig", return_value=(0, "screen text", "")) as rg:
            out = r.capture("w-a@run1", lines="12")
        self.assertEqual(out, {"ok": True, "pane_id": "w-a@run1", "text": "screen text"})
        self.assertEqual(rg.call_args[0][0], ["capture", "w-a@run1", "--lines", "12", "--json"])
        for key in ("text", "output", "content", "screen", "capture"):
            with mock.patch.object(r, "_rig", return_value=(0, {key: "T"}, "")):
                self.assertEqual(r.capture("p")["text"], "T", key)
        with mock.patch.object(r, "_rig", return_value=(0, {"other": "T"}, "")):
            self.assertEqual(r.capture("p")["text"], "")
        with mock.patch.object(r, "_rig", return_value=(0, [1], "")):
            self.assertEqual(r.capture("p")["text"], "")
        with mock.patch.object(r, "_rig", return_value=(1, None, "e")):
            self.assertEqual(r.capture("p"), {"ok": False, "error": "rig capture failed (rc=1): e"})
        self.assertFalse(r.capture("p", lines="abc")["ok"])  # int() failure is caught, not raised

    def test_agents_rows_and_workspaces(self):
        nodes = [
            self._node("a", agentActivity={"state": "running"}),
            self._node("b", agentActivity={"state": "needs_input"}),
            self._node("c", agentActivity={"state": "idle"}),
            self._node("d", agentActivity={"state": "weird"}),
            self._node("e", agentActivity={"state": "idle"}, lifecycleState="attention_required", latestError="boom"),
            self._node("f", startupStatus="failed"),
        ]

        def fake(args, timeout=10):
            return (0, [{"name": "run1"}], "") if args == ["ps", "--json"] else (0, nodes, "")

        with mock.patch.object(r, "_rig", side_effect=fake):
            out = r.agents()
        self.assertTrue(out["reachable"])
        self.assertIsNone(out["reason"])
        by = {a["name"]: a for a in out["agents"]}
        self.assertEqual([by[k]["status"] for k in "abcdef"], ["working", "blocked", "idle", "unknown", "blocked", "blocked"])
        self.assertEqual(by["e"]["reason"], "boom")
        self.assertEqual(by["f"]["reason"], "attention_required")
        self.assertNotIn("reason", by["a"])
        self.assertEqual(by["a"]["deep_link"], "tmux attach -t w-a@run1")
        self.assertEqual(by["a"]["agent"], "terminal")
        self.assertEqual(by["a"]["title"], "w-a@run1")
        self.assertEqual(out["workspaces"], [{"workspace_id": "run1", "label": "run1", "focused": False, "agent_status": None, "pane_count": 6}])

    def test_agents_unreachable_and_exception(self):
        with mock.patch.object(r, "_rig", return_value=(1, None, "")):
            self.assertEqual(r.agents(), {"reachable": False, "reason": "rig ps failed", "workspaces": [], "agents": []})
        with mock.patch.object(r, "_rigs", side_effect=ValueError("v")):
            out = r.agents()
        self.assertEqual(out["reason"], "ValueError: v")
        self.assertFalse(out["reachable"])


class MainTests(Base):
    def test_usage_and_dispatch(self):
        import contextlib
        import io

        buf, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(r.main(["x", "--help"]), 0)
        self.assertIn("usage: atlas_rig.py", buf.getvalue())
        with contextlib.redirect_stderr(err):
            self.assertEqual(r.main(["x"]), 2)
            self.assertEqual(r.main(["x", "bogus"]), 2)
            self.assertEqual(r.main(["x", "status", "extra"]), 2)
        self.assertIn("usage:", err.getvalue())
        buf = io.StringIO()
        with mock.patch.object(r, "status", return_value={"ok": True, "a": 1}), contextlib.redirect_stdout(buf):
            self.assertEqual(r.main(["x", "status"]), 0)
        self.assertEqual(json.loads(buf.getvalue()), {"ok": True, "a": 1})
        with mock.patch.object(r, "ensure", return_value={"ok": False}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(r.main(["x", "ensure"]), 1)
        with mock.patch.object(r, "list_panes", return_value=[{"p": 1}]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(r.main(["x", "list-panes"]), 0)
        with mock.patch.object(r, "agents", return_value={"reachable": False}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(r.main(["x", "agents"]), 0)


if __name__ == "__main__":
    unittest.main()
