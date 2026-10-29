#!/usr/bin/env python3
"""atlas_crew + atlas_irc + hooks/crew_worker: the team bus, the IRC gateway, leases, the stop gate, plans."""

import contextlib
import io
import json
import os
import socket
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest import mock

import _test_isolation  # noqa: F401
import atlas_crew
import atlas_irc

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "hooks"))
import crew_worker  # noqa: E402


def _bus(tmp, nicks=("a", "b"), chan="#t"):
    return atlas_irc.init_bus(Path(tmp) / "irc", chan, list(nicks), lead="lead")


class BusTests(unittest.TestCase):
    def test_post_assigns_monotonic_seq_and_drain_delivers_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            r1 = atlas_irc.post(d, "a", "#t", "READY a: f(x)")
            r2 = atlas_irc.post(d, "b", "a", "what does f return?")
            self.assertEqual((r1["seq"], r2["seq"]), (1, 2))
            got = atlas_irc.drain(d, "a")
            # a does not get its own channel post back, only b's direct question
            self.assertEqual([r["seq"] for r in got], [2])
            self.assertEqual(atlas_irc.drain(d, "a"), [])
            self.assertEqual([r["seq"] for r in atlas_irc.drain(d, "b")], [1])

    def test_direct_message_is_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b", "c"))
            atlas_irc.post(d, "a", "b", "only for b")
            self.assertEqual(atlas_irc.drain(d, "c"), [])
            self.assertEqual(len(atlas_irc.drain(d, "b")), 1)

    def test_concurrent_posts_never_reuse_a_seq(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            ts = [
                threading.Thread(
                    target=lambda i=i: atlas_irc.post(d, "a", "#t", f"m{i}")
                )
                for i in range(40)
            ]
            for t in ts:
                t.start()
            for t in ts:
                t.join()
            seqs = [r["seq"] for r in atlas_irc.history(d)]
            self.assertEqual(sorted(seqs), list(range(1, 41)))

    def _wait(self, d, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = atlas_irc.main(["--dir", str(d), "wait", "--as", "b", *argv])
        return code, buf.getvalue()

    def test_wait_matches_an_announcement_made_before_waiting_with_all(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            atlas_irc.post(d, "a", "#t", "READY a: parse(text) -> Tree")
            code, out = self._wait(
                d, "--all", "--from", "a", "--match", "READY", "--timeout", "2"
            )
            self.assertEqual(code, 0)
            self.assertIn("MATCH <a> #t: READY a", out)

    def test_wait_ignores_history_by_default_and_finds_it_with_all(self):
        # live: a stale false DONE already on the log satisfied `irc wait --from ranges --match done`
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            atlas_irc.post(d, "a", "#t", "DONE a: stale", kind="done")
            atlas_irc.set_cursor(d, "b", 1)  # the stale DONE was already delivered to b
            code, _ = self._wait(d, "--from", "a", "--match", "done", "--timeout", "0.3")
            self.assertEqual(code, 3)
            code, out = self._wait(d, "--all", "--from", "a", "--match", "done", "--timeout", "2")
            self.assertEqual(code, 0)
            self.assertIn("DONE a: stale", out)
            threading.Timer(0.2, lambda: atlas_irc.post(d, "a", "#t", "DONE a: fresh", kind="done")).start()
            code, out = self._wait(d, "--new-only", "--from", "a", "--match", "done", "--timeout", "5")
            self.assertEqual(code, 0)
            self.assertIn("DONE a: fresh", out)

    def test_wait_times_out_with_exit_3(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            atlas_irc.post(d, "a", "#t", "still working")
            code, out = self._wait(
                d, "--from", "a", "--match", "READY", "--timeout", "0.2"
            )
            self.assertEqual(code, 3)
            self.assertIn("timeout", out)

    def _need(self, d, *args, nick="b"):
        buf = io.StringIO()
        with mock.patch.dict(os.environ, {"ATLAS_IRC_DIR": str(d), "ATLAS_IRC_NICK": nick}), \
                contextlib.redirect_stdout(buf):
            code = atlas_irc.main(["need", *args])
        return code, buf.getvalue()

    def test_need_waits_for_every_named_peer(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b", "c"))
            atlas_irc.post(d, "a", "#t", "READY a: f()")
            code, out = self._need(d, "a", "c", "--timeout", "0.3")
            self.assertEqual(code, 3)
            self.assertIn("still waiting for: c", out)
            threading.Timer(0.2, lambda: atlas_irc.post(d, "c", "#t", "DONE c", kind="done")).start()
            code, out = self._need(d, "a", "c", "--timeout", "5")
            self.assertEqual(code, 0)
            self.assertIn("<c> DONE c", out)

    def test_need_done_ignores_ready_and_returns_after_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b"))
            atlas_irc.post(d, "a", "#t", "READY a: f()")
            code, out = self._need(d, "--done", "a", "--timeout", "0.3")
            self.assertEqual(code, 3)
            self.assertIn("still waiting for: a", out)
            atlas_irc.post(d, "a", "#t", "DONE a", kind="done")
            code, out = self._need(d, "--done", "a", "--timeout", "2")
            self.assertEqual(code, 0)
            self.assertIn("<a> DONE a", out)

    def test_need_exits_4_naming_a_peer_that_gave_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b"))
            atlas_irc.post(d, "a", "#t", "GAVE UP a: `pytest` still fails", kind="failed")
            for extra in ((), ("--done",)):
                code, out = self._need(d, *extra, "a", "--timeout", "5")
                self.assertEqual(code, 4)
                self.assertIn("gave up: a", out)

    def test_need_and_wait_refuse_a_name_that_is_not_a_peer(self):
        # live: a worker waited 100 s on `--from lead`, then slept 90 s
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b"))
            code, out = self._need(d, "zed", "--timeout", "5")
            self.assertEqual(code, 2)
            self.assertIn("peers are a, b", out)
            code, _ = self._need(d, "lead", "--timeout", "5")
            self.assertEqual(code, 2)

    def test_wait_wakes_on_a_later_post(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            threading.Timer(0.3, lambda: atlas_irc.post(d, "a", "b", "DONE a")).start()
            code, out = self._wait(
                d, "--from", "a", "--match", "DONE|READY", "--timeout", "5"
            )
            self.assertEqual(code, 0)
            self.assertIn("DONE a", out)


class GatewayTests(unittest.TestCase):
    def test_irc_client_joins_sees_replay_and_relays_both_ways(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("geom", "report"))
            atlas_irc.post(d, "geom", "#t", "READY geom: area()")
            gw = atlas_irc.Gateway(d)
            th = threading.Thread(target=gw.serve_forever, daemon=True)
            th.start()
            for _ in range(50):
                if (d / "port").exists():
                    break
                time.sleep(0.05)
            s = socket.create_connection(("127.0.0.1", int((d / "port").read_text())))
            s.settimeout(3)
            s.sendall(b"NICK geom\r\nUSER h 0 * :h\r\n")
            time.sleep(0.2)
            s.sendall(b"NICK human\r\nJOIN #t\r\nPRIVMSG #t :hi workers\r\n")
            time.sleep(0.4)
            atlas_irc.post(d, "report", "#t", "READY report: render()")
            buf = b""
            end = time.time() + 3
            while time.time() < end and b"READY report" not in buf:
                try:
                    buf += s.recv(65536)
                except socket.timeout:
                    break
            gw.stop.set()
            s.close()
            text = buf.decode()
            self.assertIn(" 433 ", text)  # worker nick is reserved
            self.assertIn("001 human", text)
            self.assertIn("READY geom: area()", text)  # replay on join
            self.assertIn(
                ":report!worker@atlas PRIVMSG #t :READY report: render()", text
            )  # live relay
            sent = [r for r in atlas_irc.history(d) if r["from"] == "human"]
            self.assertEqual(
                sent[0]["text"], "hi workers"
            )  # a client message reaches the workers' log
            self.assertEqual(len(atlas_irc.drain(d, "geom")), 2)


class HookTests(unittest.TestCase):
    def _env(self, tmp, **extra):
        d = _bus(tmp, nicks=("semver", "ranges"))
        env = {
            "ATLAS_IRC_DIR": str(d),
            "ATLAS_IRC_NICK": "ranges",
            "ATLAS_CREW_ROOT": tmp,
            "ATLAS_CREW_OWNS": json.dumps(["pkg/ranges.py"]),
            "ATLAS_CREW_OWNERS": json.dumps(
                {"pkg/ranges.py": "ranges", "pkg/semver.py": "semver"}
            ),
            "ATLAS_CREW_CHECK": "",
            "ATLAS_CREW_MAX_BLOCKS": "2",
        }
        env.update(extra)
        return d, env

    def _run(self, env, fn, payload):
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(buf):
            fn(payload)
        return json.loads(buf.getvalue()) if buf.getvalue() else None

    def test_lease_denies_edit_of_a_peers_file_and_names_the_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, env = self._env(tmp)
            out = self._run(
                env,
                crew_worker.pre_tool_use,
                {
                    "tool_name": "Edit",
                    "tool_input": {"file_path": f"{tmp}/pkg/semver.py"},
                },
            )
            hs = out["hookSpecificOutput"]
            self.assertEqual(hs["permissionDecision"], "deny")
            self.assertIn("leased to semver", hs["permissionDecisionReason"])
            self.assertIsNone(
                self._run(
                    env,
                    crew_worker.pre_tool_use,
                    {
                        "tool_name": "Write",
                        "tool_input": {"file_path": "pkg/ranges.py"},
                    },
                )
            )
            self.assertIsNone(
                self._run(
                    env,
                    crew_worker.pre_tool_use,
                    {"tool_name": "Read", "tool_input": {"file_path": "pkg/semver.py"}},
                )
            )

    def test_lease_denies_a_bash_write_to_a_peers_file_but_not_a_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, env = self._env(tmp)

            def bash(cmd):
                return self._run(
                    env, crew_worker.pre_tool_use, {"tool_name": "Bash", "tool_input": {"command": cmd}}
                )

            for cmd in (
                "cat > pkg/semver.py <<'EOF'\nx = 1\nEOF",
                "echo x >> ./pkg/semver.py",
                "sed -i 's/a/b/' pkg/semver.py",
                "cp /tmp/x.py pkg/semver.py",
                "python3 - <<'EOF'\nopen('pkg/semver.py', 'w').write('')\nEOF",
                "python3 -c \"from pathlib import Path; Path('pkg/semver.py').write_text('')\"",
            ):
                out = bash(cmd)
                self.assertIsNotNone(out, cmd)
                self.assertIn("leased to semver", out["hookSpecificOutput"]["permissionDecisionReason"])
            for cmd in (
                "cat pkg/semver.py > /tmp/copy.txt",
                "grep -n def pkg/semver.py; cat > pkg/ranges.py <<'EOF'\nx = 1\nEOF",
                "python3 -m pytest -q tests/test_semver.py",
            ):
                self.assertIsNone(bash(cmd), cmd)

    def test_post_tool_use_pushes_peer_messages_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp)
            atlas_irc.post(d, "semver", "#t", "READY semver: Version.parse(s)")
            out = self._run(env, crew_worker.post_tool_use, {})
            self.assertIn(
                "[irc] <semver> #t: READY semver",
                out["hookSpecificOutput"]["additionalContext"],
            )
            self.assertIsNone(self._run(env, crew_worker.post_tool_use, {}))

    def test_post_tool_use_ends_session_when_bash_check_posted_done_and_rerun_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            bash = {"tool_name": "Bash"}
            self.assertIsNone(self._run(env, crew_worker.post_tool_use, bash))  # no DONE yet
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            self.assertIsNone(self._run(env, crew_worker.post_tool_use, {"tool_name": "Edit"}))
            out = self._run(env, crew_worker.post_tool_use, bash)
            self.assertIs(out["continue"], False)
            self.assertIn("ranges", out["stopReason"])
            self.assertIs(json.loads((d / "stop" / "ranges.json").read_text())["passed"], True)

    def test_post_tool_use_does_not_trust_a_hand_posted_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="exit 1")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            self.assertIsNone(self._run(env, crew_worker.post_tool_use, {"tool_name": "Bash"}))

    def test_post_tool_use_early_exit_keeps_pushed_messages_but_yields_to_a_question(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            atlas_irc.post(d, "semver", "#t", "READY semver: Version.parse(s); ranges imports it")
            out = self._run(env, crew_worker.post_tool_use, {"tool_name": "Bash"})
            self.assertIs(out["continue"], False)
            self.assertIn("READY semver", out["hookSpecificOutput"]["additionalContext"])
            atlas_irc.post(d, "semver", "ranges", "need prerelease compare?")
            out = self._run(env, crew_worker.post_tool_use, {"tool_name": "Bash"})
            self.assertNotIn("continue", out)
            self.assertIn("need prerelease", out["hookSpecificOutput"]["additionalContext"])

    def test_stop_gate_refuses_while_check_fails_then_gives_up_at_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="echo boom; exit 1")
            for i in (1, 2):
                out = self._run(env, crew_worker.stop, {})
                self.assertEqual(out["decision"], "block")
                self.assertIn(f"refusal {i}/2", out["reason"])
                self.assertIn("boom", out["reason"])
            self.assertIsNone(self._run(env, crew_worker.stop, {}))
            last = atlas_irc.history(d)[-1]
            self.assertTrue(last["text"].startswith("GAVE UP ranges"))

    def test_stop_gate_passes_and_announces_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            self.assertIsNone(self._run(env, crew_worker.stop, {}))
            self.assertEqual(atlas_irc.history(d)[-1]["kind"], "done")

    def test_stop_gate_does_not_repeat_a_done_the_check_already_posted(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            before = len(atlas_irc.history(d))
            self.assertIsNone(self._run(env, crew_worker.stop, {}))
            self.assertEqual(len(atlas_irc.history(d)), before)

    def test_irc_done_posts_once_and_again_after_a_give_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("ranges",))
            dones = lambda: [r for r in atlas_irc.history(d) if r.get("kind") == "done"]
            with mock.patch.dict(os.environ, {"ATLAS_IRC_NICK": "ranges"}), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(atlas_irc.main(["--dir", str(d), "done"]), 0)
                self.assertEqual(atlas_irc.main(["--dir", str(d), "done"]), 0)
                self.assertEqual(len(dones()), 1)
                self.assertEqual(dones()[0]["text"], "DONE ranges: check passes")
                atlas_irc.post(d, "ranges", "#t", "GAVE UP ranges: x", kind="failed")
                self.assertEqual(atlas_irc.main(["--dir", str(d), "done", "fixed"]), 0)
                self.assertEqual(len(dones()), 2)
                self.assertEqual(dones()[1]["text"], "DONE ranges: fixed")

    def test_stop_gate_holds_a_worker_with_an_unanswered_question(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            atlas_irc.post(d, "semver", "ranges", "do you need prerelease compare?")
            out = self._run(env, crew_worker.stop, {})
            self.assertEqual(out["decision"], "block")
            self.assertIn("do you need prerelease compare?", out["reason"])
            self.assertIsNone(self._run(env, crew_worker.stop, {}))


class PlanTests(unittest.TestCase):
    def _plan(self, tmp, workers, **extra):
        p = Path(tmp) / "plan.json"
        p.write_text(json.dumps({"goal": "g", "workers": workers, **extra}))
        return p

    def test_overlapping_ownership_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._plan(
                tmp,
                [
                    {"name": "a", "owns": ["x.py"], "task": "t"},
                    {"name": "b", "owns": ["x.py"], "task": "t"},
                ],
            )
            with self.assertRaisesRegex(ValueError, "owned by both"):
                atlas_crew.load_plan(p)

    def test_worker_without_files_or_bad_name_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "owns no files"):
                atlas_crew.load_plan(
                    self._plan(tmp, [{"name": "a", "owns": [], "task": "t"}])
                )
            with self.assertRaisesRegex(ValueError, "must match"):
                atlas_crew.load_plan(
                    self._plan(tmp, [{"name": "a b", "owns": ["x"], "task": "t"}])
                )
            with self.assertRaisesRegex(ValueError, "reserved"):
                atlas_crew.load_plan(
                    self._plan(tmp, [{"name": "lead", "owns": ["x"], "task": "t"}])
                )

    def test_context_hands_over_one_markdown_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "SPEC.md").write_text(
                "# Spec\nintro\n## 1. `semver.py`\nsemver body\n### Version\nv\n## 2. `ranges.py`\nranges body\n"
            )
            ctx = atlas_crew.resolve_context(["SPEC.md#semver", "literal note"], tmp)
            self.assertIn("semver body", ctx)
            self.assertIn("### Version", ctx)
            self.assertNotIn("ranges body", ctx)
            self.assertIn("literal note", ctx)

    def test_title_heading_hands_over_only_its_preamble(self):
        text = "# Spec\nintro\n## 1. `a.py`\na body\n"
        self.assertEqual(atlas_crew.section(text, "Spec"), "# Spec\nintro")

    def test_auto_plan_gives_each_file_its_own_section_test_and_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pkg").mkdir()
            (root / "tests").mkdir()
            (root / "SPEC.md").write_text(
                "# Kit\nintro\n## Module dependency\na <- b\n## 1. `pkg/a.py`\nA\n"
                "### `class DependencyGraph`\nG\n## 2. `pkg/b.py`\nB\n"
            )
            for n in ("a", "b", "__init__"):
                (root / "pkg" / f"{n}.py").write_text("")
            for n in ("a", "b"):
                (root / "tests" / f"test_{n}.py").write_text("")
            plan = atlas_crew.auto_plan(
                tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q"
            )
        self.assertEqual(plan["context"], ["SPEC.md#Kit", "SPEC.md#Module dependency"])
        self.assertEqual([w["name"] for w in plan["workers"]], ["a", "b"])
        a = plan["workers"][0]
        self.assertEqual(a["owns"], ["pkg/a.py"])
        self.assertEqual(a["context"], ["SPEC.md#1. `pkg/a.py`", "pkg/a.py"])
        self.assertEqual(a["check"], "irc check")
        self.assertEqual(a["unit_check"], "python3 -m pytest -q tests/test_a.py")
        self.assertEqual(a["needs"], [])

    def _dep_tree(self, tmp, files):
        root = Path(tmp)
        (root / "pkg").mkdir()
        (root / "tests").mkdir()
        (root / "SPEC.md").write_text("# Kit\nintro\n")
        for n, body in files.items():
            (root / "pkg" / f"{n}.py").write_text(body)
            (root / "tests" / f"test_{n}.py").write_text("")
        return atlas_crew.auto_plan(
            tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q"
        )

    def test_auto_plan_wires_the_wait_for_imported_peers_into_the_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._dep_tree(
                tmp, {"leaf": "", "mid": "from .leaf import x\n", "top": "from . import leaf, mid\n"}
            )
        ws = {w["name"]: w for w in plan["workers"]}
        for w in ws.values():
            self.assertEqual(w["check"], "irc check")
            self.assertNotIn("irc", w["unit_check"])
        self.assertEqual(ws["leaf"]["needs"], [])
        self.assertEqual(ws["mid"]["needs"], ["leaf"])
        self.assertEqual(ws["top"]["needs"], ["leaf", "mid"])
        self.assertEqual(ws["top"]["unit_check"], "python3 -m pytest -q tests/test_top.py")
        self.assertEqual(ws["leaf"]["unit_check"], "python3 -m pytest -q tests/test_leaf.py")

    def test_worker_env_carries_the_needs_and_unit_check_of_an_auto_plan_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._dep_tree(tmp, {"leaf": "", "mid": "from .leaf import x\n"})
            mid = [w for w in plan["workers"] if w["name"] == "mid"][0]
            env = atlas_crew.worker_env(Path(tmp) / "run", plan, mid, tmp)
        self.assertEqual(env["ATLAS_CREW_CHECK"], "irc check")
        self.assertEqual(env["ATLAS_CREW_NEEDS"], "leaf")
        self.assertEqual(env["ATLAS_CREW_UNIT_CHECK"], "python3 -m pytest -q tests/test_mid.py")

    def test_load_plan_wraps_a_hand_written_check_in_irc_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "plan.json"
            p.write_text(json.dumps({"workers": [
                {"name": "a", "owns": ["a.py"], "task": "t", "check": "pytest -q t_a.py"},
                {"name": "b", "owns": ["b.py"], "task": "t", "check": "pytest -q t_b.py", "needs": ["a"]},
                {"name": "c", "owns": ["c.py"], "task": "t"},
            ]}))
            ws = {w["name"]: w for w in atlas_crew.load_plan(p)["workers"]}
            p.write_text(json.dumps({"workers": list(ws.values())}))
            again = {w["name"]: w for w in atlas_crew.load_plan(p)["workers"]}
        self.assertEqual((ws["a"]["check"], ws["a"]["unit_check"], ws["a"]["needs"]), ("irc check", "pytest -q t_a.py", []))
        self.assertEqual(ws["b"]["needs"], ["a"])
        self.assertFalse(ws["c"].get("check"))
        self.assertEqual(again, ws)  # idempotent

    def test_import_cycle_yields_no_mutual_wait(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._dep_tree(
                tmp, {"a": "from .b import y\n", "b": "from .a import x\n", "c": "from .a import x\n"}
            )
        needs = {w["name"]: w["needs"] for w in plan["workers"]}
        self.assertEqual(needs, {"a": ["b"], "b": [], "c": ["a"]})

    def test_interface_keeps_public_signatures_and_drops_bodies(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "m.py"
            f.write_text(
                "from dataclasses import dataclass\n"
                "@dataclass\nclass Version:\n    \"\"\"A version.\"\"\"\n    major: int\n"
                "    def bump(self, n: int = 1) -> 'Version':\n        \"\"\"Bump it.\"\"\"\n        raise NotImplementedError\n"
                "    def _hidden(self): ...\n"
                "def _private(): ...\n"
            )
            out = atlas_crew._interface(f)
            self.assertEqual(atlas_crew._interface(Path(tmp) / "missing.py"), "")
        self.assertIn("class Version:", out)
        self.assertIn("    major: int", out)
        self.assertIn("def bump(self, n: int=1) -> 'Version': ...  # Bump it.", out)
        self.assertNotIn("NotImplementedError", out)
        self.assertNotIn("_hidden", out)
        self.assertNotIn("_private", out)

    def test_auto_plan_hands_a_worker_the_interfaces_of_the_peers_it_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pkg").mkdir()
            (root / "SPEC.md").write_text("# Kit\nintro\n## `pkg/a.py`\nA\n")
            (root / "pkg" / "a.py").write_text("from .b import B\n")
            (root / "pkg" / "b.py").write_text("class B:\n    def go(self) -> int:\n        raise NotImplementedError\n")
            (root / "pkg" / "c.py").write_text("import os\n")
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py")
        ws = {w["name"]: w for w in plan["workers"]}
        ctx = ws["a"]["context"]
        iface = [e for e in ctx if e.startswith("Interfaces of the peer files you import")]
        self.assertEqual(len(iface), 1)
        self.assertIn("# b owns pkg/b.py", iface[0])
        self.assertIn("class B:", iface[0])
        self.assertEqual(ctx[-1], "pkg/a.py")
        self.assertLess(ctx.index(iface[0]), ctx.index("pkg/a.py"))
        for n in ("b", "c"):
            self.assertFalse([e for e in ws[n]["context"] if e.startswith("Interfaces")])

    def test_local_deps_resolves_import_forms_without_self_or_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pkg").mkdir()
            (root / "pkg" / "a.py").write_text(
                "from . import b as bm\nimport pkg.c\nfrom pkg.b import X\nfrom .a import Y\nimport json\n"
            )
            rels = ["pkg/a.py", "pkg/b.py", "pkg/c.py"]
            self.assertEqual(atlas_crew._local_deps("pkg/a.py", rels, root), ["pkg/b.py", "pkg/c.py"])

    def _kit(self, tmp, src, tests, layout="pkg"):
        """Write a tree: `src` {rel: body} and `tests` {rel: body} under tmp, plus a SPEC.md."""
        root = Path(tmp)
        (root / "SPEC.md").write_text("# Kit\nintro\n")
        for rel, body in {**src, **tests}.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(body)
        return root

    def test_auto_plan_context_does_not_hold_the_workers_test_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "from .b import B\n", "pkg/b.py": "class B:\n    pass\n"},
                      {"tests/test_a.py": "def test_a():\n    assert 1 == 1\n", "tests/test_b.py": "def test_b(): pass\n"})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        a = {w["name"]: w for w in plan["workers"]}["a"]
        self.assertEqual(a["tests"], ["tests/test_a.py"])
        self.assertFalse([e for e in a["context"] if "def test_" in e])

    def test_needs_include_a_peer_imported_inside_a_function(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "def f():\n    if True:\n        from .b import B\n        return B\n", "pkg/b.py": ""},
                      {"tests/test_a.py": "", "tests/test_b.py": ""})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        self.assertEqual({w["name"]: w for w in plan["workers"]}["a"]["needs"], ["b"])

    def test_needs_include_a_peer_imported_as_from_dot_import_x(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "from . import b\n", "pkg/b.py": ""},
                      {"tests/test_a.py": "", "tests/test_b.py": ""})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        self.assertEqual({w["name"]: w for w in plan["workers"]}["a"]["needs"], ["b"])

    def test_needs_include_a_peer_imported_by_absolute_package_name_in_a_src_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"src/pkg/a.py": "import pkg.b\n", "src/pkg/b.py": ""},
                      {"tests/test_a.py": "", "tests/test_b.py": ""})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "src/pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        self.assertEqual({w["name"]: w for w in plan["workers"]}["a"]["needs"], ["b"])

    def test_needs_include_a_peer_only_the_workers_test_file_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "", "pkg/b.py": "def parse(s):\n    raise NotImplementedError\n"},
                      {"tests/test_a.py": "from pkg.a import f\nfrom pkg.b import parse\n", "tests/test_b.py": ""})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        ws = {w["name"]: w for w in plan["workers"]}
        self.assertEqual(ws["a"]["needs"], ["b"])
        self.assertEqual(ws["b"]["needs"], [])
        self.assertTrue([e for e in ws["a"]["context"] if e.startswith("Interfaces")])

    def test_cycles_through_test_imports_are_still_broken(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "from .b import x\n", "pkg/b.py": ""},
                      {"tests/test_a.py": "", "tests/test_b.py": "from pkg.a import y\n"})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        ws = {w["name"]: w for w in plan["workers"]}
        self.assertEqual(ws["a"]["needs"], ["b"])
        self.assertEqual(ws["b"]["needs"], [])

    def test_a_hash_line_inside_a_code_fence_does_not_end_the_section(self):
        text = (
            "# Spec\n## 6. `lock.py`\nformat:\n```\n# lockfile v1\npkg a\n```\n"
            "inline ``` `` a`b `` ``` stays text\nmore\n## 7. `graph.py`\ng\n"
        )
        sec = atlas_crew.section(text, "6. `lock.py`")
        self.assertIn("more", sec)
        self.assertNotIn("graph", sec)

    def test_auto_plan_scopes_package_sections_and_prefixes_twin_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            spec = "# W\n## alpha overview\nA\n## 1. `alpha/cli.py`\na\n## beta overview\nB\n## 1. `beta/cli.py`\nb\n"
            (root / "SPEC.md").write_text(spec)
            for pkg in ("alpha", "beta"):
                (root / pkg).mkdir()
                (root / pkg / "cli.py").write_text("")
                (root / "tests" / pkg).mkdir(parents=True)
                (root / "tests" / pkg / "test_cli.py").write_text("")
            plan = atlas_crew.auto_plan(
                tmp, "SPEC.md", "*/cli.py", "tests/{parent}/test_{stem}.py", "python3 -m pytest -q"
            )
        self.assertEqual(plan["context"], ["SPEC.md#W"])
        beta = {w["name"]: w for w in plan["workers"]}["beta-cli"]
        self.assertEqual(
            beta["context"], ["SPEC.md#beta overview", "SPEC.md#1. `beta/cli.py`", "beta/cli.py"]
        )
        self.assertEqual(beta["unit_check"], "python3 -m pytest -q tests/beta/test_cli.py")

    def test_auto_plan_never_makes_a_worker_of_a_matched_test_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "SPEC.md").write_text("# Kit\nintro\n")
            for n in ("geom", "test_geom", "report", "test_report"):
                (root / f"{n}.py").write_text("")
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "*.py", "test_{stem}.py", "python3 -m pytest -q")
            (root / "extra_test.py").write_text("")
            (root / "test_solo.py").write_text("")
            plan2 = atlas_crew.auto_plan(tmp, "SPEC.md", "*.py", None, "python3 -m pytest -q")
        self.assertEqual([w["name"] for w in plan["workers"]], ["geom", "report"])
        self.assertEqual(plan["workers"][0]["tests"], ["test_geom.py"])
        self.assertEqual([w["name"] for w in plan2["workers"]], ["geom", "report"])

    def test_worker_prompt_names_peers_ownership_and_check(self):
        plan = {
            "goal": "g",
            "workers": [
                {
                    "name": "a",
                    "owns": ["a.py"],
                    "task": "do a",
                    "check": "pytest -q t_a.py",
                },
                {"name": "b", "owns": ["b.py"], "task": "do b"},
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            text = atlas_crew.worker_prompt(plan, plan["workers"][0], "crew-x", tmp)
        self.assertIn("- b owns b.py", text)
        self.assertIn("`pytest -q t_a.py` passes", text)
        self.assertIn("- a.py", text)

    def test_route_failures_maps_failing_tests_to_their_owner(self):
        plan = {
            "workers": [
                {
                    "name": "semver",
                    "owns": ["pkg/semver.py"],
                    "tests": ["tests/test_semver.py"],
                },
                {"name": "cli", "owns": ["pkg/cli.py"], "tests": ["tests/test_cli.py"]},
            ]
        }
        out = (
            "FAILED tests/test_cli.py::test_lock - AssertionError\n1 failed, 40 passed"
        )
        self.assertEqual(list(atlas_crew.route_failures(plan, out)), ["cli"])


class WorkerLaunchTests(unittest.TestCase):
    def test_worker_is_lean_and_gets_its_own_session(self):
        argv = atlas_crew.worker_argv("sonnet", "medium", "/s.json", "sid-1", "PROMPT")
        for flag in (
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-chrome",
            "--session-id",
        ):
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index("--tools") + 1], atlas_crew.WORKER_TOOLS)
        self.assertEqual(argv[argv.index("--session-id") + 1], "sid-1")
        self.assertEqual(argv[-1], "PROMPT")
        resumed = atlas_crew.worker_argv(
            "sonnet", None, "/s.json", "sid-1", "FIX", resume="sid-1"
        )
        self.assertIn("--resume", resumed)
        self.assertNotIn("--session-id", resumed)
        named = atlas_crew.worker_argv("sonnet", None, "/s.json", "sid-1", "P", name="crew-x-a")
        self.assertEqual(named[named.index("--name") + 1], "crew-x-a")

    def test_worker_env_drops_the_leads_session_identity(self):
        plan = {
            "workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true"}]
        }
        lead_env = {
            "CLAUDE_CODE_SESSION_ID": "lead",
            "CLAUDE_CODE_REMOTE_SESSION_ID": "lead",
            "TMUX": "x",
            "KEEP": "1",
            "PATH": "/usr/bin",
        }
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.dict(os.environ, lead_env, clear=True),
        ):
            env = atlas_crew.worker_env(Path(tmp), plan, plan["workers"][0], tmp)
        self.assertNotIn("CLAUDE_CODE_SESSION_ID", env)
        self.assertNotIn("CLAUDE_CODE_REMOTE_SESSION_ID", env)
        self.assertNotIn("TMUX", env)
        self.assertEqual(env["KEEP"], "1")
        self.assertEqual(env["ATLAS_IRC_NICK"], "a")
        self.assertTrue(env["PATH"].startswith(str(Path(tmp) / "bin")))

    def test_worker_that_lingers_after_its_result_is_reaped_as_success(self):
        # live: a finished worker held open by a stray background shell for 9 minutes
        with tempfile.TemporaryDirectory() as tmp:
            rundir = Path(tmp) / "run"
            (rundir / "prompts").mkdir(parents=True)
            (rundir / "prompts" / "a.md").write_text("P")
            plan = {"workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true"}]}
            (rundir / "run.json").write_text(
                json.dumps({"plan": plan, "root": tmp, "run_id": "crew-t", "settings": "/s.json"})
            )
            fake = Path(tmp) / "bin" / "claude"
            fake.parent.mkdir()
            fake.write_text(
                "#!/bin/sh\necho '{\"type\":\"result\",\"is_error\":false}'\nexec sleep 60\n"
            )
            fake.chmod(0o755)
            args = types.SimpleNamespace(rundir=str(rundir), name="a", round=0, no_hold=True)
            env = {"PATH": f"{fake.parent}{os.pathsep}{os.environ['PATH']}"}
            t0 = time.time()
            with mock.patch.dict(os.environ, env), mock.patch.object(
                atlas_crew, "RESULT_GRACE_S", 0.5
            ), contextlib.redirect_stdout(io.StringIO()):
                atlas_crew.cmd_worker(args)
            self.assertLess(time.time() - t0, 20)
            rec = json.loads((rundir / "exit" / "a.r0.json").read_text())
            self.assertEqual(rec["exit"], 0)
            self.assertIn("terminated", (rundir / "logs" / "a.log").read_text())

    def test_worker_env_turns_off_background_shells(self):
        plan = {"workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true"}]}
        env = atlas_crew.worker_env(Path("/r"), plan, plan["workers"][0], "/root")
        self.assertEqual(env["CLAUDE_CODE_DISABLE_BACKGROUND_TASKS"], "1")

    def test_worker_env_skips_nonessential_traffic(self):
        plan = {"workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true"}]}
        env = atlas_crew.worker_env(Path("/r"), plan, plan["workers"][0], "/root")
        self.assertEqual(env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"], "1")

    def test_usage_of_counts_cumulative_usage_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "w.log"
            ev = {
                "type": "result",
                "total_cost_usd": 0.5,
                "num_turns": 3,
                "modelUsage": {
                    "m": {
                        "inputTokens": 10,
                        "cacheCreationInputTokens": 100,
                        "cacheReadInputTokens": 1000,
                        "outputTokens": 5,
                    }
                },
            }
            log.write_text("noise\n" + json.dumps(ev) + "\n" + json.dumps(ev) + "\n")
            u = atlas_crew.usage_of(log)
        # a repeated result (same cumulative modelUsage) must not double the count
        self.assertEqual(u["total"], 1115)
        self.assertEqual(u["cost_usd"], 0.5)
        self.assertEqual(u["turns"], 6)


class _IrcCase:
    """Helpers to run `irc` subcommands in-process against a temp bus."""

    IRC = str(Path(__file__).resolve().parent / "atlas_irc.py")

    def _env(self, tmp, unit, needs="", nick="ranges"):
        d = _bus(tmp, nicks=("semver", "ranges"))
        env = {
            "ATLAS_IRC_DIR": str(d),
            "ATLAS_IRC_NICK": nick,
            "ATLAS_CREW_ROOT": tmp,
            "ATLAS_CREW_UNIT_CHECK": unit,
            "ATLAS_CREW_NEEDS": needs,
        }
        return d, env

    def _irc(self, env, *argv):
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(buf):
            code = atlas_irc.main(list(argv))
        return code, buf.getvalue()

    def _dones(self, d, nick="ranges"):
        return [r for r in atlas_irc.history(d) if r.get("kind") == "done" and r["from"] == nick]

class VerifiedDoneTests(_IrcCase, unittest.TestCase):
    """A DONE is posted by `irc check` after the unit check passed, never from the worker's word."""

    def test_check_with_failing_unit_check_posts_no_done_even_when_piped(self):
        import subprocess

        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "echo boom-output; exit 1")
            full = {**os.environ, **env}
            res = subprocess.run(
                f"{sys.executable} {self.IRC} check | tail -15 && echo piped-ok",
                shell=True, env=full, capture_output=True, text=True, cwd=tmp,
            )
            self.assertIn("boom-output", res.stdout)
            self.assertEqual(self._dones(d), [])
            code, out = self._irc(env, "check")
            self.assertEqual(code, 1)
            self.assertIn("boom-output", out)
            self.assertEqual(self._dones(d), [])

    def test_check_with_passing_unit_check_posts_done_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "echo all-green")
            for _ in range(2):
                code, out = self._irc(env, "check")
                self.assertEqual(code, 0)
                self.assertIn("all-green", out)
            self.assertEqual(len(self._dones(d)), 1)

    def test_check_waits_for_needs_with_need_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "true", needs="semver")
            code, out = self._irc(env, "check", "--timeout", "0.3")
            self.assertEqual(code, 3)
            self.assertEqual(self._dones(d), [])
            atlas_irc.post(d, "semver", "#t", "GAVE UP semver: x", kind="failed")
            self.assertEqual(self._irc(env, "check", "--timeout", "2")[0], 4)
            _, env2 = self._env(tmp, "true", needs="nobody")
            self.assertEqual(self._irc({**env, "ATLAS_CREW_NEEDS": "nobody"}, "check")[0], 2)

    def test_check_runs_unit_check_only_after_needs_are_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "echo ran > ran.txt", needs="semver")
            atlas_irc.post(d, "semver", "#t", "DONE semver", kind="done")
            self.assertEqual(self._irc(env, "check", "--timeout", "2")[0], 0)
            self.assertTrue((Path(tmp) / "ran.txt").exists())  # the shell ran in ATLAS_CREW_ROOT

    def test_manual_done_refuses_while_the_unit_check_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "echo red-tests; exit 1")
            code, out = self._irc(env, "done")
            self.assertEqual(code, 1)
            self.assertIn("red-tests", out)
            self.assertEqual(self._dones(d), [])
            _, env_ok = self._env(tmp, "true")
            self.assertEqual(self._irc(env_ok, "done")[0], 0)
            self.assertEqual(len(self._dones(d)), 1)

    def test_a_passing_check_after_a_failed_one_posts_a_fresh_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "test -f ok.flag")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")  # the stale, false DONE
            self.assertEqual(self._irc(env, "check")[0], 1)
            self.assertFalse(atlas_irc.has_done(d, "ranges"))
            peer_env = {**env, "ATLAS_IRC_NICK": "semver"}
            self.assertEqual(self._irc(peer_env, "need", "--done", "ranges", "--timeout", "0.3")[0], 3)
            (Path(tmp) / "ok.flag").write_text("")
            self.assertEqual(self._irc(env, "check")[0], 0)
            self.assertEqual(len(self._dones(d)), 2)
            self.assertTrue(atlas_irc.has_done(d, "ranges"))
            code, out = self._irc(peer_env, "need", "--done", "ranges", "--timeout", "2")
            self.assertEqual(code, 0)
            self.assertIn("<ranges> DONE ranges", out)

    def test_a_refused_done_also_invalidates_an_earlier_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "exit 1")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            self.assertEqual(self._irc(env, "done")[0], 1)
            self.assertFalse(atlas_irc.has_done(d, "ranges"))

    def test_a_failed_check_is_not_broadcast_to_peers(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "exit 1")
            self._irc(env, "check")
            self.assertEqual(atlas_irc.drain(d, "semver"), [])


class DoneCurrentTests(_IrcCase, unittest.TestCase):
    """done_current: a verified DONE is still current while the owned files hash the same."""

    def _setup(self, tmp, unit="true", check=None):
        d, env = self._env(tmp, unit)
        (Path(tmp) / "pkg").mkdir()
        (Path(tmp) / "pkg" / "ranges.py").write_text("x = 1\n")
        env["ATLAS_CREW_OWNS"] = json.dumps(["pkg/ranges.py"])
        env["ATLAS_CREW_CHECK"] = check if check is not None else f"{sys.executable} {self.IRC} check"
        env["ATLAS_CREW_MAX_BLOCKS"] = "2"
        return d, env

    def _cur(self, d, env):
        with mock.patch.dict(os.environ, env):
            return atlas_irc.done_current(d, "ranges")

    def test_current_after_check_posts_done_with_digest_then_false_after_an_owned_file_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp)
            self.assertFalse(self._cur(d, env))
            self.assertEqual(self._irc(env, "check")[0], 0)
            self.assertTrue(self._dones(d)[0]["digest"])
            self.assertTrue(self._cur(d, env))
            (Path(tmp) / "pkg" / "ranges.py").write_text("x = 2\n")
            self.assertFalse(self._cur(d, env))
            (Path(tmp) / "pkg" / "ranges.py").write_text("x = 1\n")
            self.assertTrue(self._cur(d, env))
            (Path(tmp) / "pkg" / "ranges.py").unlink()
            self.assertFalse(self._cur(d, env))

    def test_done_without_a_digest_is_not_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp)
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            self.assertTrue(atlas_irc.has_done(d, "ranges"))
            self.assertFalse(self._cur(d, env))

    def test_a_later_unverified_record_voids_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp)
            self.assertEqual(self._irc(env, "check")[0], 0)
            atlas_irc.post(d, "ranges", "ranges", "unverified ranges: x", kind="unverified")
            self.assertFalse(self._cur(d, env))

    def test_explicit_root_and_owns_override_the_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp)
            self.assertEqual(self._irc(env, "check")[0], 0)
            self.assertTrue(atlas_irc.done_current(d, "ranges", root=tmp, owns=["pkg/ranges.py"]))
            self.assertFalse(atlas_irc.done_current(d, "ranges", root=tmp, owns=["pkg/other.py"]))

    def _counting(self, tmp):
        cnt = Path(tmp) / "runs.txt"
        return f"echo x >> {cnt}", cnt

    def _runs(self, cnt):
        return len(cnt.read_text().split()) if cnt.exists() else 0

    def test_early_exit_skips_the_check_when_current_and_reruns_it_when_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            unit, cnt = self._counting(tmp)
            d, env = self._setup(tmp, unit=unit, check=unit)
            self.assertEqual(self._irc(env, "check")[0], 0)
            self.assertEqual(self._runs(cnt), 1)
            hook = HookTests()
            out = hook._run(env, crew_worker.post_tool_use, {"tool_name": "Bash"})
            self.assertIs(out["continue"], False)
            self.assertEqual(self._runs(cnt), 1)  # not re-run
            self.assertIs(json.loads((d / "stop" / "ranges.json").read_text())["passed"], True)
            (Path(tmp) / "pkg" / "ranges.py").write_text("x = 2\n")
            out = hook._run(env, crew_worker.post_tool_use, {"tool_name": "Bash"})
            self.assertIs(out["continue"], False)
            self.assertEqual(self._runs(cnt), 2)  # stale digest: old path re-ran it

    def test_stop_allows_without_running_the_check_when_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            unit, cnt = self._counting(tmp)
            d, env = self._setup(tmp, unit=unit, check=unit)
            self.assertEqual(self._irc(env, "check")[0], 0)
            hook = HookTests()
            before = len(atlas_irc.history(d))
            self.assertIsNone(hook._run(env, crew_worker.stop, {}))
            self.assertEqual(self._runs(cnt), 1)
            self.assertEqual(len(atlas_irc.history(d)), before)
            self.assertIs(json.loads((d / "stop" / "ranges.json").read_text())["passed"], True)

    def test_stop_blocks_on_a_failing_check_when_not_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp, check="echo boom; exit 1")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done", extra={"digest": "stale"})
            out = HookTests()._run(env, crew_worker.stop, {})
            self.assertEqual(out["decision"], "block")
            self.assertIn("boom", out["reason"])


class DocstringRestoreTests(_IrcCase, unittest.TestCase):
    """`irc check` puts back the stub docstrings a worker's rewrite dropped, deterministically."""

    STUB = (
        '"""Module doc."""\n\n\nclass A:\n    """Class doc\n\n    more text\n    """\n\n'
        '    def m(self):\n        """Method doc."""\n        raise NotImplementedError\n\n\n'
        'def f(x):\n    """Func doc."""\n    raise NotImplementedError\n\n\n'
        'def g(x):\n    """Mine."""\n    raise NotImplementedError\n'
    )

    def _setup(self, tmp, work, unit="true"):
        d, env = self._env(tmp, unit)
        stub = Path(tmp) / "stubs" / "pkg" / "m.py"
        stub.parent.mkdir(parents=True)
        stub.write_text(self.STUB)
        (Path(tmp) / "pkg").mkdir()
        (Path(tmp) / "pkg" / "m.py").write_text(work)
        env["ATLAS_CREW_OWNS"] = json.dumps(["pkg/m.py"])
        env["ATLAS_CREW_STUBS"] = json.dumps({"pkg/m.py": str(stub)})
        return d, env

    def test_restores_module_class_function_and_method_docstrings(self):
        import ast

        work = "import os\n\n\nclass A:\n    def m(self):\n        return 1\n\n\ndef f(x):\n    return x\n"
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp, work)
            code, out = self._irc(env, "check")
            got = (Path(tmp) / "pkg" / "m.py").read_text()
            t = ast.parse(got)
            self.assertEqual(code, 0)
            self.assertIn("restored 4 docstrings in pkg/m.py", out)
            self.assertEqual(ast.get_docstring(t, clean=False), "Module doc.")
            self.assertEqual(ast.get_docstring(t.body[2], clean=False), "Class doc\n\n    more text\n    ")
            self.assertEqual(ast.get_docstring(t.body[2].body[1], clean=False), "Method doc.")
            self.assertEqual(ast.get_docstring(t.body[3], clean=False), "Func doc.")
            self.assertIn("return x", got)
            self.assertEqual(len(self._dones(d)), 1)
            self.assertNotIn("restored", self._irc(env, "check")[1])  # idempotent

    def test_worker_docstring_and_worker_only_defs_are_left_alone(self):
        work = '"""Worker module."""\n\n\ndef f(x):\n    """Worker f."""\n    return x\n\n\ndef extra():\n    return 2\n'
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp, work)
            code, out = self._irc(env, "check")
            self.assertEqual(code, 0)
            self.assertNotIn("restored", out)
            self.assertEqual((Path(tmp) / "pkg" / "m.py").read_text(), work)

    def test_a_def_only_in_the_worker_file_gets_no_docstring(self):
        work = "def f(x):\n    return x\n\n\ndef extra():\n    return 2\n"
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp, work)
            self._irc(env, "check")
            got = (Path(tmp) / "pkg" / "m.py").read_text()
            self.assertIn("def extra():\n    return 2\n", got)
            self.assertIn('"""Func doc."""', got)

    def test_an_edit_that_would_not_parse_leaves_the_file_unchanged(self):
        work = "def f(x):\n    return x\n"
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp, work)
            stub = Path(env["ATLAS_CREW_STUBS"].split('"')[3])
            with mock.patch.object(atlas_irc.ast, "parse", side_effect=[atlas_irc.ast.parse(self.STUB), atlas_irc.ast.parse(work), SyntaxError("x")]):
                new, n = atlas_irc.restore_docstrings(self.STUB, work)
            self.assertEqual((new, n), (work, 0))
            self.assertEqual(stub.read_text(), self.STUB)

    def test_pass_keeps_docstrings_with_exactly_one_unit_check_run(self):
        work = "def f(x):\n    return x\n"
        with tempfile.TemporaryDirectory() as tmp:
            counter = Path(tmp) / "runs.txt"
            d, env = self._setup(tmp, work, unit=f"echo x >> {counter}")
            code, out = self._irc(env, "check")
            self.assertEqual(code, 0)
            self.assertEqual(counter.read_text().count("x"), 1)
            self.assertIn("restored 2 docstrings in pkg/m.py", out)
            self.assertIn('"""Func doc."""', (Path(tmp) / "pkg" / "m.py").read_text())
            self.assertEqual(len(self._dones(d)), 1)

    def test_done_runs_the_unit_check_once_with_docstrings(self):
        work = "def f(x):\n    return x\n"
        with tempfile.TemporaryDirectory() as tmp:
            counter = Path(tmp) / "runs.txt"
            d, env = self._setup(tmp, work, unit=f"echo x >> {counter}")
            code, out = self._irc(env, "done")
            self.assertEqual(code, 0)
            self.assertEqual(counter.read_text().count("x"), 1)
            self.assertIn('"""Func doc."""', (Path(tmp) / "pkg" / "m.py").read_text())

    def test_failure_restores_the_pre_restore_bytes_exactly(self):
        work = b"def f(x):\r\n    return x\r\n"
        with tempfile.TemporaryDirectory() as tmp:
            # the unit check sees the docstring (it fails because of it) and the failure is final
            d, env = self._setup(tmp, "", unit="! grep -q Func pkg/m.py")
            target = Path(tmp) / "pkg" / "m.py"
            target.write_bytes(work)
            code, out = self._irc(env, "check")
            self.assertEqual(code, 1)
            self.assertEqual(target.read_bytes(), work)
            self.assertIn("docstrings were restored for this run and have been removed again", out)
            self.assertEqual(len(self._dones(d)), 0)
            self.assertTrue([r for r in atlas_irc.history(d) if r.get("kind") == "unverified"])

    def test_failure_without_inserted_docstrings_prints_no_restore_line(self):
        work = '"""Worker module."""\n\n\ndef f(x):\n    """Worker f."""\n    return x\n\n\ndef g(x):\n    """Worker g."""\n    return x\n'
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp, work, unit="false")
            code, out = self._irc(env, "check")
            self.assertEqual(code, 1)
            self.assertNotIn("removed again", out)

    def test_a_restore_result_that_does_not_parse_is_skipped(self):
        work = "def f(x):\n    return x\n"
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._setup(tmp, work)
            with mock.patch.object(atlas_irc, "restore_docstrings", return_value=("def f(:\n", 2)):
                code, out = self._irc(env, "check")
            self.assertEqual(code, 0)
            self.assertNotIn("restored", out)
            self.assertEqual((Path(tmp) / "pkg" / "m.py").read_text(), work)

    def test_worker_env_exposes_the_saved_stubs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            (root / "pkg").mkdir(parents=True)
            (root / "pkg" / "a.py").write_text('"""A."""\n')
            plan = {"workers": [{"name": "a", "owns": ["pkg/a.py"]}]}
            rd = Path(tmp) / "run"
            atlas_crew.save_stubs(rd, plan, str(root))
            env = atlas_crew.worker_env(rd, plan, plan["workers"][0], str(root))
            self.assertEqual(json.loads(env["ATLAS_CREW_STUBS"]), {"pkg/a.py": str(rd / "stubs" / "pkg" / "a.py")})
            self.assertEqual((rd / "stubs" / "pkg" / "a.py").read_text(), '"""A."""\n')


class SleepDenyTests(unittest.TestCase):
    def _denied(self, cmd):
        env = {
            "ATLAS_CREW_OWNS": json.dumps(["pkg/ranges.py"]),
            "ATLAS_CREW_OWNERS": json.dumps({"pkg/ranges.py": "ranges"}),
        }
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(buf):
            crew_worker.pre_tool_use({"tool_name": "Bash", "tool_input": {"command": cmd}})
        out = json.loads(buf.getvalue()) if buf.getvalue() else None
        return out["hookSpecificOutput"]["permissionDecisionReason"] if out else None

    def test_sleep_of_three_seconds_or_more_is_denied_with_a_pointer_to_irc_wait(self):
        for cmd in ("sleep 45", "x; sleep 10s; y", "sleep 45; python3 -m pytest -q", "a && sleep 3 && b", "sleep 2.5m"):
            reason = self._denied(cmd)
            self.assertIsNotNone(reason, cmd)
            self.assertIn("irc wait", reason)
            self.assertIn("irc check", reason)

    def test_short_sleeps_and_lookalike_words_pass(self):
        for cmd in ("sleep 1", "sleep 2", "echo sleepy", "sleep", "sleep 0.5", "python3 -c 'import time'"):
            self.assertIsNone(self._denied(cmd), cmd)

class LaunchOrderTests(unittest.TestCase):
    def _plan(self, tmp):
        root = Path(tmp)
        sizes = {"big": 20000, "base": 2000, "mid": 2000, "tiny": 1}  # spec chars per worker
        (root / "SPEC.md").write_text("".join(f"## {n}\n{'x' * c}\n\n" for n, c in sizes.items()))
        w = lambda n, needs=(): {  # noqa: E731
            "name": n, "owns": [f"{n}.py"], "task": "t", "needs": list(needs), "context": [f"SPEC.md#{n}"]
        }
        return {"workers": [w("tiny"), w("mid", ["base"]), w("base"), w("big")]}

    def test_critical_worker_ranks_first_and_slack_rich_worker_gets_higher_nice(self):
        with tempfile.TemporaryDirectory() as tmp:
            order = atlas_crew.launch_order(self._plan(tmp), tmp, ncpu=1)
        names = [x["name"] for x in order]
        self.assertEqual(names[0], "big")  # 80 s of generation: the critical path
        self.assertEqual(order[0]["nice"], 0)
        self.assertEqual(names.index("base") < names.index("tiny"), True)  # base gates mid
        self.assertEqual([x["nice"] for x in order], [0, 4, 8, 12])
        self.assertLess(order[0]["slack"], order[-1]["slack"])
        self.assertEqual(names[-1], "tiny")

    def test_ncpu_sets_how_many_workers_run_at_nice_zero_and_nice_is_capped(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._plan(tmp)
            two = atlas_crew.launch_order(plan, tmp, ncpu=2)
            many = atlas_crew.launch_order(
                {"workers": [{"name": f"w{i}", "owns": ["tiny.py"], "task": "t"} for i in range(40)]}, tmp, ncpu=1
            )
        self.assertEqual([x["nice"] for x in two], [0, 0, 4, 4])
        self.assertEqual(max(x["nice"] for x in many), 19)

    def test_context_sections_add_weight_and_missing_needs_are_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "SPEC.md").write_text("# T\n\n## a\n" + "y" * 5000 + "\n\n## b\nshort\n")
            plan = {
                "workers": [
                    {"name": "a", "owns": ["a.py"], "task": "t", "context": ["SPEC.md#a"], "needs": ["ghost"]},
                    {"name": "b", "owns": ["b.py"], "task": "t", "context": ["SPEC.md#b"]},
                ]
            }
            order = atlas_crew.launch_order(plan, tmp, ncpu=4)
        self.assertEqual([x["name"] for x in order], ["a", "b"])


class StaggerTests(unittest.TestCase):
    def _spec(self, tmp, sizes):
        (Path(tmp) / "SPEC.md").write_text("".join(f"## {n}\n{'x' * c}\n\n" for n, c in sizes.items()))

    def _w(self, n, needs=(), **kw):
        return {"name": n, "owns": [f"{n}.py"], "task": "t", "needs": list(needs), "context": [f"SPEC.md#{n}"], **kw}

    def test_weight_ignores_owned_file_chars(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "a.py").write_text("x" * 9000)
            self._spec(tmp, {"a": 100})
            w = self._w("a")
            self.assertLess(atlas_crew._weight(w, tmp), 200)
            self.assertEqual(atlas_crew._weight({"name": "b", "owns": ["a.py"]}, tmp), 0)

    def test_gen_rate_is_400(self):
        self.assertEqual(atlas_crew.GEN_CHARS_PER_S, 400)

    def test_no_needs_means_no_delay_and_far_later_deps_delay_is_capped(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._spec(tmp, {"slow": 20000, "dep": 400, "free": 400})  # slow: ~50 s; dep waits ~50 s
            plan = {"workers": [self._w("slow"), self._w("dep", ["slow"]), self._w("free")]}
            order = {x["name"]: x for x in atlas_crew.launch_order(plan, tmp, ncpu=4)}
        self.assertEqual(order["slow"]["delay"], 0)
        self.assertEqual(order["free"]["delay"], 0)
        self.assertEqual(order["dep"]["delay"], atlas_crew.STAGGER_CAP_S)

    def test_small_wait_gets_a_partial_delay_and_short_wait_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            # dep gen = 1 s; a: 4000 chars -> 10 s, fin 11.5 -> dep_wait 10.5 -> delay 3.0; b: 1200 -> 3 s -> none
            self._spec(tmp, {"a": 4000, "b": 1200, "d1": 400, "d2": 400})
            plan = {"workers": [self._w("a"), self._w("b"), self._w("d1", ["a"]), self._w("d2", ["b"])]}
            order = {x["name"]: x for x in atlas_crew.launch_order(plan, tmp, ncpu=4)}
        self.assertAlmostEqual(order["d1"]["delay"], 3.0, delta=0.1)
        self.assertEqual(order["d2"]["delay"], 0)

    def test_stagger_off_zeroes_every_delay(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._spec(tmp, {"slow": 20000, "dep": 400})
            plan = {"workers": [self._w("slow"), self._w("dep", ["slow"])]}
            with mock.patch.dict(os.environ, {"ATLAS_CREW_STAGGER": "off"}):
                order = atlas_crew.launch_order(plan, tmp, ncpu=4)
        self.assertEqual([x["delay"] for x in order], [0, 0])

    def test_worker_env_exports_closure_and_peer_owns_for_a_chain(self):
        plan = {
            "workers": [
                {"name": "a", "owns": ["a.py"], "task": "t"},
                {"name": "b", "owns": ["b.py", "b2.py"], "task": "t", "needs": ["a"]},
                {"name": "c", "owns": ["c.py"], "task": "t", "needs": ["b", "c"]},  # self-need ignored
            ]
        }
        a_env = atlas_crew.worker_env(Path("/r"), plan, plan["workers"][0], "/root")
        c_env = atlas_crew.worker_env(Path("/r"), plan, plan["workers"][2], "/root")
        self.assertEqual(a_env["ATLAS_CREW_NEEDS_ALL"], "")
        self.assertEqual(c_env["ATLAS_CREW_NEEDS_ALL"].split(), ["b", "a"])
        self.assertEqual(json.loads(c_env["ATLAS_CREW_PEER_OWNS"]), {"b": ["b.py", "b2.py"], "a": ["a.py"]})
        self.assertEqual(c_env["ATLAS_CREW_STUB_DIR"], str(Path("/r") / "stubs"))

    def test_worker_env_closure_survives_a_cycle(self):
        plan = {
            "workers": [
                {"name": "a", "owns": ["a.py"], "task": "t", "needs": ["b"]},
                {"name": "b", "owns": ["b.py"], "task": "t", "needs": ["a"]},
            ]
        }
        env = atlas_crew.worker_env(Path("/r"), plan, plan["workers"][0], "/root")
        self.assertEqual(env["ATLAS_CREW_NEEDS_ALL"], "b")

    def test_cmd_worker_sleeps_the_delay_on_round_zero_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            rundir = Path(tmp) / "run"
            (rundir / "prompts").mkdir(parents=True)
            (rundir / "prompts" / "a.md").write_text("P")
            (rundir / "prompts" / "a.fix1.md").write_text("F")
            (rundir / "sid").mkdir()
            (rundir / "sid" / "a").write_text("sid-1")
            plan = {"workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true"}]}
            (rundir / "run.json").write_text(
                json.dumps({"plan": plan, "root": tmp, "run_id": "crew-t", "settings": "/s.json"})
            )
            fake = Path(tmp) / "bin" / "claude"
            fake.parent.mkdir()
            fake.write_text("#!/bin/sh\necho '{\"type\":\"result\",\"is_error\":false}'\n")
            fake.chmod(0o755)
            env = {"PATH": f"{fake.parent}{os.pathsep}{os.environ['PATH']}"}
            for rnd, expect in ((0, [mock.call(2.5)]), (1, [])):
                args = types.SimpleNamespace(rundir=str(rundir), name="a", round=rnd, no_hold=True, delay=2.5)
                with (
                    mock.patch.dict(os.environ, env),
                    mock.patch.object(atlas_crew.time, "sleep") as sleep,
                    contextlib.redirect_stdout(io.StringIO()),
                ):
                    atlas_crew.cmd_worker(args)
                self.assertEqual([c for c in sleep.call_args_list if c.args == (2.5,)], expect)


class StagedWriteTests(_IrcCase, unittest.TestCase):
    def _stage(self, tmp):
        root, stage = Path(tmp) / "root", Path(tmp) / "stage"
        root.mkdir()
        stage.mkdir()
        return root, stage

    def test_install_staged_copies_newer_changed_files_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, stage = self._stage(tmp)
            (root / "pkg").mkdir()
            (stage / "pkg").mkdir()
            (root / "pkg/new.py").write_text("stub")
            (stage / "pkg/new.py").write_text("real")
            (root / "pkg/old.py").write_text("mine")
            (stage / "pkg/old.py").write_text("older staged")
            os.utime(stage / "pkg/old.py", ns=(1, 1))  # staged copy older than the real file
            (root / "pkg/same.py").write_text("same")
            (stage / "pkg/same.py").write_text("same")
            (stage / "pkg/created.py").write_text("brand new")  # no real file yet
            os.utime(root / "pkg/new.py", ns=(1, 1))
            got = atlas_irc.install_staged(stage, root, ["pkg/new.py", "pkg/old.py", "pkg/same.py", "pkg/created.py", "pkg/none.py"])
            self.assertEqual(sorted(got), ["pkg/created.py", "pkg/new.py"])
            self.assertEqual((root / "pkg/new.py").read_text(), "real")
            self.assertEqual((root / "pkg/old.py").read_text(), "mine")
            self.assertEqual((root / "pkg/created.py").read_text(), "brand new")
            self.assertFalse((root / "pkg/none.py").exists())

    def test_check_installs_the_staged_file_before_the_unit_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, stage = self._stage(tmp)
            (root / "m.py").write_text("stub")
            (stage / "m.py").write_text("ok")
            os.utime(root / "m.py", ns=(1, 1))
            d, env = self._env(str(root), "grep -q ok m.py")
            env.update(ATLAS_CREW_STAGE=str(stage), ATLAS_CREW_OWNS=json.dumps(["m.py"]))
            code, out = self._irc(env, "--dir", str(d), "check")
            self.assertEqual(code, 0, out)
            self.assertIn("installed m.py from staged copy", out)
            self.assertEqual(len(self._dones(d)), 1)

    def test_check_without_a_stage_dir_is_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "true")
            code, out = self._irc(env, "--dir", str(d), "check")
            self.assertEqual(code, 0)
            self.assertNotIn("installed", out)

    def test_hook_allows_write_in_own_stage_dir_and_denies_a_peers(self):
        with tempfile.TemporaryDirectory() as tmp:
            own = Path(tmp) / ".atlas/tmp/run1/ranges"
            peer = Path(tmp) / ".atlas/tmp/run1/semver"
            h = HookTests()
            d, env = h._env(tmp, ATLAS_CREW_STAGE=str(own))
            ok = h._run(env, crew_worker.pre_tool_use, {"tool_name": "Write", "tool_input": {"file_path": str(own / "pkg/ranges.py")}})
            self.assertIsNone(ok)
            rel = h._run(env, crew_worker.pre_tool_use, {"tool_name": "Edit", "tool_input": {"file_path": ".atlas/tmp/run1/ranges/pkg/ranges.py"}})
            self.assertIsNone(rel)
            bad = h._run(env, crew_worker.pre_tool_use, {"tool_name": "Write", "tool_input": {"file_path": str(peer / "pkg/semver.py")}})
            self.assertEqual(bad["hookSpecificOutput"]["permissionDecision"], "deny")
            sneaky = h._run(env, crew_worker.pre_tool_use, {"tool_name": "Write", "tool_input": {"file_path": str(own) + "-x/f.py"}})
            self.assertEqual(sneaky["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_worker_prompt_lists_staged_paths_and_gives_no_heredoc_instruction(self):
        plan = {"goal": "g", "workers": [{"name": "a", "owns": ["pkg/a.py"], "task": "do a", "check": "true"}]}
        with tempfile.TemporaryDirectory() as tmp:
            text = atlas_crew.worker_prompt(plan, plan["workers"][0], "crew-x", tmp)
            env = atlas_crew.worker_env(Path(tmp) / "rd" / "crew-x", plan, plan["workers"][0], tmp)
        self.assertIn("- pkg/a.py (write it to .atlas/tmp/crew-x/a/pkg/a.py)", text)
        self.assertEqual(env["ATLAS_CREW_STAGE"], str(Path(tmp) / ".atlas/tmp/crew-x/a"))
        self.assertEqual(atlas_crew.WORKER_TOOLS, "Bash,Edit,Write")
        prompt = (atlas_crew.BASE_PROMPT + atlas_crew.PROTOCOL).lower()
        self.assertIn("write tool", prompt)
        self.assertNotIn("with a heredoc", prompt)
        self.assertNotIn("prefer bash heredocs", prompt)
        self.assertIn("never write files with shell heredocs", " ".join(prompt.split()))


class SupervisorOverlapTests(unittest.TestCase):
    def _run(self, tmp, exit_late, touch_on_exit=False):
        rundir = Path(tmp) / ".atlas/.run/crew/crew-t"
        (rundir / "exit").mkdir(parents=True)
        d = atlas_irc.init_bus(rundir / "irc", "#crew-t", ["a", "b"], lead="lead")
        plan = {
            "check": f"echo x >> {tmp}/checks.txt",
            "workers": [
                {"name": "a", "owns": ["a.py"], "task": "t"},
                {"name": "b", "owns": ["b.py"], "task": "t"},
            ],
        }
        Path(tmp, "a.py").write_text("a")
        Path(tmp, "b.py").write_text("b")
        meta = {"run_id": "crew-t", "root": tmp, "plan": plan, "tmux": False, "started": time.time(), "fix_rounds": 0, "timeout": 60}
        (rundir / "run.json").write_text(json.dumps(meta))
        (Path(tmp) / ".atlas/tmp/crew-t/a").mkdir(parents=True)
        for n in ("a", "b"):
            atlas_irc.post(d, n, "#crew-t", f"DONE {n}: ok", kind="done")
        (rundir / "exit/a.r0.json").write_text(json.dumps({"exit": 0, "wall_s": 1}))

        def late_exit():
            time.sleep(1.5)
            if touch_on_exit:
                Path(tmp, "b.py").write_text("b changed")
            (rundir / "exit/b.r0.json").write_text(json.dumps({"exit": 0, "wall_s": 2}))

        t = threading.Thread(target=late_exit)
        t.start()
        t0 = time.time()
        atlas_crew.cmd_supervise(types.SimpleNamespace(rundir=str(rundir)))
        t.join()
        return json.loads((rundir / "summary.json").read_text()), time.time() - t0

    def test_check_starts_when_every_worker_holds_done_though_one_process_has_not_exited(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary, _ = self._run(tmp, True)
            r0 = summary["rounds"][0]
            self.assertTrue(r0["check_started_before_exit"])
            self.assertTrue(r0["all_exited"])
            self.assertEqual(r0["check_exit"], 0)
            self.assertEqual(Path(tmp, "checks.txt").read_text().count("x"), 1)
            self.assertFalse(Path(tmp, ".atlas/tmp/crew-t").exists())  # staged copies are removed

    def test_check_reruns_when_an_owned_file_changed_after_the_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary, _ = self._run(tmp, True, touch_on_exit=True)
            self.assertEqual(Path(tmp, "checks.txt").read_text().count("x"), 2)
            self.assertTrue(summary["rounds"][0]["check_started_before_exit"])

    def test_launch_priority_off_launches_in_plan_order_at_nice_zero(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"ATLAS_CREW_PRIORITY": "off", "ATLAS_CREW_TMUX": "off"}):
            plan = {"workers": [{"name": n, "owns": [f"{n}.py"], "task": "t"} for n in ("z", "y")]}
            Path(tmp, "p.json").write_text(json.dumps(plan))
            launched = []
            with mock.patch.object(atlas_crew, "_launch", lambda m, r, n, rnd, cmd: launched.append(cmd)), \
                 mock.patch.object(atlas_crew.subprocess, "Popen"), contextlib.redirect_stdout(io.StringIO()):
                atlas_crew.cmd_run(types.SimpleNamespace(plan=str(Path(tmp, "p.json")), root=tmp, run_id="crew-p", model=None, effort=None,
                                                         fix_rounds=0, timeout=60, no_tmux=True, wait=0, spec=None, files=None))
            meta = json.loads(Path(tmp, ".atlas/.run/crew/crew-p/run.json").read_text())
        self.assertEqual([x["name"] for x in meta["launch"]], ["z", "y"])
        self.assertEqual({x["nice"] for x in meta["launch"]}, {0})
        self.assertTrue(all("--nice 0" in c for c in launched))
        self.assertIn(" z ", launched[0] + " ")


class ShardedCheckTests(unittest.TestCase):
    """The supervisor's final pytest check runs as parallel shards plus a rest shard."""

    PY = f"{sys.executable} -m pytest -q"

    def _tree(self, tmp, tests=("test_a.py", "test_b.py", "test_c.py"), extra=True):
        root = Path(tmp)
        for n in tests:
            (root / n).write_text(f"def test_{n[5:-3]}():\n    assert True\n" + "# pad\n" * (len(n) * 40))
        if extra:
            (root / "test_other.py").write_text("def test_other():\n    assert True\n")
        return root

    def _jobs(self, tmp, cmd=None, files=("test_a.py", "test_b.py", "test_c.py"), ncpu=2):
        return atlas_crew._shard_jobs(cmd or self.PY, Path(tmp), list(files), ncpu)

    def test_shards_cover_every_known_file_once_plus_rest_with_ignores(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._tree(tmp)
            jobs = self._jobs(tmp)
            self.assertEqual(len(jobs), 3)  # min(2 cpu, 3 files) + rest
            files = ["test_a.py", "test_b.py", "test_c.py"]
            seen = [f for c, _, rest in jobs if not rest for f in files if f in c.split()]
            self.assertEqual(sorted(seen), files)
            for c, _, rest in jobs[:-1]:
                self.assertFalse(rest)
                self.assertNotIn("--ignore", c)
                self.assertIn("no:cacheprovider", c)
            rest_cmd, _, is_rest = jobs[-1]
            self.assertTrue(is_rest)
            for f in files:
                self.assertIn(f"--ignore={f}", rest_cmd)
            self.assertEqual(atlas_crew.shard_count(self.PY, Path(tmp), files, 2), 3)

    def test_greedy_balance_puts_the_largest_file_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for n, k in (("a.py", 100), ("b.py", 10), ("c.py", 10), ("d.py", 10)):
                (root / n).write_text("x" * k)
            groups = atlas_crew._shard_files(["a.py", "b.py", "c.py", "d.py"], root, 2)
            self.assertEqual(sorted(map(tuple, groups)), [("a.py",), ("b.py", "c.py", "d.py")])

    def test_combined_run_passes_and_runs_tests_outside_the_known_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._tree(tmp)
            code, out = atlas_crew.sharded_check(self.PY, Path(tmp), ["test_a.py", "test_b.py", "test_c.py"], 2)
            self.assertEqual(code, 0, out)
            self.assertIn("rest (everything else)", out)
            rest = out.split("rest (everything else)")[1]
            self.assertIn("1 passed", rest)  # test_other.py ran in the rest shard

    def test_non_pytest_or_chained_command_falls_back_to_one_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._tree(tmp)
            files = ["test_a.py", "test_b.py"]
            for cmd in ("make test", f"{self.PY} | tail -5", f"{self.PY} && true", f"{self.PY}; true", f"{self.PY} > /dev/null"):
                self.assertEqual(self._jobs(tmp, cmd, files), [], cmd)
                self.assertEqual(atlas_crew.shard_count(cmd, Path(tmp), files, 4), 1)
            with mock.patch.object(atlas_crew, "_run_check", return_value=(0, "one")) as rc:
                self.assertEqual(atlas_crew.sharded_check("make test", Path(tmp), files, 4), (0, "one"))
                rc.assert_called_once()

    def test_fewer_than_two_known_files_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._tree(tmp)
            self.assertEqual(self._jobs(tmp, files=["test_a.py"]), [])

    def test_shard_off_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._tree(tmp)
            with mock.patch.dict(os.environ, {"ATLAS_CREW_SHARD": "off"}):
                self.assertEqual(self._jobs(tmp), [])
                with mock.patch.object(atlas_crew, "_run_check", return_value=(0, "one")) as rc:
                    atlas_crew.sharded_check(self.PY, Path(tmp), ["test_a.py", "test_b.py"], 4)
                    rc.assert_called_once()

    def test_a_failing_shard_fails_the_combined_check_and_its_output_comes_last(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._tree(tmp)
            (Path(tmp) / "test_c.py").write_text("def test_c():\n    assert False, 'boom'\n")
            code, out = atlas_crew.sharded_check(self.PY, Path(tmp), ["test_a.py", "test_b.py", "test_c.py"], 3)
            self.assertNotEqual(code, 0)
            heads = [ln for ln in out.split("\n") if ln.startswith("=== shard [")]
            self.assertIn("test_c.py", heads[-1])
            self.assertIn("exit 1", heads[-1])
            self.assertTrue(all("exit 0" in h for h in heads[:-1]))
            self.assertIn("boom", out[-800:])
            plan = {"workers": [{"name": "w", "owns": [], "tests": ["test_c.py"]}]}
            self.assertIn("w", atlas_crew.route_failures(plan, out))

    def test_rest_shard_exit_5_counts_as_a_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._tree(tmp, extra=False)
            code, out = atlas_crew.sharded_check(self.PY, Path(tmp), ["test_a.py", "test_b.py", "test_c.py"], 2)
            self.assertEqual(code, 0, out)
            self.assertIn("rest (everything else)] exit 0", out)

    def test_known_test_files_expand_globs_and_skip_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._tree(tmp)
            plan = {"workers": [{"tests": ["test_a.py", "test_[bc].py"]}, {"tests": ["missing.py", "test_a.py"]}]}
            self.assertEqual(atlas_crew._known_test_files(plan, Path(tmp)), ["test_a.py", "test_b.py", "test_c.py"])


class PlainPytestTests(unittest.TestCase):
    """Only an allowlisted `pytest` command counts as the whole file's check."""

    def _files(self, unit):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "t.py").write_text("")
            Path(tmp, "tests").mkdir()
            Path(tmp, "tests/test_a.py").write_text("")
            return atlas_crew._plain_pytest_files(unit, tmp)

    def test_narrowing_commands_are_not_plain(self):
        for unit in ("python3 -m pytest -kfoo t.py", "python3 -m pytest --last-failed t.py", "python3 -m pytest --ignore-glob=*b* t.py",
                     "python3 -m pytest --deselect=t.py::x t.py", "python3 -m pytest -k foo t.py", "pytest t.py::x",
                     "pytest -q t.py -m slow", "pytest -q t.py && true", "pytest -q missing.py", "python3 -m unittest t.py"):
            self.assertIsNone(self._files(unit), unit)

    def test_allowlisted_commands_are_plain(self):
        self.assertEqual(self._files("python3 -m pytest -q tests/test_a.py"), ["tests/test_a.py"])
        self.assertEqual(self._files("pytest -qq -x -p no:cacheprovider t.py"), ["t.py"])
        self.assertEqual(self._files("python -m pytest -pno:cacheprovider t.py"), ["t.py"])


class CheckCacheTests(unittest.TestCase):
    """The supervisor's final check skips test files whose worker's DONE passed against the bytes on disk."""

    PY = f"{sys.executable} -m pytest -q"

    def _run(self, tmp, mutate=None, peer_digests=True, rest=True, env=None, test_digest=True, unit_b=None):
        rundir = Path(tmp) / ".atlas/.run/crew/crew-t"
        (rundir / "exit").mkdir(parents=True)
        d = atlas_irc.init_bus(rundir / "irc", "#crew-t", ["a", "b"], lead="lead")
        root, ran = Path(tmp), Path(tmp, "ran.txt")
        for n in ("a", "b") + (("rest",) if rest else ()):
            (root / f"{n}.py").write_text("x = 1\n")
            (root / f"test_{n}.py").write_text(f"def test_{n}():\n    open({str(ran)!r}, 'a').write('{n}\\n')\n")
        plan = {
            "check": self.PY,
            "workers": [
                {"name": "a", "owns": ["a.py"], "tests": ["test_a.py"], "unit_check": "python3 -m pytest -q test_a.py", "needs": [], "task": "t"},
                {"name": "b", "owns": ["b.py"], "tests": ["test_b.py"], "unit_check": unit_b or "python3 -m pytest -q test_b.py", "needs": ["a"], "task": "t"},
            ],
        }
        dig = lambda f: atlas_irc._owned_digest(root, [f])
        td = lambda u: {"test_digest": atlas_irc.test_inputs_digest(root, u)} if test_digest else {}
        atlas_irc.post(d, "a", "#crew-t", "DONE a: ok", kind="done",
                       extra={"digest": dig("a.py"), "peer_digests": {}, **td("python3 -m pytest -q test_a.py")})
        extra = {"digest": dig("b.py"), **td(plan["workers"][1]["unit_check"]), **({"peer_digests": {"a": dig("a.py")}} if peer_digests else {})}
        atlas_irc.post(d, "b", "#crew-t", "DONE b: ok", kind="done", extra=extra)
        meta = {"run_id": "crew-t", "root": tmp, "plan": plan, "tmux": False, "started": time.time(), "fix_rounds": 0, "timeout": 60}
        (rundir / "run.json").write_text(json.dumps(meta))
        for n in ("a", "b"):
            (rundir / f"exit/{n}.r0.json").write_text(json.dumps({"exit": 0, "wall_s": 1}))
        if mutate:
            mutate(root)
        with mock.patch.dict(os.environ, env or {}):
            atlas_crew.cmd_supervise(types.SimpleNamespace(rundir=str(rundir)))
        summary = json.loads((rundir / "summary.json").read_text())
        return summary["rounds"][0], sorted(ran.read_text().split()) if ran.exists() else []

    def test_verified_files_are_skipped_and_rest_tests_still_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            r0, ran = self._run(tmp)
        self.assertEqual(r0["check_exit"], 0)
        self.assertEqual(r0["check_cached"], ["test_a.py", "test_b.py"])
        self.assertEqual(ran, ["rest"])

    def test_own_file_changed_after_done_runs_that_file_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            r0, ran = self._run(tmp, mutate=lambda root: (root / "b.py").write_text("x = 2\n"))
        self.assertEqual(r0["check_cached"], ["test_a.py"])
        self.assertEqual(ran, ["b", "rest"])

    def test_closure_peer_changed_after_done_runs_the_dependent_too(self):
        with tempfile.TemporaryDirectory() as tmp:
            r0, ran = self._run(tmp, mutate=lambda root: (root / "a.py").write_text("x = 2\n"))
        self.assertEqual(r0["check_cached"], [])
        self.assertEqual(ran, ["a", "b", "rest"])

    def test_missing_peer_digests_runs_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            r0, ran = self._run(tmp, peer_digests=False)
        self.assertEqual(r0["check_cached"], ["test_a.py"])
        self.assertEqual(ran, ["b", "rest"])

    def test_test_file_edited_after_done_is_not_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            r0, ran = self._run(tmp, mutate=lambda root: (root / "test_b.py").write_text(
                (root / "test_b.py").read_text() + "\n# edited\n"))
        self.assertEqual(r0["check_cached"], ["test_a.py"])
        self.assertEqual(ran, ["b", "rest"])

    def test_conftest_edited_after_done_is_not_skipped(self):
        def mutate(root):
            (root / "sub").mkdir()
            (root / "sub/conftest.py").write_text("X = 2\n")
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "conftest.py").write_text("X = 1\n")
            r0, ran = self._run(tmp, mutate=lambda root: (root / "conftest.py").write_text("X = 2\n"))
            self.assertEqual(r0["check_cached"], [])
        with tempfile.TemporaryDirectory() as tmp:
            r0, _ = self._run(tmp, mutate=mutate)
        self.assertEqual(r0["check_cached"], [])

    def test_pytest_ini_edited_after_done_is_not_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "pytest.ini").write_text("[pytest]\n")
            r0, _ = self._run(tmp, mutate=lambda root: (root / "pytest.ini").write_text("[pytest]\naddopts = -q\n"))
        self.assertEqual(r0["check_cached"], [])

    def test_done_without_test_digest_is_not_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            r0, ran = self._run(tmp, test_digest=False)
        self.assertEqual(r0["check_cached"], [])
        self.assertEqual(ran, ["a", "b", "rest"])

    def test_cache_off_runs_everything(self):
        with tempfile.TemporaryDirectory() as tmp:
            r0, ran = self._run(tmp, env={"ATLAS_CREW_CHECK_CACHE": "off"})
        self.assertEqual(r0["check_cached"], [])
        self.assertEqual(ran, ["a", "b", "rest"])

    def test_everything_verified_and_no_rest_test_passes_and_says_so(self):
        with tempfile.TemporaryDirectory() as tmp:
            r0, ran = self._run(tmp, rest=False)
            code, out = atlas_crew.sharded_check(self.PY, Path(tmp), ["test_a.py", "test_b.py"], 2, skip=["test_a.py", "test_b.py"])
        self.assertEqual((r0["check_exit"], r0["check_cached"], ran), (0, ["test_a.py", "test_b.py"], []))
        self.assertEqual(code, 0, out)
        self.assertIn("2 test files verified by worker DONE on the same bytes; skipped", out)


if __name__ == "__main__":
    unittest.main()
